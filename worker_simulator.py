"""
Worker simulator module for DeepSea Dashboard.

Contains pure simulation/generation functions for creating realistic worker
data when real Ocean.xyz worker data is unavailable. No network/disk I/O,
no caching — just data generation. Logging and timezone lookups are the only
side-effects.
"""

import logging
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from config import get_timezone
from worker_models import MINER_MODELS, WORKER_NAME_PREFIXES


def generate_default_workers_data() -> dict:
    """
    Return a minimal default worker data structure with zero workers.

    Used when no metrics are available at all (e.g. first startup before
    any data has been fetched).

    Returns:
        dict: Default worker data structure with zeroed counts and rates.
    """
    return {
        "workers": [],
        "workers_total": 0,
        "workers_online": 0,
        "workers_offline": 0,
        "total_hashrate": 0.0,
        "hashrate_unit": "TH/s",
        "total_earnings": 0.0,
        "daily_sats": 0,
        "total_power": 0,
        "hashrate_history": [],
        "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
    }


def create_default_worker(name: str, status: str) -> dict:
    """
    Create a single default worker dict with reasonable random values.

    Args:
        name: Worker name.
        status: Worker status — ``'online'`` or ``'offline'``.

    Returns:
        dict: Worker data dictionary.
    """
    is_online = status == "online"
    current_time = datetime.now(ZoneInfo(get_timezone()))
    hashrate = round(random.uniform(50, 100), 2) if is_online else 0
    last_share = (
        current_time.strftime("%Y-%m-%d %H:%M")
        if is_online
        else (current_time - timedelta(hours=random.uniform(1, 24))).strftime("%Y-%m-%d %H:%M")
    )
    return {
        "name": name,
        "status": status,
        "type": "ASIC",
        "model": "Default Miner",
        "hashrate_60sec": hashrate if is_online else 0,
        "hashrate_60sec_unit": "TH/s",
        "hashrate_3hr": hashrate if is_online else round(random.uniform(30, 80), 2),
        "hashrate_3hr_unit": "TH/s",
        "efficiency": round(random.uniform(80, 95), 1) if is_online else 0,
        "last_share": last_share,
        "earnings": round(random.uniform(0.0001, 0.001), 8),
        "power_consumption": round(random.uniform(2000, 3500)) if is_online else 0,
        "temperature": round(random.uniform(55, 75)) if is_online else 0,
    }


def _distribute_earnings(workers: list, total_unpaid_earnings: float) -> None:
    """
    Distribute ``total_unpaid_earnings`` across workers in-place.

    95 % goes to online workers (proportional to hashrate_3hr);
    5 % is split evenly among offline workers.
    """
    online_workers = [w for w in workers if w["status"] == "online"]
    offline_workers = [w for w in workers if w["status"] == "offline"]

    online_pool = total_unpaid_earnings * 0.95
    offline_pool = total_unpaid_earnings * 0.05

    total_online_hr = sum(w["hashrate_3hr"] for w in online_workers)
    if total_online_hr > 0:
        for w in online_workers:
            w["earnings"] = round(online_pool * w["hashrate_3hr"] / total_online_hr, 8)

    if offline_workers:
        per_offline = offline_pool / len(offline_workers)
        for w in offline_workers:
            w["earnings"] = round(per_offline, 8)

    # Fix any floating-point residual on first online worker
    current_total = sum(w["earnings"] for w in workers)
    delta = total_unpaid_earnings - current_total
    if abs(delta) > 1e-8:
        for w in online_workers:
            w["earnings"] = round(w["earnings"] + delta, 8)
            break


