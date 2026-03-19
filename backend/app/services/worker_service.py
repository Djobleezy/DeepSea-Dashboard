"""Worker data enrichment, ASIC model detection, and sorting/filtering utilities.

This module sits on top of the raw worker data returned by :class:`OceanClient`
and adds value in three ways:

1. **ASIC model detection** (``detect_miner_model``): matches worker names against
   a list of regular-expression patterns to identify the specific ASIC model.
   Unknown workers fall back to ``"Unknown ASIC"`` with a conservative 30 J/TH
   efficiency estimate.

2. **Power estimation** (``enrich_workers``): uses the detected efficiency (J/TH)
   and the worker's 3-hour average hashrate to estimate power consumption in watts:
   ``power_consumption = hashrate_ths × efficiency_j_per_th``.

3. **Sorting and filtering** (``sort_workers``, ``filter_workers``): used by the
   workers API router to apply client-requested ordering and status filters without
   re-fetching data.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

_log = logging.getLogger(__name__)

# ASIC model patterns for name-based detection.
# Order matters — most-specific patterns first to avoid premature matches.
# Last verified: 2026-03-19 from manufacturer specs.
_MINER_PATTERNS = [
    # ── Bitmain Antminer S21 generation ──
    (re.compile(r"s21\s*xp\s*hyd", re.I), "Antminer S21 XP Hyd", 12.0),
    (re.compile(r"s21\s*xp", re.I), "Antminer S21 XP", 13.5),
    (re.compile(r"s21\s*pro", re.I), "Antminer S21 Pro", 15.0),
    (re.compile(r"s21\s*\+", re.I), "Antminer S21+", 16.5),
    (re.compile(r"s21\s*hyd", re.I), "Antminer S21 Hyd", 16.0),
    (re.compile(r"s21", re.I), "Antminer S21", 17.5),
    (re.compile(r"t21", re.I), "Antminer T21", 19.0),
    # ── Bitmain Antminer S19 generation ──
    (re.compile(r"s19\s*pro\+?\s*hyd", re.I), "Antminer S19 Pro+ Hyd", 27.5),
    (re.compile(r"s19\s*xp", re.I), "Antminer S19 XP", 21.5),
    (re.compile(r"s19k\s*pro", re.I), "Antminer S19k Pro", 23.0),
    (re.compile(r"s19j\s*pro\+", re.I), "Antminer S19j Pro+", 22.0),
    (re.compile(r"s19j\s*pro", re.I), "Antminer S19j Pro", 30.0),
    (re.compile(r"s19\s*pro\+", re.I), "Antminer S19 Pro+", 23.0),
    (re.compile(r"s19\s*pro", re.I), "Antminer S19 Pro", 29.5),
    (re.compile(r"s19j", re.I), "Antminer S19j", 34.5),
    (re.compile(r"s19", re.I), "Antminer S19", 34.5),
    # ── MicroBT Whatsminer M66/M63/M60 (current gen) ──
    (re.compile(r"m66s\s*\+\+", re.I), "Whatsminer M66S++", 15.5),
    (re.compile(r"m66s", re.I), "Whatsminer M66S", 18.5),
    (re.compile(r"m66", re.I), "Whatsminer M66", 19.9),
    (re.compile(r"m63s", re.I), "Whatsminer M63S", 16.5),
    (re.compile(r"m63", re.I), "Whatsminer M63", 17.5),
    (re.compile(r"m60s", re.I), "Whatsminer M60S", 18.5),
    (re.compile(r"m60", re.I), "Whatsminer M60", 19.9),
    # ── MicroBT Whatsminer M56/M50/M30 (previous gen) ──
    (re.compile(r"m56s\+", re.I), "Whatsminer M56S+", 22.0),
    (re.compile(r"m50s\+", re.I), "Whatsminer M50S+", 23.0),
    (re.compile(r"m50s", re.I), "Whatsminer M50S", 25.0),
    (re.compile(r"m50", re.I), "Whatsminer M50", 29.0),
    (re.compile(r"m30s\+\+", re.I), "Whatsminer M30S++", 31.0),
    (re.compile(r"m30s\+", re.I), "Whatsminer M30S+", 34.0),
    (re.compile(r"m30s", re.I), "Whatsminer M30S", 38.0),
    # ── Canaan Avalon ──
    (re.compile(r"a16\s*xp", re.I), "Avalon A16 XP", 12.8),
    (re.compile(r"a16", re.I), "Avalon A16", 13.8),
    (re.compile(r"a15\s*pro", re.I), "Avalon A15 Pro", 16.8),
    (re.compile(r"a15", re.I), "Avalon A15", 18.5),
    (re.compile(r"a14\s*pro", re.I), "Avalon A14 Pro", 21.0),
    (re.compile(r"a1466|avalon\s*1466", re.I), "Avalon A1466", 25.0),
    # ── Bitdeer SealMiner ──
    (re.compile(r"seal\s*a2\s*pro\s*hyd", re.I), "SealMiner A2 Pro Hyd", 16.5),
    (re.compile(r"seal\s*a2|sealminer\s*a2", re.I), "SealMiner A2", 16.5),
    # ── Fluminer ──
    (re.compile(r"fluminer\s*t3", re.I), "Fluminer T3", 14.8),
    # ── Open-source solo miners ──
    (re.compile(r"bitaxe\s*supra\s*hex", re.I), "BitAxe Supra Hex", 21.4),
    (re.compile(r"bitaxe\s*gamma\s*602", re.I), "BitAxe Gamma 602", 14.0),
    (re.compile(r"bitaxe\s*gamma", re.I), "BitAxe Gamma 601", 14.0),
    (re.compile(r"bitaxe\s*ultra", re.I), "BitAxe Ultra", 18.0),
    (re.compile(r"bitaxe|nerdqaxe", re.I), "BitAxe", 14.0),
]


def detect_miner_model(worker_name: str) -> tuple[str, float]:
    """Identify the ASIC model and its efficiency from a worker name string.

    Matches against ``_MINER_PATTERNS`` in order (most-specific first).  The
    patterns are case-insensitive and cover the Bitmain Antminer S/T-series,
    MicroBT Whatsminer M-series, and BitAxe/NerdQAxe open-source miners.

    Args:
        worker_name: The raw worker identifier string from Ocean (e.g.
            ``"s19pro-rack1-01"``).

    Returns:
        A tuple of ``(model_display_name, efficiency_j_per_th)``.  Falls back
        to ``("Unknown ASIC", 30.0)`` when no pattern matches.
    """
    for pattern, model, efficiency in _MINER_PATTERNS:
        if pattern.search(worker_name):
            return model, efficiency
    return "Unknown ASIC", 30.0


def enrich_workers(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add ASIC model detection, efficiency values, and power estimates to workers.

    For each worker that doesn't already have a known model, calls
    ``detect_miner_model`` and populates ``model``, ``efficiency`` (J/TH), and
    ``power_consumption`` (watts, derived from 3-hour average hashrate ×
    efficiency).  Also sets the ``type`` field (``"ASIC"``, ``"Whatsminer"``,
    or ``"Bitaxe"``) based on the detected model name.

    Args:
        workers: List of raw worker dicts (typically from ``OceanClient``).

    Returns:
        New list of worker dicts with enriched fields.  Input dicts are
        shallow-copied; originals are not modified.
    """
    enriched = []
    for w in workers:
        worker = dict(w)
        name = worker.get("name", "")
        if worker.get("model", "Unknown") in ("Unknown", "Unknown ASIC", ""):
            model, efficiency = detect_miner_model(name)
            worker["model"] = model
            worker["efficiency"] = efficiency
            hr_ths = float(worker.get("hashrate_3hr") or 0)
            if hr_ths > 0:
                worker["power_consumption"] = round(hr_ths * efficiency)

        # Determine type from model name
        model = worker.get("model", "")
        if "bitaxe" in model.lower() or "bitaxe" in name.lower():
            worker["type"] = "Bitaxe"
        elif "whatsminer" in model.lower():
            worker["type"] = "Whatsminer"
        elif "antminer" in model.lower() or not model or model == "Unknown ASIC":
            worker["type"] = "ASIC"

        enriched.append(worker)
    return enriched


