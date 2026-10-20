"""Regression coverage for configured low-hashrate behavior and safe updates."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import aiosqlite
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
import pytest
import pytest_asyncio

from app import background, config, db as database
from app.models import AppConfig, ConfigUpdate, DashboardMetrics
from app.routers import config_routes
from app.services.metrics_service import fetch_full_metrics


@pytest.fixture
def config_path(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    return config.CONFIG_PATH


@pytest.mark.parametrize("threshold, rate, low_mode", [
    (3, 2.999, True), (3, 3, False), (10, 5, True), (10, 10, False),
    (0, 0, False), (0, 0.5, False),
])
@pytest.mark.asyncio
async def test_metrics_follow_configured_three_hour_boundary(config_path, threshold, rate, low_mode):
    config.save_config({"low_hashrate_threshold_ths": threshold})
    client = SimpleNamespace(
        wallet="test-wallet",
        get_user_hashrate=AsyncMock(return_value={"hashrate_60sec": 0, "hashrate_3hr": rate}),
        get_statsnap=AsyncMock(return_value={"unpaid_earnings": 0}),
        get_pool_stat=AsyncMock(return_value={}),
        get_latest_block_info=AsyncMock(return_value={}),
        get_bitcoin_stats=AsyncMock(return_value={"btc_price": 100000, "network_hashrate": 1e21}),
    )
    metrics = await fetch_full_metrics(client)
    assert metrics.low_hashrate_mode is low_mode
    assert metrics.hashrate_3hr == rate


@pytest.mark.parametrize("value", [-1, 1_000_001, float("nan"), float("inf"), None, "invalid", True, [], {}])
def test_bad_hand_edited_threshold_uses_default(config_path, value):
    config.save_config({"low_hashrate_threshold_ths": value})
    assert config.get_low_hashrate_threshold_ths() == 3


@pytest.mark.parametrize("value", [-1, 1_000_001, float("nan"), float("inf"), True, "10"])
def test_config_models_reject_invalid_thresholds(value):
    for model in (AppConfig, ConfigUpdate):
        with pytest.raises(ValidationError):
            model(low_hashrate_threshold_ths=value)


@pytest_asyncio.fixture
async def configured_app(config_path, tmp_path, monkeypatch):
    config.save_config({"wallet": "test-wallet", "power_cost": .25, "high_hashrate_threshold_ths": 20})
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(database, "_rate_migration_lock", asyncio.Lock())
    await database.init_db()
    conn = await aiosqlite.connect(database.DB_PATH)
    conn.row_factory = aiosqlite.Row
    now = time.time()
    snapshot = DashboardMetrics(
        wallet="test-wallet", hashrate_3hr=5, data_status="fresh", data_updated_at=now,
        snapshot_updated_at=now, low_hashrate_mode=False,
    ).model_dump()
    monkeypatch.setattr(background, "_current_metrics", snapshot)
    monkeypatch.setattr(background, "_current_workers", None)
    monkeypatch.setattr(background, "_raw_workers", None)
    monkeypatch.setattr(background, "_cache_scope", "test-wallet")
    monkeypatch.setattr(background, "_financial_lock", asyncio.Lock())
    monkeypatch.setattr(background, "cache_set", AsyncMock())
    monkeypatch.setattr(background, "_broadcast", lambda event: None)
    refresh = AsyncMock()
    monkeypatch.setattr(background, "trigger_refresh", refresh)
    app = FastAPI()
    app.include_router(config_routes.router, prefix="/api")

    async def connection():
        yield conn

    app.dependency_overrides[database.get_db] = connection
    try:
        yield app, snapshot, refresh
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_threshold_save_updates_cached_mode_without_waiting_for_ocean(configured_app):
    app, before, refresh = configured_app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        initial = await client.get("/api/config")
        assert initial.json()["low_hashrate_threshold_ths"] == 3
        changed = await client.post("/api/config", json={"low_hashrate_threshold_ths": 10})
        assert changed.status_code == 200
        assert changed.json()["low_hashrate_threshold_ths"] == 10
        snapshot = background.get_current_metrics()
        assert snapshot["low_hashrate_mode"] is True
        assert snapshot["data_updated_at"] == before["data_updated_at"]
        assert snapshot["snapshot_updated_at"] > before["snapshot_updated_at"]
        assert (await client.get("/api/config")).json()["low_hashrate_threshold_ths"] == 10
        # Unrelated updates preserve the configured boundary and legacy keys.
        assert (await client.post("/api/config", json={"currency": "EUR"})).status_code == 200
        assert config.get_low_hashrate_threshold_ths() == 10
        assert config.load_config()["high_hashrate_threshold_ths"] == 20
        assert config.get_power_cost() == .25
        # A zero threshold explicitly disables low mode.
        assert (await client.post("/api/config", json={"low_hashrate_threshold_ths": 0})).status_code == 200
        assert background.get_current_metrics()["low_hashrate_mode"] is False
        await asyncio.sleep(0)
        assert refresh.await_count >= 1


@pytest.mark.parametrize("value", [-1, 1_000_001, "NaN", True])
@pytest.mark.asyncio
async def test_invalid_api_threshold_is_rejected_without_changing_config(configured_app, value):
    app, _, _ = configured_app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/config", json={"low_hashrate_threshold_ths": value})
    assert response.status_code == 422
    assert config.get_low_hashrate_threshold_ths() == 3


@pytest.mark.asyncio
async def test_read_config_tolerates_bad_hand_edited_threshold(configured_app):
    app, _, _ = configured_app
    config.save_config({"low_hashrate_threshold_ths": "bad"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/config")
    assert response.status_code == 200
    assert response.json()["low_hashrate_threshold_ths"] == 3
