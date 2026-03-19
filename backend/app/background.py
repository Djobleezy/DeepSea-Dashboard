"""Single asyncio background refresh loop — replaces APScheduler."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import aiosqlite

from app.config import get_wallet
from app.db import DB_PATH, _configure_connection, save_metric_snapshot
from app.models import DashboardMetrics, WorkerSummary
from app.services.cache import cache_delete, cache_set
from app.services.metrics_service import fetch_full_metrics
from app.services.notification_engine import check_and_fire
from app.services.ocean_client import OceanClient

_log = logging.getLogger(__name__)

REFRESH_INTERVAL = 60  # seconds
_started_at: float = time.time()
_last_refresh: Optional[float] = None
_current_metrics: Optional[dict] = None
_current_workers: Optional[dict] = None
_subscribers: list[asyncio.Queue] = []
_cache_scope: Optional[str] = None

_client: Optional[OceanClient] = None


def get_uptime() -> float:
    return time.time() - _started_at


def get_last_refresh() -> Optional[float]:
    return _last_refresh


def get_current_metrics() -> Optional[dict]:
    return _current_metrics


def get_current_workers() -> Optional[dict]:
    return _current_workers


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=10)
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


def _broadcast(event: dict) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # slow consumer, skip


def get_cache_key(name: str, wallet: str | None = None) -> str:
    scoped_wallet = (wallet or get_wallet() or "no-wallet").strip() or "no-wallet"
    return f"deepsea:{scoped_wallet}:{name}"


async def _clear_runtime_state(previous_wallet: str | None = None) -> None:
    global _current_metrics, _current_workers, _cache_scope

    if previous_wallet:
        await cache_delete(get_cache_key("metrics", previous_wallet))
        await cache_delete(get_cache_key("workers", previous_wallet))

    _current_metrics = None
    _current_workers = None
    _cache_scope = None
    _broadcast({"type": "metrics", "data": DashboardMetrics().model_dump()})
    _broadcast({"type": "workers", "data": WorkerSummary().model_dump()})


async def refresh_once(db: aiosqlite.Connection) -> None:
    global _last_refresh, _current_metrics, _current_workers, _client, _cache_scope

    wallet = get_wallet().strip()
    if not wallet:
        await _clear_runtime_state(_cache_scope)
        _log.debug("No wallet configured, skipping refresh")
        return

    if _cache_scope and _cache_scope != wallet:
        await _clear_runtime_state(_cache_scope)

    if _client is None or _client.wallet != wallet:
        if _client:
            await _client.close()
        _client = OceanClient(wallet=wallet)

    _cache_scope = wallet

    try:
        metrics = await fetch_full_metrics(_client)
        _current_metrics = metrics.model_dump()
        await cache_set(get_cache_key("metrics", wallet), _current_metrics, ttl=120)

        # Save historical snapshot
        await save_metric_snapshot(db, _current_metrics)

        # Notification checks
        try:
            await check_and_fire(db, _current_metrics)
        except Exception as e:
            _log.warning("Notification check error: %s", e)

        # Broadcast to SSE subscribers
        _broadcast({"type": "metrics", "data": _current_metrics})
        _last_refresh = time.time()

    except Exception as e:
        _log.error("Metrics refresh error: %s", e)

    # Workers (slightly less frequent — every 2 refresh cycles is fine)
    try:
        workers = await _client.get_worker_data()
        if workers:
            from app.services.worker_service import enrich_workers

            workers["workers"] = enrich_workers(workers.get("workers", []))
            _current_workers = workers
            await cache_set(get_cache_key("workers", wallet), _current_workers, ttl=120)
            _broadcast({"type": "workers", "data": _current_workers})
        else:
            _current_workers = WorkerSummary().model_dump()
            await cache_delete(get_cache_key("workers", wallet))
            _broadcast({"type": "workers", "data": _current_workers})
    except Exception as e:
        _log.error("Worker refresh error: %s", e)


async def background_loop() -> None:
    """Main background refresh loop. Runs until cancelled."""
    _log.info("Background refresh loop starting (interval=%ds)", REFRESH_INTERVAL)

    # Wait a moment for the app to fully start
    await asyncio.sleep(3)

    while True:
        try:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            async with aiosqlite.connect(str(DB_PATH)) as db:
                db.row_factory = aiosqlite.Row
                await _configure_connection(db)
                await refresh_once(db)
        except asyncio.CancelledError:
            _log.info("Background loop cancelled")
            break
        except Exception as e:
            _log.error("Background loop error: %s", e)

        await asyncio.sleep(REFRESH_INTERVAL)
