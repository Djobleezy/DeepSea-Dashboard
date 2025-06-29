import importlib
import sys
import types

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

    App = importlib.reload(importlib.import_module("App"))

    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App, "MiningDashboardService", lambda *a, **k: object())
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    sample_cfg = {"wallet": "w", "extended_history": False}
    import config as cfg
    import config_routes
    monkeypatch.setattr(cfg, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(cfg, "save_config", lambda c: True)
    monkeypatch.setattr(config_routes, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(config_routes, "save_config", lambda c: True)

    return App.app.test_client()


def test_update_config_reinitializes_state_manager(client, monkeypatch):
    import App
    import app_setup

    old_sm = App.state_manager
    closed = {"flag": False}

    def close():
        closed["flag"] = True

    old_sm.close = close

    new_sm = object()
    monkeypatch.setattr(app_setup, "init_state_manager", lambda: new_sm)

    App.cached_metrics = {"foo": "bar"}

    resp = client.post("/api/config", json={"extended_history": True})
    assert resp.status_code == 200
    assert App.state_manager is new_sm
    assert closed["flag"]
    assert App.cached_metrics is None
