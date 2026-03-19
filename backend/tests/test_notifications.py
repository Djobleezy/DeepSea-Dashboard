"""Tests for notification DB functions."""

import pytest
import pytest_asyncio
import aiosqlite

from app.db import (
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
