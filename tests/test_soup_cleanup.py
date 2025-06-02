import importlib
from unittest.mock import MagicMock

import data_service
from data_service import MiningDashboardService


def test_soup_decomposed(monkeypatch):
    svc = MiningDashboardService(0, 0, "w")

    html = "<html><table><tbody id='payouts-tablerows'></tbody></table></html>"

    def fake_get(url, headers=None, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.text = html
        return resp

    monkeypatch.setattr(svc.session, "get", fake_get)

    real_bs4 = importlib.import_module("bs4")
    created = []
    decomposed = []

    class TrackingSoup(real_bs4.BeautifulSoup):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            created.append(self)

        def decompose(self):
            decomposed.append(self)
            super().decompose()

    monkeypatch.setattr(data_service, "BeautifulSoup", TrackingSoup)

    svc.get_payment_history_scrape()

    assert created
    assert decomposed and len(decomposed) == len(created)
