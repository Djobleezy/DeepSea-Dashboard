import types
import sys
from unittest.mock import MagicMock

from data_service import MiningDashboardService
import data_service

# Provide lightweight stubs if dependencies are missing
if "pytz" not in sys.modules:
    tz_module = types.ModuleType("pytz")

    class DummyTZInfo:
        def utcoffset(self, dt):
            return None

        def dst(self, dt):
            return None

        def tzname(self, dt):
            return "UTC"

        def localize(self, dt_obj):
            return dt_obj.replace(tzinfo=self)

    tz_module.timezone = lambda name: DummyTZInfo()
    sys.modules["pytz"] = tz_module

if "requests" not in sys.modules:
    req_module = types.ModuleType("requests")

    class DummySession:
        def get(self, *args, **kwargs):
            raise NotImplementedError

    req_module.Session = DummySession
    req_module.exceptions = types.SimpleNamespace(Timeout=Exception, ConnectionError=Exception)
    sys.modules["requests"] = req_module

if "bs4" not in sys.modules:
    bs4_module = types.ModuleType("bs4")

    class DummySoup:
        pass

    bs4_module.BeautifulSoup = DummySoup
    sys.modules["bs4"] = bs4_module


def make_service():
    return MiningDashboardService(0, 0, "w")


def test_get_all_worker_rows_returns_dicts(monkeypatch):
    svc = make_service()

    html = """
    <table><tbody id='workers-tablerows'>
      <tr class='table-row'><td>A</td><td>online</td></tr>
    </tbody></table>
    """
    html_empty = "<table><tbody id='workers-tablerows'></tbody></table>"

    def fake_get(url, timeout=15):
        resp = MagicMock()
        resp.ok = True
        if "wpage=0" in url:
            resp.text = html
        else:
            resp.text = html_empty
        return resp

    monkeypatch.setattr(svc.session, "get", fake_get)
    import importlib
    real_bs4 = importlib.import_module("bs4")
    monkeypatch.setattr(data_service, "BeautifulSoup", real_bs4.BeautifulSoup)

    rows = svc.get_all_worker_rows()
    assert isinstance(rows, list)
    assert rows and isinstance(rows[0], dict)
    assert rows[0]["cells"] == ["A", "online"]


def test_get_worker_data_alternative_basic(monkeypatch):
    svc = make_service()

    html = """
    <table><tbody id='workers-tablerows'>
      <tr class='table-row'>
        <td>rig1</td><td>online</td><td>now</td><td>100 TH/s</td><td>90 TH/s</td><td>0.00000100 BTC</td>
      </tr>
    </tbody></table>
    """
    html_empty = "<table><tbody id='workers-tablerows'></tbody></table>"

    def fake_get(url, timeout=15):
        resp = MagicMock()
        resp.ok = True
        if "wpage=0" in url:
            resp.text = html
        else:
            resp.text = html_empty
        return resp

    monkeypatch.setattr(svc.session, "get", fake_get)
    import importlib
    real_bs4 = importlib.import_module("bs4")
    monkeypatch.setattr(data_service, "BeautifulSoup", real_bs4.BeautifulSoup)

    data = svc.get_worker_data_alternative()
    assert data["workers_total"] == 1
    w = data["workers"][0]
    assert w["name"] == "rig1"
    assert w["status"] == "online"
    assert w["hashrate_3hr"] == 90.0

