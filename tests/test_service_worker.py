from pathlib import Path
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

    sample_cfg = {"wallet": "w"}
    import config as cfg
    import config_routes
    monkeypatch.setattr(cfg, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(cfg, "save_config", lambda c: True)
    monkeypatch.setattr(config_routes, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(config_routes, "save_config", lambda c: True)

    return App.app.test_client()


def test_service_worker_route(client):
    resp = client.get("/service-worker.js")
    assert resp.status_code == 200
    assert b"self.addEventListener" in resp.data


def test_service_worker_asset_list():
    js_path = Path("static/js/service-worker.js")
    assert js_path.exists()
    content = js_path.read_text()
    assert "/static/css/common.css" in content
    assert "/static/js/main.js" in content
