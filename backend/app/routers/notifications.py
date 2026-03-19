"""Notification CRUD endpoints."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

import aiosqlite

from app.db import (
    clear_all_notifications,
    clear_read_notifications,
    create_notification,
    delete_notification,
    get_db,
    list_notifications,
    mark_all_read,
    mark_notification_read,
)
from app.models import Notification, NotificationCreate

router = APIRouter()


@router.get("/notifications", response_model=list[Notification], tags=["notifications"])
async def get_notifications(
    category: str = Query(default="all", description="Filter by category: all, block, hashrate, worker, payout, daily"),
    unread_only: bool = Query(default=False, description="Return only unread notifications"),
    limit: int = Query(default=100, ge=1, le=500, description="Max results (1–500)"),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[Notification]:
    """List notifications with optional category and read-state filtering."""
    rows = await list_notifications(db, category=category, unread_only=unread_only, limit=limit)
    return [Notification(**r) for r in rows]


@router.post("/notifications", response_model=Notification, status_code=201, tags=["notifications"])
async def post_notification(
    payload: NotificationCreate,
    db: aiosqlite.Connection = Depends(get_db),
) -> Notification:
    """Create a new notification."""
    row = await create_notification(
        db,
        message=payload.message,
        category=payload.category.value,
        level=payload.level.value,
        is_block=payload.is_block,
        metadata=payload.metadata,
    )
    return Notification(**row)


@router.patch("/notifications/{nid}/read", response_model=dict, tags=["notifications"])
async def read_notification(nid: str, db: aiosqlite.Connection = Depends(get_db)) -> dict[str, Any]:
    """Mark a single notification as read."""
    updated = await mark_notification_read(db, nid)
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/notifications/read-all", response_model=dict, tags=["notifications"])
async def read_all(db: aiosqlite.Connection = Depends(get_db)) -> dict[str, Any]:
    """Mark all notifications as read."""
    count = await mark_all_read(db)
    return {"marked_read": count}


@router.delete("/notifications/{nid}", response_model=dict, tags=["notifications"])
async def delete_one(nid: str, db: aiosqlite.Connection = Depends(get_db)) -> dict[str, Any]:
    """Delete a single notification. Block notifications cannot be deleted individually."""
    ok = await delete_notification(db, nid)
    if ok is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not ok:
        raise HTTPException(status_code=403, detail="Block notifications cannot be deleted individually")
    return {"ok": True}


@router.delete("/notifications/clear/read", response_model=dict, tags=["notifications"])
async def clear_read(db: aiosqlite.Connection = Depends(get_db)) -> dict[str, Any]:
    """Delete all read notifications."""
    count = await clear_read_notifications(db)
    return {"cleared": count}


@router.delete("/notifications/clear/all", response_model=dict, tags=["notifications"])
async def clear_all(db: aiosqlite.Connection = Depends(get_db)) -> dict[str, Any]:
    """Delete all notifications regardless of read state."""
    count = await clear_all_notifications(db)
    return {"cleared": count}
