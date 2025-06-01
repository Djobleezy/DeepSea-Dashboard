import json
import importlib
import os
import config as config_module
import threading


def test_load_config_defaults(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    cfg = importlib.reload(config_module).load_config()
    assert cfg["currency"] == "USD"
    assert "EXCHANGE_RATE_API_KEY" in cfg


def test_load_config_file(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"currency": "EUR"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    cfg = importlib.reload(config_module).load_config()
    assert cfg["currency"] == "EUR"
    assert "network_fee" in cfg
    assert "EXCHANGE_RATE_API_KEY" in cfg


def test_load_config_thresholds(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"low_hashrate_threshold_ths": 5.5, "high_hashrate_threshold_ths": 25.0}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    cfg = importlib.reload(config_module).load_config()
    assert cfg["low_hashrate_threshold_ths"] == 5.5
    assert cfg["high_hashrate_threshold_ths"] == 25.0


def test_config_caching(monkeypatch, tmp_path):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"currency": "EUR"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    mod = importlib.reload(config_module)

    call_count = {"count": 0}
    orig_open = open

    def counting_open(*args, **kwargs):
        mode = args[1] if len(args) > 1 else kwargs.get("mode", "r")
        if "r" in mode:
            call_count["count"] += 1
        return orig_open(*args, **kwargs)

    monkeypatch.setattr("builtins.open", counting_open)

    cfg1 = mod.load_config()
    assert call_count["count"] == 1
    cfg2 = mod.load_config()
    assert call_count["count"] == 1
    assert cfg1 == cfg2

    with orig_open(temp_file, "w") as fh:
        json.dump({"currency": "USD"}, fh)
    os.utime(temp_file, (os.path.getmtime(temp_file) + 1, os.path.getmtime(temp_file) + 1))

    cfg3 = mod.load_config()
    assert call_count["count"] == 2
    assert cfg3["currency"] == "USD"


def test_validate_config_valid():
    cfg = {
        "power_cost": 0.1,
        "power_usage": 100,
        "wallet": "abc",
        "timezone": "UTC",
        "network_fee": 0.0,
        "currency": "USD",
        "low_hashrate_threshold_ths": 3.0,
        "high_hashrate_threshold_ths": 20.0,
        "EXCHANGE_RATE_API_KEY": "KEY",
    }
    assert config_module.validate_config(cfg)


def test_validate_config_missing_key():
    cfg = {
        "power_cost": 0.1,
        "power_usage": 100,
        "wallet": "abc",
        "timezone": "UTC",
        "network_fee": 0.0,
        "currency": "USD",
        "low_hashrate_threshold_ths": 3.0,
        "high_hashrate_threshold_ths": 20.0,
        "EXCHANGE_RATE_API_KEY": "KEY",
    }
    cfg.pop("wallet")
    assert not config_module.validate_config(cfg)


def test_load_config_invalid(monkeypatch, tmp_path):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"power_cost": "oops"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    mod = importlib.reload(config_module)
    cfg = mod.load_config()
    assert cfg == mod.DEFAULT_CONFIG


def test_thread_safe_load_config(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"currency": "USD"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    mod = importlib.reload(config_module)

    results = []
    errors = []

    def load_loop():
        try:
            for _ in range(20):
                results.append(mod.load_config()["currency"])
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=load_loop) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert all(r == "USD" for r in results)


def test_concurrent_load_and_save(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"currency": "USD"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    mod = importlib.reload(config_module)

    errors = []

    def saver(cur):
        try:
            for _ in range(10):
                cfg = {**mod.DEFAULT_CONFIG, "currency": cur}
                mod.save_config(cfg)
        except Exception as exc:
            errors.append(exc)

    def loader():
        try:
            for _ in range(20):
                mod.load_config()
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=loader) for _ in range(3)]
    threads += [threading.Thread(target=saver, args=("EUR",)),
                threading.Thread(target=saver, args=("JPY",))]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    final_cfg = mod.load_config()
    assert final_cfg["currency"] in {"EUR", "JPY"}
