"""Worker data management service."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

_log = logging.getLogger(__name__)

# ASIC model patterns for name-based detection
_MINER_PATTERNS = [
    (re.compile(r"s19\s*pro\+\s*hyd", re.I), "Antminer S19 Pro+ Hyd", 27.5),
    (re.compile(r"s19\s*xp", re.I), "Antminer S19 XP", 21.5),
    (re.compile(r"s19\s*pro\+", re.I), "Antminer S19 Pro+", 23.0),
    (re.compile(r"s19\s*pro", re.I), "Antminer S19 Pro", 29.5),
    (re.compile(r"s19j\s*pro\+", re.I), "Antminer S19j Pro+", 22.0),
    (re.compile(r"s19j\s*pro", re.I), "Antminer S19j Pro", 30.0),
    (re.compile(r"s19j", re.I), "Antminer S19j", 34.5),
    (re.compile(r"s19", re.I), "Antminer S19", 34.5),
    (re.compile(r"s21\s*xp", re.I), "Antminer S21 XP", 12.0),
    (re.compile(r"s21", re.I), "Antminer S21", 17.5),
    (re.compile(r"t21", re.I), "Antminer T21", 19.0),
    (re.compile(r"m60s", re.I), "Whatsminer M60S", 18.5),
    (re.compile(r"m56s\+", re.I), "Whatsminer M56S+", 22.0),
    (re.compile(r"m50s\+", re.I), "Whatsminer M50S+", 26.0),
    (re.compile(r"m50s", re.I), "Whatsminer M50S", 29.0),
    (re.compile(r"m30s\+\+", re.I), "Whatsminer M30S++", 31.0),
    (re.compile(r"m30s\+", re.I), "Whatsminer M30S+", 34.0),
    (re.compile(r"m30s", re.I), "Whatsminer M30S", 38.0),
    (re.compile(r"bitaxe|nerdqaxe", re.I), "BitAxe Gamma 601", 14.0),
]


def detect_miner_model(worker_name: str) -> tuple[str, float]:
    """Return (model_name, efficiency_j_per_th) for a worker name."""
    for pattern, model, efficiency in _MINER_PATTERNS:
        if pattern.search(worker_name):
            return model, efficiency
    return "Unknown ASIC", 30.0


def enrich_workers(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add model detection and power estimates to worker list."""
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
    """Sort worker list by a given column."""
    key_map = {
        "name": lambda w: w.get("name", ""),
        "status": lambda w: w.get("status", ""),
        "hashrate": lambda w: float(w.get("hashrate_3hr") or 0),
        "hashrate_60sec": lambda w: float(w.get("hashrate_60sec") or 0),
        "earnings": lambda w: float(w.get("earnings") or 0),
        "efficiency": lambda w: float(w.get("efficiency") or 0),
        "last_share": lambda w: w.get("last_share", ""),
    }
    fn = key_map.get(sort_by, key_map["name"])
    try:
        return sorted(workers, key=fn, reverse=descending)
    except Exception:
        return workers


def filter_workers(
    workers: list[dict], status: Optional[str] = None
) -> list[dict]:
    if not status or status == "all":
        return workers
    return [w for w in workers if w.get("status") == status]
