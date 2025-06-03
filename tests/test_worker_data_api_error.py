import importlib
from unittest.mock import MagicMock

import data_service
from data_service import MiningDashboardService


def test_get_worker_data_api_handles_request_failure(monkeypatch):
    svc = MiningDashboardService(0, 0, "w")

    def boom(url, timeout=10):
        raise Exception("boom")

    monkeypatch.setattr(svc.session, "get", boom)
    monkeypatch.setattr("data_service.get_timezone", lambda: "UTC")

    assert svc.get_worker_data_api() is None
