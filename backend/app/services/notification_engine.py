"""Rules-based notification engine for mining events.

This module evaluates the latest metrics snapshot against the previous snapshot and
creates notifications in the database when notable changes occur.  It is called from
the background refresh loop after each successful metrics fetch.

**Notification types and triggers:**

- **Hashrate drop** (category ``hashrate``, level ``warning``): fired when the
  3-hour average hashrate falls by ≥ ``HASHRATE_DROP_THRESHOLD`` percent relative
  to the previous reading.
- **Hashrate spike** (category ``hashrate``, level ``success``): fired when the
  3-hour average hashrate rises by ≥ ``HASHRATE_SPIKE_THRESHOLD`` percent.
- **Worker offline** (category ``worker``, level ``warning``): fired when the
  active worker count decreases between readings.
- **Worker online** (category ``worker``, level ``info``): fired when the active
  worker count increases.
- **New block found** (category ``block``, level ``success``, ``is_block=True``):
  fired when ``last_block_height`` changes between readings, indicating a new
  Ocean pool block.

**State management:** Previous snapshot values are persisted to the ``alert_state``
SQLite table so that state survives process restarts.  An in-process cache
(``_prev_state``) is used for performance; it is loaded from the DB on first call.

**Cooldowns:** Each alert category has a minimum interval between firings to prevent
notification storms when a condition persists across many refresh cycles.  Block
notifications are exempt from cooldowns (every block is always noteworthy).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import aiosqlite

from app.db import create_notification, get_alert_state, set_alert_state

_log = logging.getLogger(__name__)

HASHRATE_DROP_THRESHOLD = 25.0  # percent
HASHRATE_SPIKE_THRESHOLD = 50.0  # percent

# Minimum seconds between firings for each category (0 = no cooldown).
# Block notifications are always exempt — every new block must fire.
COOLDOWN_SECONDS: dict[str, float] = {
    "hashrate": 600.0,   # 10 minutes between hashrate alerts
    "worker":   300.0,   # 5 minutes between worker alerts
    "block":    0.0,     # no cooldown — every block is unique
}

# In-process cache of the previous metric snapshot and alert timestamps.
# Keys: "hashrate_3hr", "workers_hashing", "last_block_height",
#       "last_fired_hashrate", "last_fired_worker"
_prev_state: dict[str, Any] = {}

# Tracks whether we've loaded persistent state from the DB in this process.
_state_loaded: bool = False


async def _ensure_state_loaded(db: aiosqlite.Connection) -> None:
    """Load persisted state from the DB once per process lifecycle."""
    global _state_loaded
    if _state_loaded:
        return
    try:
        stored = await get_alert_state(db)
        _prev_state.update(stored)
    except Exception as e:  # pragma: no cover
        _log.warning("Could not load alert state from DB: %s", e)
    _state_loaded = True


def _on_cooldown(category: str) -> bool:
    """Return True if the given category is still within its cooldown window."""
    cooldown = COOLDOWN_SECONDS.get(category, 0.0)
    if cooldown <= 0:
        return False
    last_key = f"last_fired_{category}"
    last_fired = _prev_state.get(last_key)
    if last_fired is None:
        return False

    # Be resilient to bad/stale DB values: treat non-numeric timestamps as
    # absent cooldown data instead of crashing the refresh loop.
    try:
        last_fired_ts = float(last_fired)
    except (TypeError, ValueError):
        _prev_state.pop(last_key, None)
        return False

    return (time.time() - last_fired_ts) < cooldown


async def _record_fired(db: aiosqlite.Connection, category: str) -> None:
    """Record the current timestamp as the last-fired time for a category."""
    key = f"last_fired_{category}"
    _prev_state[key] = time.time()
    await set_alert_state(db, key, _prev_state[key])


async def check_and_fire(
    db: aiosqlite.Connection,
    metrics: dict[str, Any],
    workers: Optional[dict] = None,
) -> list[dict]:
    """Evaluate current metrics and create notifications for significant changes.

    Compares ``metrics`` against the cached previous state (``_prev_state``) and
    persists a notification record for each triggered rule.  Updates ``_prev_state``
    at the end of each call so the next invocation sees the current values as the
    baseline.

    State is lazily loaded from the ``alert_state`` DB table on the first call
    after a process restart, preventing false-positive alerts that would otherwise
    fire because ``_prev_state`` starts empty.

    Args:
        db: Active ``aiosqlite`` connection used to persist notification rows.
        metrics: Current metrics dict (typically the serialised
            :class:`~app.models.DashboardMetrics`).  Expected keys:
            ``hashrate_3hr``, ``workers_hashing``, ``last_block_height``.
        workers: Optional worker summary dict (reserved for future per-worker
            rules; currently unused).

    Returns:
        List of newly created notification dicts (may be empty if no rules fired).
    """
    await _ensure_state_loaded(db)

    fired: list[dict] = []

    # In low hashrate mode (BitAxe / tabletop miners) use 3hr averages for
    # change detection — the 60-sec window is too noisy to be meaningful.
    # In normal mode we already use 3hr as the baseline, so this is
    # consistent.  We also relax the drop threshold slightly for low-
    # hashrate devices whose readings are inherently more variable.
    low_mode = bool(metrics.get("low_hashrate_mode"))
    drop_threshold = 40.0 if low_mode else HASHRATE_DROP_THRESHOLD
    spike_threshold = HASHRATE_SPIKE_THRESHOLD

    prev_hr = _prev_state.get("hashrate_3hr")
    curr_hr = metrics.get("hashrate_3hr", 0)

    if prev_hr and prev_hr > 0 and curr_hr is not None:
        change_pct = ((curr_hr - prev_hr) / prev_hr) * 100
        if change_pct <= -drop_threshold and not _on_cooldown("hashrate"):
            msg = (
                f"⚠️ Hashrate dropped {abs(change_pct):.1f}%"
                f" (from {prev_hr:.2f} to {curr_hr:.2f} TH/s)"
            )
            n = await create_notification(db, msg, "hashrate", "warning")
            fired.append(n)
            await _record_fired(db, "hashrate")
        elif change_pct >= spike_threshold and not _on_cooldown("hashrate"):
            msg = (
                f"📈 Hashrate increased {change_pct:.1f}%"
                f" (from {prev_hr:.2f} to {curr_hr:.2f} TH/s)"
            )
            n = await create_notification(db, msg, "hashrate", "success")
            fired.append(n)
            await _record_fired(db, "hashrate")

    # Worker count changes
    prev_workers = _prev_state.get("workers_hashing")
    curr_workers = metrics.get("workers_hashing", 0)
    if prev_workers is not None and curr_workers != prev_workers:
        diff = curr_workers - prev_workers
        if diff < 0 and not _on_cooldown("worker"):
            msg = (
                f"🔴 {abs(diff)} worker(s) went offline"
                f" ({prev_workers} → {curr_workers} active)"
            )
            n = await create_notification(db, msg, "worker", "warning")
            fired.append(n)
            await _record_fired(db, "worker")
        elif diff > 0 and not _on_cooldown("worker"):
            msg = (
                f"🟢 {diff} new worker(s) online"
                f" ({prev_workers} → {curr_workers} active)"
            )
            n = await create_notification(db, msg, "worker", "info")
            fired.append(n)
            await _record_fired(db, "worker")

    # Block found detection — no cooldown, every block is unique
    prev_block = _prev_state.get("last_block_height")
    curr_block = metrics.get("last_block_height")
    if (
        prev_block is not None
        and curr_block is not None
        and isinstance(prev_block, (int, float))
        and isinstance(curr_block, (int, float))
        and int(curr_block) > int(prev_block)
    ):
        msg = f"⛏️ New block found! Height #{curr_block}"
        n = await create_notification(db, msg, "block", "success", is_block=True)
        fired.append(n)
        # No _record_fired for blocks — cooldown is 0 and every block is unique

    # Update in-process state and persist to DB
    _prev_state["hashrate_3hr"] = curr_hr
    _prev_state["workers_hashing"] = curr_workers
    _prev_state["last_block_height"] = curr_block

    # Persist metric-snapshot keys so they survive restart
    await set_alert_state(db, "hashrate_3hr", curr_hr)
    await set_alert_state(db, "workers_hashing", curr_workers)
    if curr_block is not None:
        await set_alert_state(db, "last_block_height", curr_block)

    return fired


async def fire_system_notification(
    db: aiosqlite.Connection,
    message: str,
    level: str = "info",
) -> dict:
    """Create a one-off system-category notification.

    Convenience wrapper around :func:`~app.db.create_notification` for ad-hoc
    system messages (e.g. startup events, config changes).

    Args:
        db: Active ``aiosqlite`` connection.
        message: Human-readable notification body.
        level: Severity level string — ``"info"``, ``"success"``, ``"warning"``,
            or ``"error"``.

    Returns:
        The newly created notification dict.
    """
    return await create_notification(db, message, "system", level)
