"""Tests for notification DB functions."""

import pytest
import pytest_asyncio
import aiosqlite

from app.db import (
    clear_all_notifications,
    clear_read_notifications,
    create_notification,
    delete_notification,
    list_notifications,
    mark_all_read,
    mark_notification_read,
)


@pytest_asyncio.fixture
async def db():
    """In-memory SQLite for testing."""
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
async def test_create_notification(db):
    n = await create_notification(db, "test message", "system", "info")
    assert n["message"] == "test message"
    assert n["read"] is False
    assert n["is_block"] is False


@pytest.mark.asyncio
async def test_list_notifications(db):
    await create_notification(db, "msg1", "hashrate", "warning")
    await create_notification(db, "msg2", "block", "success", is_block=True)
    all_notifs = await list_notifications(db)
    assert len(all_notifs) == 2

    block_only = await list_notifications(db, category="block")
    assert len(block_only) == 1
    assert block_only[0]["is_block"] is True


@pytest.mark.asyncio
async def test_mark_read(db):
    n = await create_notification(db, "hello", "system", "info")
    await mark_notification_read(db, n["id"])
    rows = await list_notifications(db, unread_only=True)
    assert len(rows) == 0


@pytest.mark.asyncio
async def test_mark_all_read(db):
    await create_notification(db, "a", "system", "info")
    await create_notification(db, "b", "system", "info")
    count = await mark_all_read(db)
    assert count == 2
    rows = await list_notifications(db, unread_only=True)
    assert len(rows) == 0


@pytest.mark.asyncio
async def test_delete_notification(db):
    n = await create_notification(db, "deletable", "system", "info")
    result = await delete_notification(db, n["id"])
    assert result is True
    rows = await list_notifications(db)
    assert len(rows) == 0


@pytest.mark.asyncio
async def test_cannot_delete_block_notification(db):
    n = await create_notification(db, "block!", "block", "success", is_block=True)
    result = await delete_notification(db, n["id"])
    assert result is False
    rows = await list_notifications(db)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_clear_read_preserves_unread_and_block_notifications(db):
    unread = await create_notification(db, "keep me", "system", "info")
    read_delete = await create_notification(db, "delete me", "system", "info")
    read_block = await create_notification(db, "keep block", "block", "success", is_block=True)

    await mark_notification_read(db, read_delete["id"])
    await mark_notification_read(db, read_block["id"])

    cleared = await clear_read_notifications(db)
    assert cleared == 1

    rows = await list_notifications(db)
    ids = {row["id"] for row in rows}
    assert unread["id"] in ids
    assert read_block["id"] in ids
    assert read_delete["id"] not in ids


@pytest.mark.asyncio
async def test_clear_all_preserves_block_notifications(db):
    normal = await create_notification(db, "normal", "system", "info")
    block = await create_notification(db, "block", "block", "success", is_block=True)

    cleared = await clear_all_notifications(db)
    assert cleared == 1

    rows = await list_notifications(db)
    ids = {row["id"] for row in rows}
    assert block["id"] in ids
    assert normal["id"] not in ids