def generate_sequential_workers(
    num_workers: int,
    total_hashrate: float,
    hashrate_unit: str,
    total_unpaid_earnings: float | None = None,
) -> list:
    """
    Generate workers with sequential ``Miner_N`` names.

    Used as the final fallback when no real worker names are in the cache.

    Args:
        num_workers: Number of workers to generate (min 1).
        total_hashrate: Total pool hashrate to distribute across online workers.
        hashrate_unit: Hashrate unit string (e.g. ``'TH/s'``).
        total_unpaid_earnings: Total unpaid BTC earnings to distribute.

    Returns:
        list[dict]: Generated worker data dictionaries.
    """
    logging.info(f"Generating {num_workers} workers with sequential names")

    num_workers = max(1, num_workers)
    if total_unpaid_earnings is None or total_unpaid_earnings <= 0:
        total_unpaid_earnings = 0.001

    online_count = max(1, int(num_workers * 0.8))
    offline_count = num_workers - online_count
    avg_hashrate = max(0.5, total_hashrate / online_count if online_count > 0 else 0)

    current_time = datetime.now(ZoneInfo(get_timezone()))
    workers = []

    for i in range(online_count):
        model_idx = random.randint(0, len(MINER_MODELS) - 2) if avg_hashrate > 5 else len(MINER_MODELS) - 1
        model_info = MINER_MODELS[model_idx]
        base_hr = min(model_info["max_hashrate"], avg_hashrate * random.uniform(0.5, 1.5))
        workers.append(
            {
                "name": f"Miner_{i + 1}",
                "status": "online",
                "type": model_info["type"],
                "model": model_info["model"],
                "hashrate_60sec": round(base_hr * random.uniform(0.9, 1.1), 2),
                "hashrate_60sec_unit": hashrate_unit,
                "hashrate_3hr": round(base_hr * random.uniform(0.85, 1.0), 2),
                "hashrate_3hr_unit": hashrate_unit,
                "efficiency": round(random.uniform(65, 95), 1),
                "last_share": (current_time - timedelta(minutes=random.randint(0, 5))).strftime("%Y-%m-%d %H:%M"),
                "earnings": 0,
                "power_consumption": model_info["power"],
                "temperature": random.randint(55, 70) if model_info["type"] == "ASIC" else random.randint(45, 55),
            }
        )

    for i in range(offline_count):
        model_info = MINER_MODELS[-1] if random.random() > 0.6 else random.choice(MINER_MODELS[:-1])
        hashrate_3hr = (
            round(random.uniform(1, 3), 2)
            if model_info["type"] == "Bitaxe"
            else round(random.uniform(20, 90), 2)
        )
        idx = i + online_count
        workers.append(
            {
                "name": f"Miner_{idx + 1}",
                "status": "offline",
                "type": model_info["type"],
                "model": model_info["model"],
                "hashrate_60sec": 0,
                "hashrate_60sec_unit": hashrate_unit,
                "hashrate_3hr": hashrate_3hr,
                "hashrate_3hr_unit": hashrate_unit,
                "efficiency": 0,
                "last_share": (current_time - timedelta(hours=random.uniform(0.5, 8))).strftime("%Y-%m-%d %H:%M"),
                "earnings": 0,
                "power_consumption": round(model_info["power"] * hashrate_3hr / model_info["max_hashrate"])
                if hashrate_3hr > 0
                else 0,
                "temperature": 0,
            }
        )

    _distribute_earnings(workers, total_unpaid_earnings)
    logging.info(f"Generated {len(workers)} workers with sequential names")
    return workers


