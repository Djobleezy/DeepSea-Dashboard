import importlib
import types


def test_memory_watchdog_emergency(monkeypatch):
    """Ensure memory watchdog performs emergency cleanup when usage exceeds the threshold."""
    App = importlib.reload(importlib.import_module("App"))

    monkeypatch.setitem(App.MEMORY_CONFIG, "MEMORY_HIGH_WATERMARK", 2)

    class DummyProc:
        def memory_percent(self):
            return 3.0

        def memory_info(self):
            return types.SimpleNamespace(rss=1024 * 1024)

    monkeypatch.setattr(App.psutil, "Process", lambda pid: DummyProc())
    monkeypatch.setattr(App, "record_memory_metrics", lambda: None)
    gc_called = {"flag": False}
    monkeypatch.setattr(App.gc, "collect", lambda generation=2: gc_called.update(flag=True))
    prune_called = {"flag": False}
    monkeypatch.setattr(App.state_manager, "prune_old_data", lambda aggressive=True: prune_called.update(flag=True))

    cleared = {"flag": False}
    class DummyCache:
        def clear(self):
            cleared["flag"] = True
    App.dashboard_service = types.SimpleNamespace(cache=DummyCache())

    notified = {"flag": False}
    def dummy_notify(*args, **kwargs):
        notified["flag"] = True
    monkeypatch.setattr(App.notification_service, "add_notification", dummy_notify)

    App.memory_watchdog()

    assert gc_called["flag"]
    assert prune_called["flag"]
    assert cleared["flag"]
    assert notified["flag"]

