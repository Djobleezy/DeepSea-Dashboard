"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import background
from app.db import init_db
from app.routers import (
    blocks,
    config_routes,
    earnings,
    health,
    metrics,
    notifications,
    workers,
)
from app.services.cache import init_cache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

_bg_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bg_task
    # Initialize DB and cache
    await init_db()
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379")
    await init_cache(redis_url)

    # Start background refresh loop
    _bg_task = asyncio.create_task(background.background_loop())

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

# Serve built frontend (if present) with SPA fallback
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    _index_html = _frontend_dist / "index.html"

    # SPA catch-all: any non-API path that isn't a real file → index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        from fastapi.responses import FileResponse
        static_file = _frontend_dist / full_path
        if full_path and static_file.exists() and static_file.is_file():
            return FileResponse(str(static_file))
        return FileResponse(str(_index_html))
