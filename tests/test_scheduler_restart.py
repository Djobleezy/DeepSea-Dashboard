import importlib


def test_create_scheduler_waits(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))

    class DummyScheduler:
        def __init__(self):
            self.running = True
            self.shutdown_called = None
        def shutdown(self, wait=False):
            self.shutdown_called = wait
        def add_job(self, *a, **k):
            pass
        def start(self):
            pass
        def get_jobs(self):
            return []

    existing = DummyScheduler()
    App.scheduler = existing
    monkeypatch.setattr(App, "BackgroundScheduler", lambda job_defaults=None: DummyScheduler())

    new_sched = App.create_scheduler()

    assert existing.shutdown_called is True
    assert isinstance(new_sched, DummyScheduler)
