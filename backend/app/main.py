"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app import background
from app.db import init_db
from app.logging_config import configure_logging, get_request_middleware, log_startup_banner
from app.routers import (
    batch,
    blocks,
    client_errors,
    config_routes,
    earnings,
    exchange,
    health,
    metrics,
    notifications,
    workers,
)
from app.services.cache import init_cache, is_redis_connected

# Configure structured logging before anything else
configure_logging()

_bg_task: asyncio.Task | None = None
_log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bg_task
    # Initialize DB and cache
    await init_db()
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379")
    await init_cache(redis_url)

    # Start background refresh loop
    _bg_task = asyncio.create_task(background.background_loop())

    # Emit startup banner after services are initialised
    from app.config import get_wallet
    log_startup_banner(
        version="2.0.0",
        wallet_configured=bool(get_wallet()),
        redis_connected=await is_redis_connected(),
    )

    yield

    # Cleanup on shutdown
    if _bg_task:
        _bg_task.cancel()
        try:
            await _bg_task
        except asyncio.CancelledError:
            pass

    if background._client:
        await background._client.close()


app = FastAPI(
    title="DeepSea Dashboard API",
    version="2.0.0",
    description="Ocean.xyz mining monitoring dashboard",
    lifespan=lifespan,
)

# Simple in-process API rate limiting (per client IP, fixed 60s window).
_RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "120"))
_rate_limit_hits: dict[str, deque[float]] = defaultdict(deque)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if _RATE_LIMIT_PER_MIN > 0 and request.url.path.startswith("/api") and request.url.path != "/api/health":
        client_ip = request.client.host if request.client else "unknown"
        key = f"{client_ip}:{request.url.path}"
        now = time.time()
        window = _rate_limit_hits[key]

        while window and now - window[0] > 60.0:
            window.popleft()

        if len(window) >= _RATE_LIMIT_PER_MIN:
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"},
                headers={"Retry-After": "60"},
            )

        window.append(now)

    return await call_next(request)


# Request logging middleware (logs method, path, status, duration_ms at DEBUG level)
app.middleware("http")(get_request_middleware())

# CORS — configurable via CORS_ORIGINS (comma-separated)
# Default is permissive for local/dev but does not claim credentialed wildcard support.
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
_allow_credentials = "*" not in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
api_prefix = "/api"
app.include_router(health.router, prefix=api_prefix, tags=["health"])
app.include_router(metrics.router, prefix=api_prefix, tags=["metrics"])
app.include_router(workers.router, prefix=api_prefix, tags=["workers"])
app.include_router(blocks.router, prefix=api_prefix, tags=["blocks"])
app.include_router(earnings.router, prefix=api_prefix, tags=["earnings"])
app.include_router(notifications.router, prefix=api_prefix, tags=["notifications"])
app.include_router(config_routes.router, prefix=api_prefix, tags=["config"])
app.include_router(exchange.router, prefix=api_prefix, tags=["exchange"])
app.include_router(client_errors.router, prefix=api_prefix, tags=["client-errors"])
app.include_router(batch.router, prefix=api_prefix, tags=["system"])

# Serve built frontend (if present) with SPA fallback
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    _index_html = _frontend_dist / "index.html"

    # Paths that FastAPI handles natively — must NOT be caught by the SPA fallback.
    # Without this guard the catch-all swallows /docs, /redoc, and /openapi.json before
    # FastAPI's own routing can serve them.
    _API_DOC_PATHS = {"docs", "redoc", "openapi.json"}

    # SPA catch-all: any non-API path that isn't a real file → index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        from fastapi.responses import FileResponse

        # Let FastAPI serve its built-in API documentation endpoints.
        if full_path in _API_DOC_PATHS:
            raise HTTPException(status_code=404, detail="Not found")

        dist_root = _frontend_dist.resolve()
        requested = (dist_root / full_path).resolve()

        # Prevent path traversal outside frontend/dist.
        if full_path and not requested.is_relative_to(dist_root):
            raise HTTPException(status_code=404, detail="Not found")

        if full_path and requested.exists() and requested.is_file():
            return FileResponse(str(requested))
        return FileResponse(str(_index_html))
