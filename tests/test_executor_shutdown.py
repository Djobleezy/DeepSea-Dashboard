def test_service_close_waits_for_executor(monkeypatch):
    """MiningDashboardService.close should wait for executor threads to finish."""
    from data_service import MiningDashboardService

    svc = MiningDashboardService(0, 0, "wallet")

    called = {}

    def fake_shutdown(wait=True):
        called["wait"] = wait

    monkeypatch.setattr(svc.executor, "shutdown", fake_shutdown)
    monkeypatch.setattr(svc.session, "close", lambda: None, raising=False)
    svc.close()

    assert called.get("wait") is True

