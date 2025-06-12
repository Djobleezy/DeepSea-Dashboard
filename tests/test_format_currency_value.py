import types
import sys

# Provide lightweight pytz and requests stubs if not available
if 'pytz' not in sys.modules:
    tz_module = types.ModuleType('pytz')

    class DummyTZInfo:
        def utcoffset(self, dt):
            return None
        def dst(self, dt):
            return None
        def tzname(self, dt):
            return 'UTC'
        def localize(self, dt_obj):
            return dt_obj.replace(tzinfo=self)

    tz_module.timezone = lambda name: DummyTZInfo()
    sys.modules['pytz'] = tz_module

if 'requests' not in sys.modules:
    req_module = types.ModuleType('requests')

    class DummySession:
        def get(self, *args, **kwargs):
            raise NotImplementedError

    req_module.Session = DummySession
    req_module.exceptions = types.SimpleNamespace(Timeout=Exception, ConnectionError=Exception)
    sys.modules['requests'] = req_module

from notification_service import format_currency_value


def test_format_currency_value_with_string():
    rates = {'EUR': 0.5}
    result = format_currency_value('10', 'EUR', rates)
    assert result == '€5.00'


def test_format_currency_value_invalid():
    rates = {'USD': 1}
    result = format_currency_value('abc', 'USD', rates)
    assert result == 'N/A'