def generate_simulated_workers(
    num_workers: int,
    total_hashrate: float,
    hashrate_unit: str,
    total_unpaid_earnings: float | None = None,
    real_worker_names: list | None = None,
) -> list:
    """
    Generate simulated workers, optionally using known real worker names.

    Scales online workers' hashrates so they sum to exactly
    ``total_hashrate``, then distributes earnings proportionally.

    Args:
        num_workers: Number of workers to generate (min 1).
        total_hashrate: Target total hashrate across all online workers.
        hashrate_unit: Hashrate unit string (e.g. ``'TH/s'``).
        total_unpaid_earnings: Total unpaid BTC earnings to distribute.
        real_worker_names: Real worker names to use instead of random names.

    Returns:
        list[dict]: Generated worker data dictionaries.
    """
    num_workers = max(1, num_workers)
    if total_unpaid_earnings is None or total_unpaid_earnings <= 0:
        total_unpaid_earnings = 0.001

    online_count = max(1, int(num_workers * 0.8))
    offline_count = num_workers - online_count
    avg_hashrate = max(0.5, total_hashrate / online_count if online_count > 0 else 0)

    current_time = datetime.now(ZoneInfo(get_timezone()))

    # Prepare name list — cycle real names if not enough
    name_list: list = []
    if real_worker_names:
        logging.info(f"Using {len(real_worker_names)} real worker names")
        name_list = (real_worker_names * (num_workers // len(real_worker_names) + 1))[:num_workers]

    def _pick_name(index: int) -> str:
        if name_list and index < len(name_list):
            return name_list[index]
        model_type = MINER_MODELS[index % len(MINER_MODELS)]["type"]
        prefix = WORKER_NAME_PREFIXES[-1] if model_type == "Bitaxe" else random.choice(WORKER_NAME_PREFIXES[:-1])
        return f"{prefix}{random.randint(1, 99):02d}"

    workers = []

    for i in range(online_count):
        model_idx = random.randint(0, len(MINER_MODELS) - 2) if avg_hashrate > 5 else len(MINER_MODELS) - 1
        model_info = MINER_MODELS[model_idx]
        base_hr = min(model_info["max_hashrate"], avg_hashrate * random.uniform(0.5, 1.5))
        workers.append(
            {
                "name": _pick_name(i),
                "status": "online",
                "type": model_info["type"],
                "model": model_info["model"],
                "hashrate_60sec": round(base_hr * random.uniform(0.9, 1.1), 2),
                "hashrate_60sec_unit": hashrate_unit,
                "hashrate_3hr": round(base_hr * random.uniform(0.85, 1.0), 2),
                "hashrate_3hr_unit": hashrate_unit,
                "efficiency": round(random.uniform(65, 95), 1),
                "last_share": (current_time - timedelta(minutes=random.randint(0, 3))).strftime("%Y-%m-%d %H:%M"),
                "earnings": 0,
                "power_consumption": model_info["power"],
                "temperature": random.randint(55, 70) if model_info["type"] == "ASIC" else random.randint(45, 55),
            }
        )

    for i in range(offline_count):
        model_info = MINER_MODELS[-1] if random.random() > 0.6 else random.choice(MINER_MODELS[:-1])
        hashrate_3hr = (
            round(random.uniform(1, 3), 2)
            if model_info["type"] == "Bitaxe"
            else round(random.uniform(20, 90), 2)
        )
        idx = i + online_count
        workers.append(
            {
                "name": _pick_name(idx),
                "status": "offline",
                "type": model_info["type"],
                "model": model_info["model"],
                "hashrate_60sec": 0,
                "hashrate_60sec_unit": hashrate_unit,
                "hashrate_3hr": hashrate_3hr,
                "hashrate_3hr_unit": hashrate_unit,
                "efficiency": 0,
                "last_share": (current_time - timedelta(hours=random.uniform(0.5, 8))).strftime("%Y-%m-%d %H:%M"),
                "earnings": 0,
                "power_consumption": round(model_info["power"] * hashrate_3hr / model_info["max_hashrate"])
                if hashrate_3hr > 0
                else 0,
                "temperature": 0,
            }
        )

    # Scale online hashrates to exactly match total_hashrate
    current_online_total = sum(w["hashrate_3hr"] for w in workers if w["status"] == "online")
    if online_count > 0 and abs(current_online_total - total_hashrate) > 0.01 and current_online_total > 0:
        scale = total_hashrate / current_online_total
        online_workers_list = [w for w in workers if w["status"] == "online"]
        for i, w in enumerate(online_workers_list):
            if i < len(online_workers_list) - 1:
                w["hashrate_3hr"] = round(w["hashrate_3hr"] * scale, 2)
                if w["hashrate_60sec"] > 0:
                    w["hashrate_60sec"] = round(w["hashrate_60sec"] * scale, 2)
            else:
                # Last online worker absorbs the remainder to avoid rounding drift.
                # Clamp to 0 to prevent negative values if earlier rounded values
                # summed to more than total_hashrate.
                assigned = sum(ow["hashrate_3hr"] for ow in online_workers_list[:-1])
                w["hashrate_3hr"] = max(0.0, round(total_hashrate - assigned, 2))
                if w["hashrate_60sec"] > 0:
                    w["hashrate_60sec"] = round(w["hashrate_60sec"] * scale, 2)

    _distribute_earnings(workers, total_unpaid_earnings)
    return workers
