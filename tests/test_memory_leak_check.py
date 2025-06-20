import importlib
import logging


def test_memory_leak_check_shrinking_counts_no_warning(monkeypatch, caplog):
    """Ensure no warning is logged when object counts shrink after GC."""
    App = importlib.reload(importlib.import_module("App"))
    import memory_manager

    App.object_counts_history = {"object": 200}
    memory_manager.object_counts_history = App.object_counts_history
    App.last_leak_check_time = 0
    memory_manager.last_leak_check_time = 0

    monkeypatch.setattr(App.time, "time", lambda: 7200)
    monkeypatch.setattr(App.gc, "collect", lambda: None)
    monkeypatch.setattr(App.gc, "get_objects", lambda: [object() for _ in range(100)])

    notified = {"flag": False}
    monkeypatch.setattr(
        App.notification_service,
        "add_notification",
        lambda *args, **kwargs: notified.update(flag=True),
    )

    with caplog.at_level(logging.WARNING):
        App.check_for_memory_leaks()

    assert not any("Potential memory leaks detected" in rec.message for rec in caplog.records)
    assert not notified["flag"]


def test_memory_leak_check_requires_consecutive_growth(monkeypatch, caplog):
    """Ensure warning is only logged after growth persists across checks."""
    App = importlib.reload(importlib.import_module("App"))
    import memory_manager

    App.object_counts_history = {"object": 101}
    memory_manager.object_counts_history = App.object_counts_history
    App.leak_growth_tracker = {}
    memory_manager.leak_growth_tracker = App.leak_growth_tracker
    App.last_leak_check_time = 0
    memory_manager.last_leak_check_time = 0

    monkeypatch.setattr(App.time, "time", lambda: 7200)
    monkeypatch.setattr(App.gc, "collect", lambda: None)

    # First check - growth observed but should not trigger notification yet
    monkeypatch.setattr(App.gc, "get_objects", lambda: [object() for _ in range(160)])
    notified = {"flag": False}
    monkeypatch.setattr(
        App.notification_service,
        "add_notification",
        lambda *args, **kwargs: notified.update(flag=True),
    )
    with caplog.at_level(logging.WARNING):
        App.check_for_memory_leaks()
    assert not any("Potential memory leaks detected" in rec.message for rec in caplog.records)
    assert not notified["flag"]
    caplog.clear()

    # Second check with further growth - should now warn
    App.last_leak_check_time = 0
    memory_manager.last_leak_check_time = 0
    monkeypatch.setattr(App.gc, "get_objects", lambda: [object() for _ in range(250)])
    with caplog.at_level(logging.WARNING):
        App.check_for_memory_leaks()
    assert notified["flag"]
    assert App.leak_growth_tracker.get("object") == 2
