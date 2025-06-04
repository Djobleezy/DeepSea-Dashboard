import sys
import types
import pytest

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

from notification_service import NotificationService


class DummyState:
    def get_notifications(self):
        return []

    def save_notifications(self, notifications):
        pass


def test_parse_numeric_value_with_commas():
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("1,234") == pytest.approx(1234)
    assert svc._parse_numeric_value("-2,000.5 TH/s") == pytest.approx(-2000.5)


def test_parse_numeric_value_without_space():
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("1,234.56TH/s") == pytest.approx(1234.56)


def test_parse_numeric_value_with_prefix_text():
    """Numbers appearing after text should still be parsed correctly."""
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("Hashrate: 1,234.5 TH/s") == pytest.approx(1234.5)


def test_parse_numeric_value_with_sign_and_space():
    """Negative values with spaces after the sign should parse correctly."""
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("- 2,000.5 TH/s") == pytest.approx(-2000.5)
