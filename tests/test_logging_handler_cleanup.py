import importlib
import logging


def test_reload_closes_previous_log_handlers(monkeypatch):
    closed = []

    class DummyHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.closed = False

        def emit(self, record):
            pass

        def close(self):
            self.closed = True
            closed.append(self)

    monkeypatch.setattr(logging.handlers, "RotatingFileHandler", lambda *a, **k: DummyHandler())
    monkeypatch.setattr(logging, "StreamHandler", lambda *a, **k: DummyHandler())

    App = importlib.reload(importlib.import_module("App"))
    initial_handlers = list(logging.getLogger().handlers)

    App = importlib.reload(App)

    assert all(h.closed for h in initial_handlers)
