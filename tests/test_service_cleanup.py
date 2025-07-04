import weakref
import gc
from data_service import MiningDashboardService


def test_service_cleanup():
    """Service should be garbage collected after close."""
    svc = MiningDashboardService(0, 0, "test")
    ref = weakref.ref(svc)
    svc.close()
    del svc
    gc.collect()
    assert ref() is None


def test_service_close_closes_worker(monkeypatch):
    """close() should also close the associated worker service."""
    svc = MiningDashboardService(0, 0, "w")

    class DummyWorker:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    worker = DummyWorker()
    svc.set_worker_service(worker)

    monkeypatch.setattr(svc.executor, "shutdown", lambda wait=True, cancel_futures=True: None)
    monkeypatch.setattr(svc.session, "close", lambda: None, raising=False)

    svc.close()

    assert worker.closed


def test_service_purge_caches(monkeypatch):
    """purge_caches should clear ttl_cache decorated methods."""
    svc = MiningDashboardService(0, 0, "w")

    called = {"cleared": False}

    def dummy_cache_clear():
        called["cleared"] = True

    def dummy_func(self):
        return "x"

    dummy_func.cache_clear = dummy_cache_clear
    setattr(svc, "dummy", dummy_func.__get__(svc, type(svc)))

    svc.purge_caches()

    assert called["cleared"]

