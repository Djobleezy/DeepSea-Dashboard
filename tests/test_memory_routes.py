import importlib
import sys
import types
from collections import deque

if "pytest" not in sys.modules:
    pytest = types.ModuleType("pytest")

    def fixture(func=None, **kwargs):
        if func is None:
            return lambda f: f
        return func

    pytest.fixture = fixture
    sys.modules["pytest"] = pytest
else:
    import pytest


@pytest.fixture
def client(monkeypatch):
    import apscheduler.schedulers.background as bg

    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)
    importlib.reload(importlib.import_module("sse_service"))
    App = importlib.reload(importlib.import_module("App"))

    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App, "MiningDashboardService", lambda *a, **k: object())
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    sample_cfg = {"wallet": "w"}
    import config as cfg
    import config_routes
    monkeypatch.setattr(cfg, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(cfg, "save_config", lambda c: True)
    monkeypatch.setattr(config_routes, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(config_routes, "save_config", lambda c: True)

    return App.app.test_client()


def test_memory_history_endpoint(client, monkeypatch):
    import memory_routes
    import memory_manager

    history = deque([{"timestamp": "t1", "rss_mb": 1, "percent": 1}], maxlen=10)
    monkeypatch.setattr(memory_manager, "memory_usage_history", history)
    monkeypatch.setattr(memory_routes, "memory_usage_history", history)

    class DummyLock:
        def __enter__(self):
            pass

        def __exit__(self, exc_type, exc, tb):
            pass

    monkeypatch.setattr(memory_routes, "memory_usage_lock", DummyLock())

    class DummyProc:
        def __init__(self, _):
            pass

        def memory_info(self):
            return types.SimpleNamespace(rss=1024, vms=2048)

        def memory_percent(self):
            return 2.0

    monkeypatch.setattr(memory_routes.psutil, "Process", DummyProc)

    resp = client.get("/api/memory-history")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["history"] == list(history)
    assert data["current"]["percent"] == 2.0


def test_force_gc_endpoint(client, monkeypatch):
    import memory_routes

    sequence = {"flag": True}

    def fake_get_objects():
        if sequence["flag"]:
            sequence["flag"] = False
            return [1, 2, 3]
        return [1]

    monkeypatch.setattr(memory_routes.gc, "get_objects", fake_get_objects)
    monkeypatch.setattr(memory_routes.gc, "collect", lambda g: 2)
    monkeypatch.setattr(memory_routes, "log_memory_usage", lambda: None)

    resp = client.post("/api/force-gc", json={"generation": 1})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["generation"] == 1
    assert data["objects_removed"] == 2

