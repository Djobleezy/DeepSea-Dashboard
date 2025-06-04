from data_service import MiningDashboardService
import data_service


def make_service():
    return MiningDashboardService(0, 0, "w")


def test_get_all_worker_rows_closes_on_exception(monkeypatch):
    svc = make_service()

    class DummyResp:
        ok = True
        text = "<html></html>"
        closed = False

        def close(self):
            self.closed = True

    dummy_resp = DummyResp()
    monkeypatch.setattr(svc.session, "get", lambda url, timeout=15: dummy_resp)
    monkeypatch.setattr(data_service, "BeautifulSoup", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))

    rows = svc.get_all_worker_rows()
    assert rows == []
    assert dummy_resp.closed