def sort_workers(
    workers: list[dict],
    sort_by: str = "name",
    descending: bool = False,
) -> list[dict]:
    """Return a sorted copy of the worker list.

    Args:
        workers: List of worker dicts to sort.
        sort_by: Column key to sort by.  Supported values: ``"name"``,
            ``"status"``, ``"hashrate"`` / ``"hashrate_3hr"``,
            ``"hashrate_60sec"``, ``"earnings"``, ``"efficiency"``,
            ``"last_share"``.  Defaults to ``"name"``.
        descending: If ``True``, sort in descending order.

    Returns:
        Sorted list (original list is not modified).  Falls back to the
        original order on sort errors.
    """
    key_map = {
        "name": lambda w: w.get("name", ""),
        "status": lambda w: w.get("status", ""),
        "hashrate": lambda w: float(w.get("hashrate_3hr") or 0),
        "hashrate_3hr": lambda w: float(w.get("hashrate_3hr") or 0),
        "hashrate_60sec": lambda w: float(w.get("hashrate_60sec") or 0),
        "earnings": lambda w: float(w.get("earnings") or 0),
        "efficiency": lambda w: float(w.get("efficiency") or 0),
        "last_share": lambda w: w.get("last_share", ""),
    }
    fn = key_map.get(sort_by, key_map["name"])
    try:
        return sorted(workers, key=fn, reverse=descending)
    except (TypeError, ValueError) as e:
        _log.warning("Failed to sort workers by '%s': %s", sort_by, e)
        return workers


def filter_workers(
    workers: list[dict], status: Optional[str] = None
) -> list[dict]:
    """Filter workers by online/offline status.

    Args:
        workers: List of worker dicts.
        status: ``"online"``, ``"offline"``, or ``None``/``"all"`` to return
            all workers.

    Returns:
        Filtered list (a new list; originals are not modified).
    """
    if not status or status == "all":
        return workers
    return [w for w in workers if w.get("status") == status]
