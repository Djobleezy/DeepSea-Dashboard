"""Application configuration — reads from config.json and environment variables."""

import json
import logging
import os
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", "/config/config.json"))
_DEFAULTS: dict[str, Any] = {
    "wallet": "",
    "power_cost": 0.12,
    "power_usage": 3450,
    "currency": "USD",
    "timezone": "America/Los_Angeles",
    "network_fee": 0.5,
    "extended_history": False,
    "exchange_rate_api_key": "",
}


def load_config() -> dict[str, Any]:
    """Load config from file, filling missing keys with defaults."""
    try:
        if CONFIG_PATH.exists():
            with CONFIG_PATH.open() as f:
                data = json.load(f)
            return {**_DEFAULTS, **data}
    except Exception as e:
        logging.warning(f"Could not load config from {CONFIG_PATH}: {e}")
    return dict(_DEFAULTS)


def save_config(data: dict[str, Any]) -> None:
    """Persist config to file atomically to avoid partial-read races."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    merged = {**load_config(), **data}

    tmp_path = CONFIG_PATH.with_suffix(f"{CONFIG_PATH.suffix}.tmp")
    with tmp_path.open("w") as f:
        json.dump(merged, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

    tmp_path.replace(CONFIG_PATH)


def get_wallet() -> str:
    return load_config().get("wallet", "")


def get_power_cost() -> float:
    return float(load_config().get("power_cost", 0.12))


def get_power_usage() -> float:
    return float(load_config().get("power_usage", 3450))


def get_currency() -> str:
    return load_config().get("currency", "USD")


def get_timezone() -> str:
    return load_config().get("timezone", "America/Los_Angeles")


def get_network_fee() -> float:
    return float(load_config().get("network_fee", 0.5))


def get_exchange_rate_api_key() -> str:
    return load_config().get("exchange_rate_api_key", "")
