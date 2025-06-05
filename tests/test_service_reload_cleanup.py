import importlib


def test_previous_dashboard_service_closed(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))

    class DummyService:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    dummy = DummyService()
    App.dashboard_service = dummy

    monkeypatch.setattr("data_service.MiningDashboardService", lambda *a, **k: DummyService())

    App = importlib.reload(App)

    assert dummy.closed
    assert App._previous_dashboard_service is None

