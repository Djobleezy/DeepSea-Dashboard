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
    # Prevent scheduler from starting
    import apscheduler.schedulers.background as bg

    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)

    App = importlib.reload(importlib.import_module("App"))

    # Patch functions that interact with external systems
    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App, "MiningDashboardService", lambda *a, **k: object())
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    sample_cfg = {"wallet": "w"}
    monkeypatch.setattr(App, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(App, "save_config", lambda cfg: True)

    return App.app.test_client()


def test_health_endpoint(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "status" in data


def test_get_config_endpoint(client):
    resp = client.get("/api/config")
    assert resp.status_code == 200
    assert resp.get_json()["wallet"] == "w"


def test_update_config_endpoint(client):
    resp = client.post("/api/config", json={"wallet": "abc"})
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "success"


def test_payout_history_endpoint(client):
    resp = client.get("/api/payout-history")
    assert resp.status_code == 200
    assert resp.get_json()["payout_history"] == []

    record = {"timestamp": "2023-01-01T00:00:00Z", "amountBTC": "0.1"}
    resp = client.post("/api/payout-history", json={"record": record})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "success"

    resp = client.get("/api/payout-history")
    data = resp.get_json()
    assert len(data["payout_history"]) == 1
    assert data["payout_history"][0]["amountBTC"] == "0.1"

    resp = client.delete("/api/payout-history")
    assert resp.status_code == 200
    resp = client.get("/api/payout-history")
    assert resp.get_json()["payout_history"] == []


def test_block_events_endpoint(client):
    import App
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    App.notification_service.notifications = [
        {
            "id": "1",
            "timestamp": (now - timedelta(minutes=5)).isoformat(),
            "message": "",
            "level": "success",
            "category": "block",
            "read": False,
            "data": {"block_height": 100},
        },
        {
            "id": "2",
            "timestamp": (now - timedelta(minutes=10)).isoformat(),
            "message": "",
            "level": "success",
            "category": "block",
            "read": False,
            "data": {"block_height": 101},
        },
        {
            "id": "3",
            "timestamp": (now - timedelta(minutes=200)).isoformat(),
            "message": "",
            "level": "success",
            "category": "block",
            "read": False,
            "data": {"block_height": 102},
        },
    ]

    resp = client.get("/api/block-events?limit=2&minutes=180")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "events" in data
    events = data["events"]
    assert len(events) <= 2

    cutoff = now - timedelta(minutes=180)
    timestamps = []
    for ev in events:
        ts = datetime.fromisoformat(ev["timestamp"])
        assert ts >= cutoff
        timestamps.append(ev["timestamp"])

    assert len(timestamps) == len(set(timestamps))
    if len(events) > 1:
        assert events[0]["timestamp"] >= events[1]["timestamp"]


def test_metrics_endpoint(client, monkeypatch):
    import App

    metrics = {"value": 1}

    def fake_update(force=False):
        App.cached_metrics = metrics

    monkeypatch.setattr(App, "update_metrics_job", fake_update)
    App.cached_metrics = None
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    assert resp.get_json() == metrics


def test_notifications_unread_count_endpoint(client):
    import App

    App.notification_service.notifications = [
        {"id": "1", "read": False},
        {"id": "2", "read": True},
        {"id": "3", "read": False},
    ]

    resp = client.get("/api/notifications/unread_count")
    assert resp.status_code == 200
    assert resp.get_json()["unread_count"] == 2


def test_mark_read_endpoint(client):
    import App

    App.notification_service.notifications = [
        {"id": "1", "read": False},
        {"id": "2", "read": False},
    ]

    resp = client.post("/api/notifications/mark_read", json={"notification_id": "1"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["unread_count"] == 1
    assert App.notification_service.notifications[0]["read"] is True


def test_delete_notification_endpoint(client):
    import App

    App.notification_service.notifications = [
        {"id": "1", "read": False},
        {"id": "2", "read": False},
    ]

    resp = client.post("/api/notifications/delete", json={"notification_id": "1"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["unread_count"] == 1
    assert len(App.notification_service.notifications) == 1
    assert App.notification_service.notifications[0]["id"] == "2"


def test_clear_notifications_endpoint(client):
    import App

    App.notification_service.notifications = [
        {"id": "1", "read": True, "category": "system", "timestamp": "2023-01-01T00:00:00"},
        {"id": "2", "read": False, "category": "system", "timestamp": "2023-01-02T00:00:00"},
        {"id": "3", "read": True, "category": "system", "timestamp": "2023-01-03T00:00:00"},
    ]

    resp = client.post("/api/notifications/clear", json={"read_only": True})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["cleared_count"] == 2
    assert data["unread_count"] == 1
    assert len(App.notification_service.notifications) == 1
    assert App.notification_service.notifications[0]["id"] == "2"
