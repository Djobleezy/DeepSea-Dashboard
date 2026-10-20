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
import math
import os
from pathlib import Path
from threading import RLock
from typing import Any

_save_lock = RLock()

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
    # Optional URL of a local DATUM Gateway (e.g.
    # ``http://datum_datum_1:21000`` on UmbrelOS, ``http://127.0.0.1:7152``
    # for a stock self-build). Used for a gateway reachability check,
    # separate from historical pool-fee evidence. Leave blank to use
    # fee evidence only unless autodiscovery is enabled.
    # Environment variable ``DATUM_GATEWAY_URL``
    # overrides this field at request time.
    "datum_gateway_url": "",
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
    # Both the Config and Workers rate endpoints write this shared file.
    with _save_lock:
        _save_config_unlocked(data)


def _save_config_unlocked(data: dict[str, Any]) -> None:
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


def import_legacy_power_cost(rate: float) -> bool:
    """Import the old Workers rate only while Config still uses its default.

    Before the migration marker exists, an explicitly chosen 0.12 cannot be
    distinguished from the shipped default. Treat it as the default once;
    later explicit writes are protected by the database migration marker.
    Non-default Config values always take precedence.
    """
    if not math.isfinite(rate) or not 0 <= rate <= 10:
        return False
    with _save_lock:
        current = load_config().get("power_cost", 0.12)
        if isinstance(current, bool):
            return False
        try:
            configured_rate = float(current)
        except (TypeError, ValueError):
            return False
        if configured_rate != 0.12 or rate == configured_rate:
            return False
        _save_config_unlocked({"power_cost": rate})
        return True


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


def get_datum_gateway_url() -> str:
    """Return the validated gateway URL used by the live probe."""
    from app.services.datum_gateway_client import _resolve_gateway_url

    return _resolve_gateway_url() or ""
