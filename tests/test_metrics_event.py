import importlib


def test_update_metrics_sets_event(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))

    class DummyTimer:
        def __init__(self, timeout, handler):
            self.timeout = timeout
            self.handler = handler
        def start(self):
            pass
        def cancel(self):
            pass
        def is_alive(self):
            return False
        def join(self):
            pass

    monkeypatch.setattr(App.threading, "Timer", DummyTimer)
    monkeypatch.setattr(App.dashboard_service, "fetch_metrics", lambda: {"server_timestamp": 1})
    monkeypatch.setattr(App.notification_service, "check_and_generate_notifications", lambda *a, **k: None)
    monkeypatch.setattr(App.state_manager, "update_metrics_history", lambda metrics: None)
    monkeypatch.setattr(App.state_manager, "persist_critical_state", lambda *a, **k: None)
    monkeypatch.setattr(App.state_manager, "prune_old_data", lambda *a, **k: None)
    monkeypatch.setattr(App.state_manager, "save_graph_state", lambda: None)
    monkeypatch.setattr(App, "adaptive_gc", lambda: False)
    monkeypatch.setattr(App, "log_memory_usage", lambda: None)
    monkeypatch.setattr(App.notification_service, "add_notification", lambda *a, **k: None)
    monkeypatch.setattr(App, "load_config", lambda: {})
    monkeypatch.setitem(App.MEMORY_CONFIG, "ADAPTIVE_GC_ENABLED", False)

    events = {"set": False}
    monkeypatch.setattr(App.metrics_update_event, "set", lambda: events.__setitem__("set", True))

    App.update_metrics_job(force=True)

    assert events["set"]

