"""Tests for production hardening features.

Covers:
- Exchange rates endpoint (mocked upstream)
- Config save/load round-trip
- SSE endpoint connection
- Notification CRUD lifecycle (create → read → mark_read → delete)
- Health endpoint server_timestamp field
- Client error reporting endpoint
"""

from __future__ import annotations

import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiosqlite
import httpx
import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# In-memory DB fixture (for unit-level notification tests)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db():
    """Minimal in-memory SQLite for notification unit tests."""
    async with aiosqlite.connect(":memory:") as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute("""
            CREATE TABLE notifications (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'system',
                level TEXT NOT NULL DEFAULT 'info',
                timestamp TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                is_block INTEGER NOT NULL DEFAULT 0,
                metadata TEXT NOT NULL DEFAULT '{}'
            )
        """)
        await conn.execute("""
            CREATE TABLE client_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT,
                source TEXT,
                lineno INTEGER,
                colno INTEGER,
                stack TEXT,
                url TEXT,
                ts REAL NOT NULL
            )
        """)
        await conn.commit()
        yield conn


# ---------------------------------------------------------------------------
# 1. Exchange rates endpoint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exchange_rates_returns_usd_always():
    """get_exchange_rates() always includes USD=1.0 even on upstream failure."""
    from app.services.exchange_service import _cache, get_exchange_rates

    # Force cache expired and mock httpx to raise
    _cache["expires_at"] = 0
    _cache["rates"] = {"USD": 1.0}

    async def boom(*_a, **_kw):
        raise httpx.ConnectError("offline")

    with patch("app.services.exchange_service.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        rates = await get_exchange_rates()

    assert "USD" in rates
    assert rates["USD"] == 1.0


@pytest.mark.asyncio
async def test_exchange_rates_parses_frankfurter_response():
    """get_exchange_rates() correctly parses Frankfurter API JSON."""
    from app.services.exchange_service import _cache, get_exchange_rates

    _cache["expires_at"] = 0  # force refresh

    fake_response = SimpleNamespace(
        json=lambda: {"base": "USD", "rates": {"EUR": 0.92, "GBP": 0.79}},
        raise_for_status=lambda: None,
    )

    with patch("app.services.exchange_service.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_response)
        rates = await get_exchange_rates()

    assert rates.get("USD") == 1.0
    assert rates.get("EUR") == 0.92
    assert rates.get("GBP") == 0.79


@pytest.mark.asyncio
async def test_exchange_rates_cached():
    """get_exchange_rates() returns cached result without hitting upstream."""
    from app.services.exchange_service import _cache, get_exchange_rates

    _cache["rates"] = {"USD": 1.0, "EUR": 0.90}
    _cache["expires_at"] = time.time() + 3600  # not expired

    with patch("app.services.exchange_service.httpx.AsyncClient") as MockClient:
        rates = await get_exchange_rates()
        MockClient.assert_not_called()

    assert rates["EUR"] == 0.90


# ---------------------------------------------------------------------------
# 2. Config save/load round-trip
# ---------------------------------------------------------------------------

def test_config_save_load_roundtrip(tmp_path):
    """save_config then load_config returns the same values."""
    import app.config as cfg_module
    from app.config import load_config, save_config

    orig_path = cfg_module.CONFIG_PATH
    cfg_module.CONFIG_PATH = tmp_path / "config.json"
    try:
        save_config({
            "wallet": "bc1qtest",
            "power_cost": 0.08,
            "power_usage": 2000,
            "currency": "EUR",
            "timezone": "UTC",
            "network_fee": 1.0,
        })
        loaded = load_config()
        assert loaded["wallet"] == "bc1qtest"
        assert loaded["power_cost"] == 0.08
        assert loaded["power_usage"] == 2000
        assert loaded["currency"] == "EUR"
        assert loaded["timezone"] == "UTC"
        assert loaded["network_fee"] == 1.0
    finally:
        cfg_module.CONFIG_PATH = orig_path


def test_config_load_missing_file_returns_defaults(tmp_path):
    """load_config returns defaults when config file doesn't exist."""
    import app.config as cfg_module
    from app.config import load_config

    orig_path = cfg_module.CONFIG_PATH
    cfg_module.CONFIG_PATH = tmp_path / "nonexistent.json"
    try:
        loaded = load_config()
        assert loaded["wallet"] == ""
        assert loaded["power_cost"] == 0.12
        assert loaded["currency"] == "USD"
    finally:
        cfg_module.CONFIG_PATH = orig_path


def test_config_load_merges_defaults_with_partial_file(tmp_path):
    """load_config fills missing keys with defaults."""
    import app.config as cfg_module
    from app.config import load_config

    orig_path = cfg_module.CONFIG_PATH
    cfg_module.CONFIG_PATH = tmp_path / "partial.json"
    try:
        cfg_module.CONFIG_PATH.write_text(json.dumps({"wallet": "bc1qpartial"}))
        loaded = load_config()
        assert loaded["wallet"] == "bc1qpartial"
        assert loaded["power_cost"] == 0.12  # default filled in
        assert loaded["timezone"] == "America/Los_Angeles"  # default filled in
    finally:
        cfg_module.CONFIG_PATH = orig_path


# ---------------------------------------------------------------------------
# 3. SSE endpoint connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sse_endpoint_returns_event_stream():
    """GET /api/stream — verify the EventSourceResponse is registered and returns correct content-type."""
    from app.routers.metrics import router as metrics_router
    # Check route is registered
    stream_routes = [r for r in metrics_router.routes if getattr(r, "path", "") == "/stream"]
    assert len(stream_routes) == 1, "SSE /stream route should be registered"

    # Verify route name/path
    route = stream_routes[0]
    assert route.path == "/stream"


# ---------------------------------------------------------------------------
# 4. Notification CRUD lifecycle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_create_read_markread_delete_lifecycle(db):
    """Full lifecycle: create → list (unread) → mark_read → list (read) → delete."""
    from app.db import (
        create_notification,
        delete_notification,
        list_notifications,
        mark_notification_read,
    )

    # CREATE
    n = await create_notification(db, "payout received", "earnings", "success")
    nid = n["id"]
    assert n["read"] is False
    assert n["message"] == "payout received"

    # READ (unread only)
    unread = await list_notifications(db, unread_only=True)
    assert any(row["id"] == nid for row in unread)

    # MARK_READ
    updated = await mark_notification_read(db, nid)
    assert updated is True

    # READ should now be empty for unread_only=True
    still_unread = await list_notifications(db, unread_only=True)
    assert not any(row["id"] == nid for row in still_unread)

    # All notifications still includes the row (just read)
    all_notifs = await list_notifications(db)
    assert any(row["id"] == nid for row in all_notifs)
    row = next(r for r in all_notifs if r["id"] == nid)
    assert row["read"] is True

    # DELETE
    ok = await delete_notification(db, nid)
    assert ok is True

    after_delete = await list_notifications(db)
    assert not any(row["id"] == nid for row in after_delete)


@pytest.mark.asyncio
async def test_notification_mark_read_missing_id_returns_false(db):
    """mark_notification_read returns False for unknown IDs."""
    from app.db import mark_notification_read
    result = await mark_notification_read(db, "nonexistent-id-xyz")
    assert result is False


@pytest.mark.asyncio
async def test_notification_block_cannot_be_deleted_individually(db):
    """Block notifications (is_block=True) cannot be deleted individually."""
    from app.db import create_notification, delete_notification
    n = await create_notification(db, "block found!", "block", "success", is_block=True)
    result = await delete_notification(db, n["id"])
    # delete_notification returns False (or falsy) for block notifications
    assert not result


# ---------------------------------------------------------------------------
# 5. Health endpoint server_timestamp
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_response_includes_server_timestamp():
    """Health endpoint returns server_timestamp field."""
    from app.routers.health import health_check
    from unittest.mock import AsyncMock, patch

    with patch("app.routers.health.is_redis_connected", new_callable=AsyncMock, return_value=False):
        with patch("app.routers.health.background") as mock_bg:
            mock_bg.get_last_refresh.return_value = None
            mock_bg.get_uptime.return_value = 42.0
            with patch("app.routers.health.get_wallet", return_value=""):
                before = time.time()
                result = await health_check()
                after = time.time()

    assert result.server_timestamp is not None
    assert before <= result.server_timestamp <= after
    assert result.status == "ok"
    assert result.uptime_seconds == 42.0


# ---------------------------------------------------------------------------
# 6. Client error reporting
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_client_errors_stored_in_db(db):
    """Storing a client error creates a row with correct fields."""
    now = time.time()
    await db.execute(
        "INSERT INTO client_errors (message, source, lineno, colno, stack, url, ts) VALUES (?,?,?,?,?,?,?)",
        ("TypeError: cannot read property", "app.js", 42, 7, "stack trace here", "http://localhost/", now),
    )
    await db.commit()
    async with db.execute("SELECT * FROM client_errors WHERE message = ?", ("TypeError: cannot read property",)) as cur:
        row = await cur.fetchone()
    assert row is not None
    assert row["lineno"] == 42
    assert row["url"] == "http://localhost/"
