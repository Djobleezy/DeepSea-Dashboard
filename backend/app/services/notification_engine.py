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

**State management:** The previous snapshot is stored in the module-level dict
``_prev_state``.  State persists for the lifetime of the process (i.e. within a
single server session) but is reset on restart.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import aiosqlite

from app.db import create_notification

_log = logging.getLogger(__name__)

HASHRATE_DROP_THRESHOLD = 25.0  # percent
HASHRATE_SPIKE_THRESHOLD = 50.0  # percent

# State for change detection (in-process; survives within a session)
_prev_state: dict[str, Any] = {}


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
        if change_pct <= -drop_threshold:
            msg = f"⚠️ Hashrate dropped {abs(change_pct):.1f}% (from {prev_hr:.2f} to {curr_hr:.2f} TH/s)"
            n = await create_notification(db, msg, "hashrate", "warning")
            fired.append(n)
        elif change_pct >= spike_threshold:
            msg = f"📈 Hashrate increased {change_pct:.1f}% (from {prev_hr:.2f} to {curr_hr:.2f} TH/s)"
            n = await create_notification(db, msg, "hashrate", "success")
            fired.append(n)

    # Worker count changes
    prev_workers = _prev_state.get("workers_hashing")
    curr_workers = metrics.get("workers_hashing", 0)
    if prev_workers is not None and curr_workers != prev_workers:
        diff = curr_workers - prev_workers
        if diff < 0:
            msg = f"🔴 {abs(diff)} worker(s) went offline ({prev_workers} → {curr_workers} active)"
            n = await create_notification(db, msg, "worker", "warning")
            fired.append(n)
        elif diff > 0:
            msg = f"🟢 {diff} new worker(s) online ({prev_workers} → {curr_workers} active)"
            n = await create_notification(db, msg, "worker", "info")
            fired.append(n)

    # Block found detection
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

    # Update state
    _prev_state["hashrate_3hr"] = curr_hr
    _prev_state["workers_hashing"] = curr_workers
    _prev_state["last_block_height"] = curr_block

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
