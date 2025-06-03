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

