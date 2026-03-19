"""Tests for /api/metrics/history endpoint behavior and bounds."""

import time

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.db import get_db
from app.routers import metrics


@pytest_asyncio.fixture
async def test_db():
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await db.execute(
        """
        CREATE TABLE metric_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        _insert_metric_row(now, 0.25, 0.0, 0.0),  # filtered out by endpoint query
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
    assert len(payload) == 2
    assert payload[0]["hashrate_60sec"] == 101.0
    assert payload[1]["hashrate_60sec"] == 120.0
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
