import pytest
import pytest_asyncio
import aiosqlite

from app.services import notification_engine


@pytest_asyncio.fixture
async def db():
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
        await conn.commit()
        yield conn


@pytest.mark.asyncio
async def test_block_notification_only_fires_for_increasing_height(db):
    notification_engine._prev_state.clear()

    # Baseline sample
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
