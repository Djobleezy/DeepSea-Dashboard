"""Single asyncio background refresh loop — replaces APScheduler."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import aiosqlite

from app.config import get_power_cost, get_power_usage, get_wallet
from app.db import DB_PATH, _configure_connection, get_worker_overrides, migrate_legacy_electricity_rate, save_metric_snapshot
from app.models import DashboardMetrics, WorkerSummary
from app.services.cache import cache_delete, cache_set
from app.services.metrics_service import compute_financials, fetch_full_metrics
from app.services.worker_service import build_worker_summary
from app.services.notification_engine import check_and_fire
from app.services.ocean_client import OceanClient

_log = logging.getLogger(__name__)

REFRESH_INTERVAL = 60  # seconds
_started_at: float = time.time()
_last_refresh: Optional[float] = None
_current_metrics: Optional[dict] = None
_current_workers: Optional[dict] = None
_raw_workers: Optional[dict] = None
_subscribers: list[asyncio.Queue] = []
_cache_scope: Optional[str] = None

_client: Optional[OceanClient] = None
_refresh_lock = asyncio.Lock()
_financial_lock = asyncio.Lock()


def get_uptime() -> float:
    return time.time() - _started_at


def get_last_refresh() -> Optional[float]:
    return _last_refresh if _cache_scope == get_wallet().strip() else None


def get_current_metrics() -> Optional[dict]:
    if not _current_metrics or _current_metrics.get("wallet", _cache_scope) != get_wallet().strip():
        return None
    snapshot = dict(_current_metrics)
    updated_at = snapshot.get("data_updated_at")
    if snapshot.get("data_status") == "fresh" and updated_at and time.time() - updated_at > 120:
        snapshot.update(data_status="stale", data_error="Mining data has not refreshed recently")
    snapshot["server_timestamp"] = time.time()
    return snapshot


def get_current_workers() -> Optional[dict]:
    if not _current_workers or _current_workers.get("wallet", _cache_scope) != get_wallet().strip():
        return None
    snapshot = dict(_current_workers)
    updated_at = snapshot.get("data_updated_at")
    if snapshot.get("data_status") == "fresh" and updated_at and time.time() - updated_at > 120:
        snapshot["data_status"] = "stale"
    return snapshot


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
    global _current_metrics, _current_workers, _raw_workers, _cache_scope, _last_refresh

    async with _financial_lock:
        if previous_wallet:
            await cache_delete(get_cache_key("metrics", previous_wallet))
            await cache_delete(get_cache_key("workers", previous_wallet))
        _current_metrics = None
        _current_workers = None
        _raw_workers = None
        _last_refresh = None
        _cache_scope = None
        wallet = get_wallet().strip()
        status = "unavailable" if wallet else "unconfigured"
        _broadcast({"type": "metrics", "data": DashboardMetrics(wallet=wallet, data_status=status).model_dump()})
        _broadcast({"type": "workers", "data": WorkerSummary(wallet=wallet, data_status=status).model_dump()})


async def refresh_once(db: aiosqlite.Connection) -> None:
    global _last_refresh, _current_metrics, _current_workers, _client, _cache_scope

    async with _refresh_lock:
        await _refresh_once_locked(db)


async def _refresh_once_locked(db: aiosqlite.Connection) -> None:
    global _last_refresh, _current_metrics, _current_workers, _raw_workers, _client, _cache_scope

    wallet = get_wallet().strip()
    if not wallet:
        await _clear_runtime_state(_cache_scope)
        return
    if _cache_scope and _cache_scope != wallet:
        await _clear_runtime_state(_cache_scope)
    if _client is None or _client.wallet != wallet:
        if _client:
            await _client.close()
        _client = OceanClient(wallet=wallet)
    _cache_scope = wallet

    next_metrics = None
    try:
        metrics = await fetch_full_metrics(_client)
        next_metrics = metrics.model_dump()
        next_metrics.update(wallet=wallet, data_status="fresh", data_updated_at=time.time(), data_error=None)
    except Exception as e:
        _log.warning("Metrics refresh failed: %s", e)

    # Fetch outside the state lock: saving a local setting never waits for an
    # upstream request. Worker refresh remains independent of metrics failure.
    next_workers = None
    try:
        workers = await _client.get_worker_data()
        if workers is None:
            raise ValueError("Worker data is temporarily unavailable")
        next_workers = {**workers, "data_status": "fresh", "data_updated_at": time.time()}
    except Exception as e:
        _log.warning("Worker refresh failed: %s", e)

    # Commit raw inputs and derive finances as one state transition. Otherwise
    # a save suspended in a DB read could overwrite a newer mining snapshot.
    async with _financial_lock:
        if get_wallet().strip() != wallet or _cache_scope != wallet:
            return
        if next_metrics is not None:
            next_metrics["snapshot_updated_at"] = (_current_metrics or {}).get("snapshot_updated_at", 0)
            _current_metrics = next_metrics
        elif _current_metrics:
            _current_metrics = {**_current_metrics, "data_status": "stale", "data_error": "Mining data is temporarily unavailable"}
        else:
            _current_metrics = DashboardMetrics(
                wallet=wallet, data_status="unavailable", data_error="Mining data is temporarily unavailable"
            ).model_dump()
        if next_workers is not None:
            _raw_workers = next_workers
        elif _raw_workers:
            _raw_workers = {**_raw_workers, "data_status": "stale"}

        await _apply_financials(db)
        if get_wallet().strip() != wallet or _cache_scope != wallet:
            return
        snapshot = dict(_current_metrics)
        if next_metrics is not None:
            _last_refresh = snapshot["data_updated_at"]
        await _publish_metrics_locked()

    # This immutable snapshot belongs to this successful upstream refresh;
    # concurrent local setting changes cannot change its wallet or hashrate.
    if next_metrics is not None and get_wallet().strip() == wallet:
        await save_metric_snapshot(db, snapshot)
        try:
            await check_and_fire(db, snapshot)
        except Exception as e:
            _log.warning("Notification check error: %s", e)


async def _apply_financials(db: aiosqlite.Connection) -> None:
    global _current_metrics, _current_workers
    await migrate_legacy_electricity_rate(db)
    wallet = get_wallet().strip()
    if not wallet or _cache_scope != wallet:
        return
    metrics = _current_metrics or {}
    overrides = await get_worker_overrides(db) if _raw_workers is not None else {}
    if get_wallet().strip() != wallet or _cache_scope != wallet:
        return
    # Source age measures the upstream reading. A separate revision orders
    # derived changes (rates, overrides, stale state) sharing that same reading.
    revision = max(
        time.time(),
        float(metrics.get("snapshot_updated_at") or 0) + 0.000001,
        float((_current_workers or {}).get("snapshot_updated_at") or 0) + 0.000001,
    )
    if _raw_workers is not None:
        _current_workers = build_worker_summary(
            {**_raw_workers, "snapshot_updated_at": revision}, metrics, overrides, wallet
        )
        await cache_set(get_cache_key("workers", wallet), _current_workers, ttl=120)
        if get_wallet().strip() != wallet or _cache_scope != wallet:
            return
        _broadcast({"type": "workers", "data": _current_workers})
    if _current_metrics is None:
        return
    # Configured power is a fallback until an actual fleet is available.
    power = (_current_workers["total_power_watts"]
             if _current_workers is not None else get_power_usage())
    rate = get_power_cost()
    financials = compute_financials(
        metrics.get("daily_mined_sats", 0), metrics.get("monthly_mined_sats", 0),
        metrics.get("btc_price", 0), rate, power,
    )
    _current_metrics = {
        **metrics, **financials, "power_usage_watts": power,
        "power_cost_per_kwh": rate, "snapshot_updated_at": revision,
    }


async def _publish_metrics_locked() -> None:
    current = get_current_metrics()
    if current is None:
        return
    wallet = current["wallet"]
    await cache_set(get_cache_key("metrics", wallet), current, ttl=120)
    if get_wallet().strip() == wallet and _cache_scope == wallet:
        _broadcast({"type": "metrics", "data": current})


async def refresh_financials(db: aiosqlite.Connection) -> None:
    """Apply a saved cost/override change without waiting on upstream requests."""
    async with _financial_lock:
        await _apply_financials(db)
        await _publish_metrics_locked()


async def trigger_refresh() -> None:
    """Run an on-demand refresh outside the normal scheduler loop."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await _configure_connection(db)
        await refresh_once(db)


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
