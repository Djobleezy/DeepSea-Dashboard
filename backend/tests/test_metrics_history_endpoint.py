"""Tests for /api/metrics/history endpoint behavior and bounds."""

import time
from unittest.mock import AsyncMock

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.db import get_db, get_metric_history
from app.routers import metrics


@pytest_asyncio.fixture
async def test_db(monkeypatch):
    monkeypatch.setattr("app.config.get_wallet", lambda: "wallet-a")
    monkeypatch.setattr(metrics, "get_wallet", lambda: "wallet-a")
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await db.execute(
        """
        CREATE TABLE metric_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet TEXT NOT NULL DEFAULT 'wallet-a',
            timestamp REAL NOT NULL,
            hashrate_60sec REAL,
            hashrate_10min REAL,
            hashrate_3hr REAL,
            hashrate_24hr REAL,
            workers_hashing INTEGER,
            btc_price REAL,
            daily_mined_sats INTEGER,
            unpaid_earnings REAL
        )
        """
    )
    await db.commit()
    try:
        yield db
    finally:
        await db.close()


@pytest_asyncio.fixture
async def test_client(test_db):
    app = FastAPI()
    app.include_router(metrics.router, prefix="/api")

    async def _get_test_db():
        yield test_db

    app.dependency_overrides[get_db] = _get_test_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _insert_metric_row(now: float, hours_ago: float, hr60: float, hr3: float) -> tuple:
    return (
        now - (hours_ago * 3600),
        hr60,
        None,
        hr3,
        None,
        None,
        None,
        None,
        None,
    )


@pytest.mark.asyncio
async def test_metrics_history_empty_db_returns_empty_list(test_client):
    resp = await test_client.get("/api/metrics/history", params={"hours": 1})

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_metrics_history_returns_filtered_ordered_rows(test_db, test_client):
    now = time.time()
    rows = [
        _insert_metric_row(now, 2.0, 75.0, 80.0),
        _insert_metric_row(now, 0.5, 101.0, 110.0),
        _insert_metric_row(now, 0.25, 0.0, 0.0),  # valid stopped-mining data is retained
        _insert_metric_row(now, 0.1, 120.0, 130.0),
    ]

    await test_db.executemany(
        """
        INSERT INTO metric_history
        (timestamp, hashrate_60sec, hashrate_10min, hashrate_3hr, hashrate_24hr,
         workers_hashing, btc_price, daily_mined_sats, unpaid_earnings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    await test_db.commit()

    resp = await test_client.get("/api/metrics/history", params={"hours": 1})

    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 3
    assert payload[0]["hashrate_60sec"] == 101.0
    assert payload[1]["hashrate_60sec"] == 0.0
    assert payload[2]["hashrate_60sec"] == 120.0
    assert payload[0]["timestamp"] < payload[1]["timestamp"]


@pytest.mark.asyncio
async def test_metrics_history_hours_bounds_validation(test_db, test_client):
    now = time.time()
    await test_db.execute(
        """
        INSERT INTO metric_history
        (timestamp, hashrate_60sec, hashrate_10min, hashrate_3hr, hashrate_24hr,
         workers_hashing, btc_price, daily_mined_sats, unpaid_earnings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        _insert_metric_row(now, 167.0, 42.0, 84.0),
    )
    await test_db.commit()

    too_low = await test_client.get("/api/metrics/history", params={"hours": 0})
    assert too_low.status_code == 422

    too_high = await test_client.get("/api/metrics/history", params={"hours": 169})
    assert too_high.status_code == 422

    max_ok = await test_client.get("/api/metrics/history", params={"hours": 168})
    assert max_ok.status_code == 200
    payload = max_ok.json()
    assert len(payload) == 1
    assert payload[0]["hashrate_60sec"] == 42.0


@pytest.mark.asyncio
async def test_dense_history_endpoint_keeps_newest_sample_and_full_window(test_db, test_client):
    start = time.time() - 3550
    rows = [_insert_metric_row(start + index * 20, 0, 100.0, 200.0) for index in range(175)]
    rows[4] = _insert_metric_row(start + 80, 0, 5000.0, 200.0)
    rows[-3] = _insert_metric_row(start + 172 * 20, 0, 0.0, 6000.0)
    await test_db.executemany(
        """INSERT INTO metric_history
           (timestamp, hashrate_60sec, hashrate_10min, hashrate_3hr, hashrate_24hr,
            workers_hashing, btc_price, daily_mined_sats, unpaid_earnings)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    await test_db.commit()

    response = await test_client.get("/api/metrics/history", params={"hours": 1})

    assert response.status_code == 200
    result = response.json()
    assert len(result) <= 60
    assert result[0]["timestamp"] == rows[0][0]
    assert result[-1]["timestamp"] == rows[-1][0]
    assert max(point["hashrate_60sec"] for point in result) == 5000
    assert min(point["hashrate_60sec"] for point in result) == 0
    assert max(point["hashrate_3hr"] for point in result) == 6000
    assert all(point["gap_before"] is False for point in result)


@pytest.mark.asyncio
async def test_history_rejects_old_wallet_header_before_querying(test_client, monkeypatch):
    monkeypatch.setattr(metrics, "get_wallet", lambda: "wallet-b")
    query = AsyncMock()
    monkeypatch.setattr(metrics, "get_metric_history", query)

    response = await test_client.get("/api/metrics/history", headers={"X-DeepSea-Wallet": "wallet-a"})

    assert response.status_code == 409
    query.assert_not_awaited()


@pytest.mark.asyncio
async def test_history_pins_checked_wallet_when_config_changes_during_query(test_db, test_client, monkeypatch):
    now = time.time() - 30
    await test_db.executemany(
        "INSERT INTO metric_history(wallet, timestamp, hashrate_60sec, hashrate_3hr) VALUES (?, ?, ?, ?)",
        [("wallet-a", now, 100, 150), ("wallet-b", now, 900, 950)],
    )
    await test_db.commit()
    captured = []

    async def changing_config_query(db, **kwargs):
        captured.append(kwargs)
        monkeypatch.setattr(metrics, "get_wallet", lambda: "wallet-b")
        monkeypatch.setattr("app.config.get_wallet", lambda: "wallet-b")
        return await get_metric_history(db, **kwargs)

    monkeypatch.setattr(metrics, "get_metric_history", changing_config_query)
    response = await test_client.get("/api/metrics/history", headers={"X-DeepSea-Wallet": "wallet-a"})

    assert response.status_code == 200
    assert captured == [{"hours": 1, "limit": 60, "wallet": "wallet-a"}]
    assert [point["hashrate_60sec"] for point in response.json()] == [100]


@pytest.mark.asyncio
async def test_history_without_wallet_header_keeps_current_wallet_behavior(test_db, test_client, monkeypatch):
    now = time.time() - 30
    await test_db.executemany(
        "INSERT INTO metric_history(wallet, timestamp, hashrate_60sec, hashrate_3hr) VALUES (?, ?, ?, ?)",
        [("wallet-a", now, 100, 150), ("wallet-b", now, 900, 950)],
    )
    await test_db.commit()
    monkeypatch.setattr(metrics, "get_wallet", lambda: "wallet-b")

    response = await test_client.get("/api/metrics/history")

    assert response.status_code == 200
    assert [point["hashrate_60sec"] for point in response.json()] == [900]
