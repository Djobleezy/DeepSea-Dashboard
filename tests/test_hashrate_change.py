import sys
import types
from notification_service import NotificationService

# Provide lightweight stubs for missing dependencies
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


class DummyState:
    def get_notifications(self):
        return []
    def save_notifications(self, notifications):
        pass


def make_service():
    return NotificationService(DummyState())


def test_switches_to_3hr_when_low_hashrate():
    svc = make_service()
    current = {
        "hashrate_3hr": "2.0",
        "hashrate_3hr_unit": "TH/s",
        "hashrate_10min": "2.2",
        "hashrate_10min_unit": "TH/s",
    }
    previous = {
        "hashrate_3hr": "4.0",
        "hashrate_3hr_unit": "TH/s",
        "hashrate_10min": "2.2",
        "hashrate_10min_unit": "TH/s",
    }
    result = svc._check_hashrate_change(current, previous)
    assert result is not None
    assert result["data"]["timeframe"] == "3hr"
    assert result["data"]["is_low_hashrate_mode"] is True
    assert result["data"]["previous"] == 4.0
    assert result["data"]["current"] == 2.0


def test_uses_10min_when_hashrate_normal():
    svc = make_service()
    current = {
        "hashrate_3hr": "5.0",
        "hashrate_3hr_unit": "TH/s",
        "hashrate_10min": "8.0",
        "hashrate_10min_unit": "TH/s",
    }
    previous = {
        "hashrate_3hr": "4.5",
        "hashrate_3hr_unit": "TH/s",
        "hashrate_10min": "4.0",
        "hashrate_10min_unit": "TH/s",
    }
    result = svc._check_hashrate_change(current, previous)
    assert result is not None
    assert result["data"]["timeframe"] == "10min"
    assert result["data"]["is_low_hashrate_mode"] is False
    assert result["data"]["previous"] == 4.0
    assert result["data"]["current"] == 8.0
