"""Metrics and SSE stream endpoints."""

from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncGenerator

import aiosqlite
from fastapi import APIRouter, Depends, Query, Request
from sse_starlette.sse import EventSourceResponse

from app import background
from app.config import get_wallet
from app.db import get_db, get_metric_history
from app.models import DashboardMetrics
from app.services.cache import cache_get

router = APIRouter()


@router.get("/metrics/history", response_model=list[dict], tags=["metrics"])
async def metrics_history(
    hours: int = Query(default=1, ge=1, le=168, description="Hours of history (max 7 days)"),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[dict]:
    """Return historical metric snapshots for chart hydration on page load.

    Queries wallet-scoped SQLite history over 1–168 hours. Dense windows
    retain both series' extrema and their first/latest samples within a
    bounded payload. ``gap_before`` marks a real interruption in the original
    readings; clients must not infer outages from downsampled point spacing.
    Returns an empty list if no valid history has been collected yet.
    """
    return await get_metric_history(db, hours=hours, limit=hours * 60)


@router.get("/metrics", response_model=DashboardMetrics, tags=["metrics"])
async def get_metrics() -> DashboardMetrics:
    """Return the latest cached mining metrics snapshot.

    Data is sourced from the Ocean.xyz API and refreshed every 60 seconds by
    the background loop. Returns safe zero-value defaults if no data has been
    collected yet (e.g., on first startup or unconfigured wallet).
    """
    wallet = get_wallet().strip()
    live = background.get_current_metrics()
    if live is not None:
        return DashboardMetrics(**live)
    cached = await cache_get(background.get_cache_key("metrics")) if wallet else None
    if cached and cached.get("wallet", wallet) == wallet:
        snapshot = dict(cached)
        updated_at = snapshot.get("data_updated_at") or snapshot.get("server_timestamp")
        snapshot.update(wallet=wallet, data_updated_at=updated_at, server_timestamp=time.time())
        if not updated_at or time.time() - updated_at > 120:
            snapshot.update(data_status="stale", data_error="Mining data has not refreshed recently")
        return DashboardMetrics(**snapshot)
    return DashboardMetrics(wallet=wallet, data_status="unavailable" if wallet else "unconfigured")


@router.get("/stream", tags=["metrics"])
async def metrics_stream(request: Request) -> EventSourceResponse:
    """Server-Sent Events stream — pushes live metrics and worker updates.

    Emits ``metrics`` and ``workers`` events whenever the background loop
    produces new data. Sends a ``heartbeat`` event every 30s to keep the
    connection alive through proxies. Automatically unsubscribes on
    client disconnect.

    Event types: ``metrics`` | ``workers`` | ``heartbeat``
    """

    async def event_generator() -> AsyncGenerator[dict, None]:
        q = background.subscribe()
        try:
            # Send current state immediately on connect
            metrics = background.get_current_metrics()
            if metrics:
                yield {"event": "metrics", "data": json.dumps(metrics, default=str)}
            workers = background.get_current_workers()
            if workers:
                yield {"event": "workers", "data": json.dumps(workers, default=str)}

            # Stream future updates
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield {
                        "event": event["type"],
                        "data": json.dumps(event["data"], default=str),
                    }
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    # Heartbeat to keep connection alive
                    yield {"event": "heartbeat", "data": json.dumps({"ts": time.time()})}
        finally:
            background.unsubscribe(q)

    return EventSourceResponse(event_generator())
