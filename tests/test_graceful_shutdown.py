import importlib
import logging
import signal


def test_graceful_shutdown_closes_handlers(monkeypatch):
    App = importlib.reload(importlib.import_module("App"))

    closed = []

    class DummyHandler(logging.Handler):
        def emit(self, record):
            pass

        def close(self):
            closed.append(True)

    handler = DummyHandler()
    logging.getLogger().addHandler(handler)

    monkeypatch.setattr(App, "scheduler", None)
    monkeypatch.setattr(App, "dashboard_service", None)
    monkeypatch.setattr(App.state_manager, "save_graph_state", lambda: None)
    monkeypatch.setattr(App.sys, "exit", lambda code=0: None)

    App.graceful_shutdown(signal.SIGTERM, None)

    logging.getLogger().removeHandler(handler)

    assert closed
