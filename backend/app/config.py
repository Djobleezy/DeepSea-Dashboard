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
    # Optional URL of a local DATUM Gateway (e.g.
    # ``http://datum_datum_1:21000`` on UmbrelOS, ``http://127.0.0.1:7152``
    # for a stock self-build).  Used by the dashboard to render a
    # *live* DATUM connection badge that doesn't depend on the lagging
    # ``pool_fees_percentage`` signal.  Leave blank to keep legacy
    # fee-only behaviour.  Environment variable ``DATUM_GATEWAY_URL``
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


def get_datum_gateway_url() -> str:
    """Return the configured DATUM gateway base URL (env > config).

    The env override exists so Docker/Umbrel deployments can wire this
    via compose without touching the JSON file.
    """
    import os

    env_url = os.environ.get("DATUM_GATEWAY_URL", "").strip().rstrip("/")
    if env_url:
        return env_url
    # Strip + rstrip the config value too so /api/health reports
    # ``datum_gateway_configured`` consistently with the probe, which
    # also normalises whitespace and trailing slashes in
    # ``datum_gateway_client._resolve_gateway_url``.
    cfg_url = (load_config().get("datum_gateway_url") or "").strip().rstrip("/")
    return cfg_url
