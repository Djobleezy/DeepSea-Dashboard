"""Metrics and SSE stream endpoints."""

from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app import background
from app.models import DashboardMetrics
from app.services.cache import cache_get

router = APIRouter()


@router.get("/metrics", response_model=DashboardMetrics)
async def get_metrics() -> DashboardMetrics:
    """Return the latest cached metrics snapshot."""
    cached = await cache_get(background.get_cache_key("metrics"))
    if cached:
        return DashboardMetrics(**cached)
    # Return defaults if not yet populated
    live = background.get_current_metrics()
    if live:
        return DashboardMetrics(**live)
    return DashboardMetrics(server_timestamp=time.time())


@router.get("/stream")
async def metrics_stream(request: Request) -> EventSourceResponse:
    """SSE endpoint — streams metrics + worker updates in real-time."""

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
