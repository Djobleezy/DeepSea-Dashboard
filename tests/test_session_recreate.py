from data_service import MiningDashboardService, CachedResponse
import data_service


def test_fetch_url_recreates_session(monkeypatch):
    svc = MiningDashboardService(0, 0, "w")
    svc.close()
    assert svc.session is None

    class DummyResp:
        ok = True
        status_code = 200
        text = "{}"
        closed = False

        def close(self):
            self.closed = True

    created = {"new": False}

    class DummySession:
        def __init__(self):
            created["new"] = True

        def get(self, url, timeout=5):
            return DummyResp()

        def close(self):
            pass

    monkeypatch.setattr(data_service.requests, "Session", DummySession)

    resp = svc.fetch_url("https://example.com")

    assert created["new"]
    assert isinstance(resp, CachedResponse)
    assert resp.ok
    svc.close()
