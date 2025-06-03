import importlib
import types


def test_record_memory_metrics_prunes_in_place(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))
    history = App.memory_usage_history
    monkeypatch.setitem(App.MEMORY_CONFIG, "MEMORY_HISTORY_MAX_ENTRIES", 3)

    class DummyProc:
        def memory_info(self):
            return types.SimpleNamespace(rss=1, vms=1)

        def memory_percent(self):
            return 1.0

    monkeypatch.setattr(App.psutil, "Process", lambda pid: DummyProc())
    monkeypatch.setattr(App, "get_timezone", lambda: "UTC")
    App.active_sse_connections = 0

    for _ in range(5):
        App.record_memory_metrics()

    assert len(App.memory_usage_history) == 3
    assert App.memory_usage_history is history
