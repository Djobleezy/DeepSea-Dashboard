"""Batch API endpoint — execute multiple API requests in a single HTTP call."""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)

router = APIRouter()

MAX_BATCH_REQUESTS = 10


class BatchRequest(BaseModel):
    """A single request within a batch."""
    method: str = Field(default="GET", description="HTTP method (GET only supported in batch)")
    path: str = Field(description="API path e.g. /api/metrics")


class BatchPayload(BaseModel):
    """Batch request payload."""
    requests: list[BatchRequest] = Field(
        description="List of requests to execute (max 10)",
        max_length=MAX_BATCH_REQUESTS,
    )


class BatchResponse(BaseModel):
    """A single response within a batch result."""
    status: int
    body: Any


class BatchResult(BaseModel):
    """Batch endpoint response."""
    responses: list[BatchResponse]
    executed: int
    duration_ms: float


@router.post("/batch", response_model=BatchResult, tags=["system"])
async def batch_requests(payload: BatchPayload, request: Request) -> BatchResult:
    """Execute multiple API GET requests in a single HTTP call.

    Accepts up to 10 requests, executes them internally using the ASGI app,
    and returns all responses. If batch size exceeds the limit, returns 400.

    This is a performance optimization for pages that need multiple data sources
    on initial load — e.g., Dashboard loads metrics + workers + blocks simultaneously.

    Fallback: individual endpoints remain fully functional if batch is unavailable.
    """
    t0 = time.perf_counter()

    if len(payload.requests) > MAX_BATCH_REQUESTS:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=400,
            content={"detail": f"Batch limit is {MAX_BATCH_REQUESTS} requests"},
        )

    app = request.app
    responses: list[BatchResponse] = []

    for req in payload.requests:
        path = req.path
        try:
            from httpx import AsyncClient, ASGITransport
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
                # Only GET supported in batch (safe reads only)
                if req.method.upper() != "GET":
                    responses.append(BatchResponse(status=405, body={"detail": "Only GET requests supported in batch"}))
                    continue

                # Copy relevant headers from original request
                headers = {}
                if "authorization" in request.headers:
                    headers["authorization"] = request.headers["authorization"]

                resp = await client.get(path, headers=headers, follow_redirects=True)
                try:
                    body = resp.json()
                except Exception:
                    body = resp.text
                responses.append(BatchResponse(status=resp.status_code, body=body))
        except Exception as e:
            _log.warning("Batch sub-request failed for %s: %s", path, e)
            responses.append(BatchResponse(status=500, body={"detail": str(e)}))

    duration_ms = (time.perf_counter() - t0) * 1000

    return BatchResult(
        responses=responses,
        executed=len(responses),
        duration_ms=round(duration_ms, 2),
    )
