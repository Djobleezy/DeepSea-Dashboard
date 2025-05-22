import importlib
import sys
import types

if 'pytest' not in sys.modules:
    pytest = types.ModuleType('pytest')
    def fixture(func=None, **kwargs):
        if func is None:
            return lambda f: f
        return func
    pytest.fixture = fixture
    sys.modules['pytest'] = pytest
else:
    import pytest


@pytest.fixture
def sse_client(monkeypatch):
    import apscheduler.schedulers.background as bg
    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)

    App = importlib.reload(importlib.import_module("App"))

    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App, "MiningDashboardService", lambda *a, **k: object())
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    sample_cfg = {"wallet": "w"}
    monkeypatch.setattr(App, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(App, "save_config", lambda cfg: True)

    return App.app.test_client()


def parse_events(data):
    body = data.decode()
    return [e for e in body.split("\n\n") if e.strip()]


def test_stream_returns_data_when_cached(sse_client, monkeypatch):
    import App
    monkeypatch.setattr(App, "MAX_SSE_CONNECTION_TIME", 0)
    monkeypatch.setattr(App.time, "sleep", lambda x: None)
    App.cached_metrics = {"server_timestamp": 1, "val": 42}

    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    events = parse_events(resp.data)
    assert len(events) >= 2
    assert "\"val\": 42" in events[0]


def test_stream_connection_limit(sse_client, monkeypatch):
    import App
    monkeypatch.setattr(App, "MAX_SSE_CONNECTION_TIME", 0)
    App.active_sse_connections = App.MAX_SSE_CONNECTIONS
    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    body = resp.data.decode()
    assert "Too many connections" in body
