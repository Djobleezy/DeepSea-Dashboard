"""Notification rules engine — checks metrics/workers and fires notifications."""

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
    """Compare metrics against previous values and create notifications as needed."""
    fired: list[dict] = []

    prev_hr = _prev_state.get("hashrate_3hr")
    curr_hr = metrics.get("hashrate_3hr", 0)

    if prev_hr and prev_hr > 0 and curr_hr is not None:
        change_pct = ((curr_hr - prev_hr) / prev_hr) * 100
        if change_pct <= -HASHRATE_DROP_THRESHOLD:
            msg = f"⚠️ Hashrate dropped {abs(change_pct):.1f}% (from {prev_hr:.2f} to {curr_hr:.2f} TH/s)"
            n = await create_notification(db, msg, "hashrate", "warning")
            fired.append(n)
        elif change_pct >= HASHRATE_SPIKE_THRESHOLD:
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
        prev_block
        and curr_block
        and isinstance(prev_block, (int, float))
        and isinstance(curr_block, (int, float))
        and int(curr_block) != int(prev_block)
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
    return await create_notification(db, message, "system", level)
