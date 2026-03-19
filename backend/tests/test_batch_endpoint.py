"""Tests for the /api/batch endpoint."""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_batch_empty_returns_result(client):
    """Empty batch returns empty responses list."""
    resp = await client.post("/api/batch", json={"requests": []})
    assert resp.status_code == 200
    data = resp.json()
    assert data["responses"] == []
    assert data["executed"] == 0
    assert "duration_ms" in data


@pytest.mark.asyncio
async def test_batch_health_endpoint(client):
    """Batch with health check returns 200."""
    resp = await client.post(
        "/api/batch",
        json={"requests": [{"method": "GET", "path": "/api/health"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["executed"] == 1
    assert data["responses"][0]["status"] == 200
    assert "status" in data["responses"][0]["body"]


@pytest.mark.asyncio
async def test_batch_multiple_requests(client):
    """Batch executes multiple requests and returns all responses."""
    resp = await client.post(
        "/api/batch",
        json={
            "requests": [
                {"method": "GET", "path": "/api/health"},
                {"method": "GET", "path": "/api/metrics"},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["executed"] == 2
    assert len(data["responses"]) == 2


@pytest.mark.asyncio
async def test_batch_non_get_method_returns_405(client):
    """Non-GET methods in batch return 405."""
    resp = await client.post(
        "/api/batch",
        json={"requests": [{"method": "POST", "path": "/api/metrics"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["responses"][0]["status"] == 405


@pytest.mark.asyncio
async def test_batch_limit_exceeded(client):
    """Batch rejects more than 10 requests."""
    requests = [{"method": "GET", "path": "/api/health"}] * 11
    resp = await client.post("/api/batch", json={"requests": requests})
    # Should be rejected - either 400 or 422 (validation)
    assert resp.status_code in (400, 422)


@pytest.mark.asyncio
async def test_batch_invalid_path_returns_non_error_top_level(client):
    """Batch with invalid path returns sub-response (not top-level error).

    Note: If the SPA fallback is active, unknown paths return 200 with HTML.
    The key contract is that the batch endpoint itself succeeds (200) and
    the sub-response is captured — whether 404 or 200 (SPA fallback).
    """
    resp = await client.post(
        "/api/batch",
        json={"requests": [{"method": "GET", "path": "/api/nonexistent-endpoint"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["executed"] == 1
    # Sub-response captured (status could be 404 or 200 depending on SPA fallback)
    assert data["responses"][0]["status"] in (200, 404)


@pytest.mark.asyncio
async def test_batch_rejects_stream_path(client):
    """Batch rejects streaming endpoint to avoid hanging sub-requests."""
    resp = await client.post(
        "/api/batch",
        json={"requests": [{"method": "GET", "path": "/api/stream"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["responses"][0]["status"] == 400


@pytest.mark.asyncio
async def test_batch_duration_ms_present(client):
    """Batch response includes duration_ms."""
    resp = await client.post(
        "/api/batch",
        json={"requests": [{"method": "GET", "path": "/api/health"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["duration_ms"], (int, float))
    assert data["duration_ms"] >= 0
