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
def sse_client(monkeypatch):
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


def parse_events(data):
    body = data.decode()
    return [e for e in body.split("\n\n") if e.strip()]


def test_stream_returns_data_when_cached(sse_client, monkeypatch):
    import App
    import sse_service

    monkeypatch.setattr(sse_service, "MAX_SSE_CONNECTION_TIME", 0)
    monkeypatch.setattr(App.time, "sleep", lambda x: None)
    App.cached_metrics = {"server_timestamp": 1, "val": 42}

    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    events = parse_events(resp.data)
    assert len(events) >= 2
    assert '"val": 42' in events[0]


def test_stream_connection_limit(sse_client, monkeypatch):
    import sse_service

    monkeypatch.setattr(sse_service, "MAX_SSE_CONNECTION_TIME", 0)
    sse_service.active_sse_connections = sse_service.MAX_SSE_CONNECTIONS
    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    body = resp.data.decode()
    assert "Too many connections" in body


def test_stream_converts_deque(sse_client, monkeypatch):
    """SSE output should convert deque objects to lists."""
    import App
    import sse_service
    from collections import deque

    monkeypatch.setattr(sse_service, "MAX_SSE_CONNECTION_TIME", 0)
    monkeypatch.setattr(App.time, "sleep", lambda x: None)
    App.cached_metrics = {"server_timestamp": 1, "history": deque([1, 2])}

    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    events = parse_events(resp.data)
    assert any('"history": [1, 2]' in e for e in events)


def test_stream_decrements_active_connections(sse_client, monkeypatch):
    """active_sse_connections should return to zero after stream ends."""
    import App
    import sse_service

    monkeypatch.setattr(sse_service, "MAX_SSE_CONNECTION_TIME", 0)
    monkeypatch.setattr(App.time, "sleep", lambda x: None)
    sse_service.active_sse_connections = 0
    App.cached_metrics = {"server_timestamp": 1}

    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    _ = resp.data  # consume generator
    assert sse_service.active_sse_connections == 0


def test_stream_connection_limit_does_not_decrement(sse_client, monkeypatch):
    """Connection limit errors should not change active_sse_connections."""
    import sse_service

    monkeypatch.setattr(sse_service, "MAX_SSE_CONNECTION_TIME", 0)
    sse_service.active_sse_connections = sse_service.MAX_SSE_CONNECTIONS

    resp = sse_client.get("/stream")
    assert resp.status_code == 200
    _ = resp.data  # consume generator
    assert sse_service.active_sse_connections == sse_service.MAX_SSE_CONNECTIONS
