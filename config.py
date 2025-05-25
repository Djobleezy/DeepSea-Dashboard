"""
Configuration management module for the Bitcoin Mining Dashboard.
Responsible for loading and managing application settings.
"""

import os
import json
import logging

# Default configuration file path. When the module is reloaded for testing,
# a previously patched value for ``CONFIG_FILE`` should be preserved.  Using
# ``globals().get`` allows tests to monkeypatch ``CONFIG_FILE`` before
# reloading the module and have that value persist across the reload.
CONFIG_FILE = globals().get("CONFIG_FILE", "config.json")

# Cached configuration and its modification time
_cached_config = None
_config_mtime = None

# Default configuration values
DEFAULT_CONFIG = {
    "power_cost": 0.0,
    "power_usage": 0.0,
    "wallet": "yourwallethere",
    "timezone": "America/Los_Angeles",
    "network_fee": 0.0,
    "currency": "USD",
    "EXCHANGE_RATE_API_KEY": "179cbeb07c900f20dde92d3b",
}


def validate_config(config):
    """Validate configuration values."""
    required_types = {
        "power_cost": (int, float),
        "power_usage": (int, float),
        "wallet": str,
        "timezone": str,
        "network_fee": (int, float),
        "currency": str,
        "EXCHANGE_RATE_API_KEY": str,
    }

    for key, expected in required_types.items():
        if key not in config:
            logging.error("Missing configuration key: %s", key)
            return False
        if not isinstance(config[key], expected):
            logging.error("Invalid type for %s", key)
            return False
    return True


def load_config():
    """Load configuration with caching and modification time checks."""
    global _cached_config, _config_mtime

    file_exists = os.path.exists(CONFIG_FILE)

    if file_exists:
        try:
            mtime = os.path.getmtime(CONFIG_FILE)
        except Exception as e:
            logging.error(f"Error checking config mtime: {e}")
            mtime = None

        if _cached_config is not None and _config_mtime == mtime:
            return _cached_config

        try:
            with open(CONFIG_FILE, "r") as f:
                loaded = json.load(f)
            config = {**DEFAULT_CONFIG, **loaded}
            logging.info(f"Configuration loaded from {CONFIG_FILE}")

            if not validate_config(config):
                raise ValueError("Invalid configuration file")

            _cached_config = config
            _config_mtime = mtime
            return config
        except Exception as e:
            logging.error(f"Error loading config: {e}")

    if _cached_config is not None:
        return _cached_config

    if not file_exists:
        logging.warning(f"Config file {CONFIG_FILE} not found, using defaults")

    _cached_config = DEFAULT_CONFIG
    _config_mtime = os.path.getmtime(CONFIG_FILE) if file_exists else None
    return DEFAULT_CONFIG


def get_timezone():
    """Return the configured timezone or a safe default."""
    import os
    from zoneinfo import ZoneInfo

    tz = os.environ.get("TIMEZONE")
    if not tz:
        cfg = load_config()
        tz = cfg.get("timezone")

    if not tz:
        tz = "America/Los_Angeles"

    try:
        ZoneInfo(tz)
    except Exception:
        logging.warning("Invalid timezone '%s', falling back to UTC", tz)
        tz = "UTC"

    return tz


def save_config(config):
    """
    Save configuration to file.

    Args:
        config (dict): Configuration dictionary to save

    Returns:
        bool: True if save was successful, False otherwise
    """
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
        logging.info(f"Configuration saved to {CONFIG_FILE}")
        return True
    except Exception as e:
        logging.error(f"Error saving config: {e}")
        return False


def get_value(key, default=None):
    """
    Get a configuration value by key with fallback to default.

    Args:
        key (str): Configuration key to look up
        default: Default value if key is not found

    Returns:
        Value for the key or default if not found
    """
    config = load_config()
    return config.get(key, default)


def get_currency():
    """
    Get the configured currency with fallback to default.

    Returns:
        str: Currency code (e.g., 'USD', 'EUR', etc.)
    """
    # First check environment variable (for Docker)
    import os

    env_currency = os.environ.get("CURRENCY")
    if env_currency:
        return env_currency

    # Then check config file
    config = load_config()
    currency = config.get("currency")
    if currency:
        return currency

    # Default to USD
    return "USD"


def get_exchange_rate_api_key():
    """Get the ExchangeRate API key from env or config."""
    env_key = os.environ.get("EXCHANGE_RATE_API_KEY")
    if env_key:
        return env_key

    config = load_config()
    return config.get("EXCHANGE_RATE_API_KEY", "")
