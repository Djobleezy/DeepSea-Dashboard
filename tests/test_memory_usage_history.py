import importlib
import types
from collections import deque


def test_record_memory_metrics_prunes_in_place(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))
    import memory_manager
    import sse_service
    history = deque(maxlen=3)
    App.memory_usage_history = history
    memory_manager.memory_usage_history = history
    monkeypatch.setitem(App.MEMORY_CONFIG, "MEMORY_HISTORY_MAX_ENTRIES", 3)

    class DummyProc:
        def memory_info(self):
            return types.SimpleNamespace(rss=1, vms=1)

        def memory_percent(self):
            return 1.0

    monkeypatch.setattr(App.psutil, "Process", lambda pid: DummyProc())
    monkeypatch.setattr(App, "get_timezone", lambda: "UTC")
    sse_service.active_sse_connections = 0

    for _ in range(5):
        App.record_memory_metrics()

    assert len(App.memory_usage_history) == 3
    assert App.memory_usage_history is history
    assert isinstance(App.memory_usage_history, deque)
