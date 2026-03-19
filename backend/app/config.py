"""Application configuration: loading, saving, and accessor helpers.

Configuration is stored in a JSON file at ``CONFIG_PATH`` (default
``/config/config.json``, overridable via the ``CONFIG_PATH`` environment
variable).  The file is created on first ``save_config`` call if it does not
yet exist.

**Load strategy** (``load_config``): reads the JSON file and deep-merges with
``_DEFAULTS`` so that keys added in new releases are available even in
pre-existing config files.  Returns the defaults dict on any read/parse error.

**Save strategy** (``save_config``): atomic write via ``rename(tmpfile →
config.json)`` with ``fsync`` for durability.  Falls back to an in-place write
for Docker bind-mounted files where cross-device rename fails (``EXDEV``).
File permissions are set to ``0600`` (owner read/write only) on every write.

**Accessor functions** (``get_wallet``, ``get_power_cost``, etc.) reload the
config on every call to pick up changes made via the API without requiring a
process restart.  This is intentionally simple; for high-frequency access
consider caching the result per request cycle.
"""

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
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as e:
        logging.warning(f"Could not load config from {CONFIG_PATH}: {e}")
    return dict(_DEFAULTS)


def save_config(data: dict[str, Any]) -> None:
    """Persist config to file safely.

    Tries atomic rename first; falls back to in-place write for
    Docker bind-mounted files where cross-device rename fails.
    Ensures restrictive file permissions (0600).
    """
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    merged = {**load_config(), **data}

    tmp_path = CONFIG_PATH.with_suffix(f"{CONFIG_PATH.suffix}.tmp")
    try:
        # Create temp file with owner-only permissions.
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(merged, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        tmp_path.replace(CONFIG_PATH)
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        # Bind-mounted files can't be atomically replaced — write in place
        tmp_path.unlink(missing_ok=True)
        fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(merged, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(CONFIG_PATH, 0o600)


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
