import importlib


class DummyStateManager:
    def __init__(self, *args, **kwargs):
        self.closed = False
        self.redis_client = None

    def get_notifications(self):
        return []

    def save_notifications(self, notifications):
        pass

    def load_critical_state(self):
        return None, None

    def close(self):
        self.closed = True


class DummyService:
    def __init__(self, *args, **kwargs):
        self.closed = False

    def close(self):
        self.closed = True


def test_previous_state_manager_closed(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))

    dummy = DummyStateManager()
    App.state_manager = dummy
    dummy_service = DummyService()
    App.dashboard_service = dummy_service

    monkeypatch.setattr("state_manager.StateManager", lambda *a, **k: DummyStateManager())
    monkeypatch.setattr("data_service.MiningDashboardService", lambda *a, **k: DummyService())

    App = importlib.reload(App)

    assert dummy.closed
    assert App._previous_state_manager is None
