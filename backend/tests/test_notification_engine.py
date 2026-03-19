"""Tests for the notification engine.

Covers block detection, cooldown enforcement, and state persistence across
simulated process restarts.
"""

from __future__ import annotations

import time

import aiosqlite
import pytest
import pytest_asyncio

from app.services import notification_engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_schema(conn: aiosqlite.Connection) -> None:
    """Create the minimal tables required by the notification engine."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
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
        CREATE TABLE IF NOT EXISTS alert_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
    """)
    await conn.commit()


@pytest_asyncio.fixture
async def db():
    """In-memory SQLite with schema for notification engine tests."""
    async with aiosqlite.connect(":memory:") as conn:
        conn.row_factory = aiosqlite.Row
        await _create_schema(conn)
        # Reset module-level state before each test
        notification_engine._prev_state.clear()
        notification_engine._state_loaded = False
        yield conn


# ---------------------------------------------------------------------------
# Block detection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_block_notification_only_fires_for_increasing_height(db):
    # Baseline sample — no prev_state, nothing fires
    fired = await notification_engine.check_and_fire(
        db,
        {"hashrate_3hr": 10.0, "workers_hashing": 5, "last_block_height": 900_000},
    )
    assert fired == []

    # Height rollback should not be treated as "new block"
    fired = await notification_engine.check_and_fire(
        db,
        {"hashrate_3hr": 10.0, "workers_hashing": 5, "last_block_height": 899_999},
    )
    assert all(n["category"] != "block" for n in fired)

    # Increase should fire block notification
    fired = await notification_engine.check_and_fire(
        db,
        {"hashrate_3hr": 10.0, "workers_hashing": 5, "last_block_height": 900_001},
    )
    assert any(n["category"] == "block" for n in fired)


@pytest.mark.asyncio
async def test_block_fires_each_new_block(db):
    """Block notifications fire for every increment, no cooldown applies."""
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 10.0, "workers_hashing": 2, "last_block_height": 1000}
    )
    assert fired == []

    for height in [1001, 1002, 1003]:
        fired = await notification_engine.check_and_fire(
            db, {"hashrate_3hr": 10.0, "workers_hashing": 2, "last_block_height": height}
        )
        assert any(n["category"] == "block" for n in fired), (
            f"Block alert missing at height {height}"
        )


# ---------------------------------------------------------------------------
# Cooldown enforcement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_hashrate_cooldown_suppresses_repeat_alert(db):
    """A second hashrate drop within the cooldown window must not fire."""
    # Baseline
    await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 100.0, "workers_hashing": 4, "last_block_height": None}
    )

    # First drop — should fire
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert any(n["category"] == "hashrate" for n in fired)

    # Second drop within cooldown window — must be suppressed
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 30.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert all(n["category"] != "hashrate" for n in fired)


@pytest.mark.asyncio
async def test_hashrate_alert_fires_after_cooldown_expires(db):
    """After the cooldown expires the alert should fire again."""
    await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 100.0, "workers_hashing": 4, "last_block_height": None}
    )

    # First drop fires
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert any(n["category"] == "hashrate" for n in fired)

    # Manually backdate the last-fired timestamp past the cooldown window
    notification_engine._prev_state["last_fired_hashrate"] = (
        time.time() - notification_engine.COOLDOWN_SECONDS["hashrate"] - 1
    )

    # Another drop should now fire
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 30.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert any(n["category"] == "hashrate" for n in fired)


@pytest.mark.asyncio
async def test_worker_cooldown_suppresses_repeat_alert(db):
    """Repeated worker-offline events within cooldown are suppressed."""
    await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 10.0, "workers_hashing": 5, "last_block_height": None}
    )

    # First worker loss — fires
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 10.0, "workers_hashing": 3, "last_block_height": None}
    )
    assert any(n["category"] == "worker" for n in fired)

    # Second worker loss within cooldown — suppressed
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 10.0, "workers_hashing": 1, "last_block_height": None}
    )
    assert all(n["category"] != "worker" for n in fired)


# ---------------------------------------------------------------------------
# State persistence across simulated restarts
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_state_persists_across_restart(db):
    """After a simulated restart, alert state loaded from DB prevents false alerts."""
    # Prime state: set baseline then trigger a drop
    await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 100.0, "workers_hashing": 4, "last_block_height": 5000}
    )
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": 5000}
    )
    assert any(n["category"] == "hashrate" for n in fired)

    # Simulate restart: wipe in-process state and flag
    notification_engine._prev_state.clear()
    notification_engine._state_loaded = False

    # After restart, with the same hashrate value the engine should NOT fire
    # an alert (it loaded prev=60.0 from DB, curr=60.0 → no change)
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": 5000}
    )
    assert all(n["category"] != "hashrate" for n in fired)


@pytest.mark.asyncio
async def test_cooldown_persists_across_restart(db):
    """Cooldown timestamps loaded from DB are honoured after a restart."""
    await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 100.0, "workers_hashing": 4, "last_block_height": None}
    )
    # Trigger a drop — records cooldown in DB
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert any(n["category"] == "hashrate" for n in fired)

    # Simulate restart
    notification_engine._prev_state.clear()
    notification_engine._state_loaded = False

    # Further drop — cooldown loaded from DB should still suppress this
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 30.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert all(n["category"] != "hashrate" for n in fired)


@pytest.mark.asyncio
async def test_invalid_cooldown_state_does_not_crash_engine(db):
    """Bad persisted cooldown values should be ignored, not crash refresh."""
    from app.db import set_alert_state

    await set_alert_state(db, "hashrate_3hr", 100.0)
    await set_alert_state(db, "workers_hashing", 4)
    await set_alert_state(db, "last_fired_hashrate", "not-a-number")

    notification_engine._prev_state.clear()
    notification_engine._state_loaded = False

    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 60.0, "workers_hashing": 4, "last_block_height": None}
    )
    assert any(n["category"] == "hashrate" for n in fired)


@pytest.mark.asyncio
async def test_no_false_positive_on_first_run_after_restart(db):
    """On first call after restart with prev state in DB, no spurious alerts fire."""
    # Directly inject persisted state as if a prior run left it
    from app.db import set_alert_state
    await set_alert_state(db, "hashrate_3hr", 80.0)
    await set_alert_state(db, "workers_hashing", 4)
    await set_alert_state(db, "last_block_height", 7500)

    notification_engine._prev_state.clear()
    notification_engine._state_loaded = False

    # Metrics are essentially unchanged — no alerts expected
    fired = await notification_engine.check_and_fire(
        db, {"hashrate_3hr": 80.0, "workers_hashing": 4, "last_block_height": 7500}
    )
    assert fired == []
