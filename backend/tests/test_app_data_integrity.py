"""Regression coverage for truthful mining state, finances, and wallet scope."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import aiosqlite
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio

from app import background, config, db as database
from app.models import DashboardMetrics
from app.routers import config_routes, metrics, notifications, worker_settings, workers
from app.services.metrics_service import MetricsUnavailableError, fetch_full_metrics
from app.services.worker_service import build_worker_summary


@pytest_asyncio.fixture
async def state(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    config.save_config({"wallet": "wallet-a", "power_cost": 0.25, "power_usage": 3000})
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    await database.init_db()
    conn = await aiosqlite.connect(database.DB_PATH)
    conn.row_factory = aiosqlite.Row
    for name in ("_current_metrics", "_current_workers", "_raw_workers", "_client", "_last_refresh"):
        monkeypatch.setattr(background, name, None)
    monkeypatch.setattr(background, "_cache_scope", "wallet-a")
    monkeypatch.setattr(background, "_refresh_lock", asyncio.Lock())
    monkeypatch.setattr(background, "_financial_lock", asyncio.Lock())
    monkeypatch.setattr(background, "cache_set", AsyncMock())
    monkeypatch.setattr(background, "cache_delete", AsyncMock())
    monkeypatch.setattr(background, "_broadcast", lambda event: None)
    try:
        yield conn
    finally:
        await conn.close()


def ocean_client(**replacements):
    methods = {
        "get_user_hashrate": {"hashrate_60sec": 0, "hashrate_3hr": 0, "hashrate_24hr": 0, "workers_hashing": 0},
        "get_statsnap": {"unpaid_earnings": 0},
        "get_pool_stat": {},
        "get_latest_block_info": {},
        "get_bitcoin_stats": {"btc_price": 100000, "network_hashrate": 1e21},
        "get_worker_data": {"workers": [{"name": "s21-off", "status": "offline", "hashrate_3hr": 0}]},
    }
    methods.update(replacements)
    return SimpleNamespace(wallet="wallet-a", **{key: AsyncMock(return_value=value) for key, value in methods.items()})


@pytest.mark.asyncio
async def test_valid_zero_snapshot_refreshes_workers_history_and_alerts(state, monkeypatch):
    client = ocean_client()
    background._client = client
    background._current_metrics = DashboardMetrics(
        wallet="wallet-a", hashrate_3hr=100, workers_hashing=1, data_status="fresh", data_updated_at=100
    ).model_dump()
    alert = AsyncMock()
    monkeypatch.setattr(background, "check_and_fire", alert)

    await background.refresh_once(state)

    actual = background.get_current_metrics()
    assert actual["hashrate_3hr"] == 0
    assert actual["workers_hashing"] == 0
    assert actual["data_status"] == "fresh"
    assert background.get_last_refresh() == actual["data_updated_at"]
    client.get_worker_data.assert_awaited_once()
    alert.assert_awaited_once()
    history = await database.get_metric_history(state)
    assert len(history) == 1
    assert history[0]["hashrate_3hr"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", [
    {"get_user_hashrate": {}},
    {"get_user_hashrate": {"hashrate_3hr": float("nan")}},
    {"get_statsnap": {}},
    {"get_bitcoin_stats": {}},
])
async def test_missing_upstream_data_is_not_a_healthy_zero(state, replacement):
    with pytest.raises(MetricsUnavailableError):
        await fetch_full_metrics(ocean_client(**replacement))


@pytest.mark.asyncio
async def test_failure_keeps_source_age_and_still_refreshes_workers(state, monkeypatch):
    client = ocean_client(get_user_hashrate={})
    background._client = client
    background._last_refresh = 100
    background._current_metrics = DashboardMetrics(
        wallet="wallet-a", hashrate_3hr=100, data_status="fresh", data_updated_at=100
    ).model_dump()
    alerts = AsyncMock()
    monkeypatch.setattr(background, "check_and_fire", alerts)
    await background.refresh_once(state)
    actual = background.get_current_metrics()
    assert actual["hashrate_3hr"] == 100
    assert actual["data_updated_at"] == 100
    assert actual["data_status"] == "stale"
    assert background.get_last_refresh() == 100
    client.get_worker_data.assert_awaited_once()
    alerts.assert_not_awaited()
    assert await database.get_metric_history(state) == []


def test_worker_day_estimate_is_distinct_from_unpaid_balance():
    raw = {"workers": [
        {"name": "s21-a", "status": "online", "hashrate_3hr": 100},
        {"name": "s21-b", "status": "offline", "hashrate_3hr": 100},
    ]}
    summary = build_worker_summary(raw, {"unpaid_earnings": 0.005, "daily_mined_sats": 18000}, {}, "wallet-a")
    assert summary["total_earnings"] == 0.005
    assert summary["total_daily_earnings_btc"] == pytest.approx(0.00018)
    assert summary["workers"][0]["estimated_daily_btc"] == pytest.approx(0.00009)
    assert summary["workers"][1]["power_consumption"] == 0
    overridden = build_worker_summary(raw, {}, {"s21-b": {"power": 0, "efficiency": None}}, "wallet-a")
    assert overridden["workers"][1]["power_consumption"] == 0


@pytest.mark.asyncio
async def test_rest_and_stream_use_same_worker_balances_and_power(state, monkeypatch):
    background._client = ocean_client()
    background._client.get_worker_data.return_value = {
        "workers": [{"name": "s21-a", "status": "online", "hashrate_3hr": 100}]
    }
    await background.refresh_once(state)
    monkeypatch.setattr(workers, "cache_get", AsyncMock(return_value=None))
    response = await workers.get_workers(status="all", sort_by="name", descending=False)
    assert response.model_dump() == background.get_current_workers()


@pytest.mark.asyncio
async def test_cost_endpoints_share_config_and_update_snapshot_without_network_wait(state, monkeypatch):
    background._current_metrics = DashboardMetrics(
        wallet="wallet-a", daily_mined_sats=10000, monthly_mined_sats=300000, btc_price=100000
    ).model_dump()
    background._raw_workers = {"workers": [{"name": "s21-a", "status": "online", "hashrate_3hr": 100}]}
    app = FastAPI()
    for router in (worker_settings.router, config_routes.router, metrics.router):
        app.include_router(router, prefix="/api")

    async def get_test_db():
        yield state

    app.dependency_overrides[database.get_db] = get_test_db
    monkeypatch.setattr(config_routes, "_safe_refresh", AsyncMock())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/workers/settings")).json()["electricity_rate"] == .25
        # A periodic upstream refresh must not hold up saving local settings.
        async with background._refresh_lock:
            response = await asyncio.wait_for(client.put("/api/workers/settings/electricity-rate", json={"rate": .5}), 1)
        assert response.status_code == 200
        assert config.get_power_cost() == .5
        changed = await client.put("/api/workers/settings", json={"overrides": {"s21-a": {"power": 1000}}})
        assert changed.status_code == 200
        assert background.get_current_metrics()["daily_power_cost"] == 12
        changed = await client.post("/api/config", json={"power_cost": .2})
        assert changed.status_code == 200
        assert background.get_current_metrics()["daily_power_cost"] == 4.8
        assert (await client.get("/api/workers/settings")).json()["electricity_rate"] == .2
        rejected = await client.put("/api/workers/settings/electricity-rate", json={"rate": 11})
        assert rejected.status_code == 422
        assert config.get_power_cost() == .2


@pytest.mark.asyncio
async def test_history_is_wallet_scoped_and_preserves_legitimate_zeros(state):
    for wallet, rate in (("wallet-a", 120), ("wallet-b", 240), ("wallet-a", 0)):
        await database.save_metric_snapshot(state, {"wallet": wallet, "hashrate_60sec": rate, "hashrate_3hr": rate})
    assert [r["hashrate_3hr"] for r in await database.get_metric_history(state)] == [120, 0]
    assert [r["hashrate_3hr"] for r in await database.get_metric_history(state, wallet="wallet-b")] == [240]
    config.save_config({"wallet": ""})
    assert await database.get_metric_history(state) == []


@pytest.mark.asyncio
async def test_migration_preserves_but_does_not_assign_unknown_old_history(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    async with aiosqlite.connect(path) as conn:
        await conn.execute("CREATE TABLE metric_history(id INTEGER PRIMARY KEY, timestamp REAL, hashrate_60sec REAL, hashrate_3hr REAL)")
        await conn.execute("INSERT INTO metric_history VALUES(1, ?, 100, 100)", (time.time(),))
        await conn.commit()
    monkeypatch.setattr(database, "DB_PATH", path)
    await database.init_db()
    async with aiosqlite.connect(path) as conn:
        conn.row_factory = aiosqlite.Row
        assert await database.get_metric_history(conn, wallet="wallet-a") == []
        async with conn.execute("SELECT wallet FROM metric_history") as cursor:
            assert (await cursor.fetchone())["wallet"] == ""


@pytest.mark.asyncio
async def test_global_unread_count_is_independent_of_category(state):
    await database.create_notification(state, "worker", "worker", "warning")
    await database.create_notification(state, "earning", "earnings", "success")
    read = await database.create_notification(state, "old", "system", "info")
    await database.mark_notification_read(state, read["id"])
    assert await notifications.unread_count(state) == {"unread_count": 2}


def test_old_wallet_snapshots_are_not_returned(state):
    background._current_metrics = DashboardMetrics(wallet="wallet-a").model_dump()
    background._current_workers = {"wallet": "wallet-a", "workers": []}
    config.save_config({"wallet": "wallet-b"})
    assert background.get_current_metrics() is None
    assert background.get_current_workers() is None
