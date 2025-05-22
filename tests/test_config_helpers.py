import json
import importlib

import config as config_module


def create_config(tmp_path, **kwargs):
    cfg = {
        "timezone": "UTC",
        "currency": "USD",
        "EXCHANGE_RATE_API_KEY": "DEFAULTKEY",
    }
    cfg.update(kwargs)
    path = tmp_path / "cfg.json"
    with open(path, "w") as fh:
        json.dump(cfg, fh)
    return path


def reload_config(monkeypatch, path):
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(path))
    return importlib.reload(config_module)


# ----- get_timezone -----

def test_get_timezone_env(monkeypatch, tmp_path):
    path = create_config(tmp_path, timezone="America/New_York")
    mod = reload_config(monkeypatch, path)
    monkeypatch.setenv("TIMEZONE", "Asia/Tokyo")
    assert mod.get_timezone() == "Asia/Tokyo"


def test_get_timezone_config(monkeypatch, tmp_path):
    path = create_config(tmp_path, timezone="Europe/Berlin")
    mod = reload_config(monkeypatch, path)
    monkeypatch.delenv("TIMEZONE", raising=False)
    assert mod.get_timezone() == "Europe/Berlin"


# ----- get_currency -----

def test_get_currency_env(monkeypatch, tmp_path):
    path = create_config(tmp_path, currency="GBP")
    mod = reload_config(monkeypatch, path)
    monkeypatch.setenv("CURRENCY", "EUR")
    assert mod.get_currency() == "EUR"


def test_get_currency_config(monkeypatch, tmp_path):
    path = create_config(tmp_path, currency="AUD")
    mod = reload_config(monkeypatch, path)
    monkeypatch.delenv("CURRENCY", raising=False)
    assert mod.get_currency() == "AUD"


# ----- get_exchange_rate_api_key -----

def test_get_exchange_rate_api_key_env(monkeypatch, tmp_path):
    path = create_config(tmp_path, EXCHANGE_RATE_API_KEY="CFGKEY")
    mod = reload_config(monkeypatch, path)
    monkeypatch.setenv("EXCHANGE_RATE_API_KEY", "ENVKEY")
    assert mod.get_exchange_rate_api_key() == "ENVKEY"


def test_get_exchange_rate_api_key_config(monkeypatch, tmp_path):
    path = create_config(tmp_path, EXCHANGE_RATE_API_KEY="CFGONLY")
    mod = reload_config(monkeypatch, path)
    monkeypatch.delenv("EXCHANGE_RATE_API_KEY", raising=False)
    assert mod.get_exchange_rate_api_key() == "CFGONLY"

