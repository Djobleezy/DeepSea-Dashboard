import json
import importlib
import os
import config as config_module

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
