import unittest
from unittest.mock import patch
import notification_service
import sys
import types

# Provide a lightweight pytz substitute if pytz is unavailable
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

# Stub requests module if not available
if "requests" not in sys.modules:
    req_module = types.ModuleType("requests")

    class DummySession:
        def get(self, *args, **kwargs):
            raise NotImplementedError

    req_module.Session = DummySession
    req_module.exceptions = types.SimpleNamespace(Timeout=Exception, ConnectionError=Exception)
    sys.modules["requests"] = req_module

# Stub bs4 module if not available
if "bs4" not in sys.modules:
    bs4_module = types.ModuleType("bs4")

    class DummySoup:
        pass

    bs4_module.BeautifulSoup = DummySoup
    sys.modules["bs4"] = bs4_module

from notification_service import NotificationService


class DummyStateManager:
    def __init__(self):
        self.redis_client = None
        self.saved = None

    def get_notifications(self):
        return []

    def save_notifications(self, notifications):
        self.saved = notifications
        return True


class NotificationCurrencyTest(unittest.TestCase):
    def setUp(self):
        self.state = DummyStateManager()
        self.service = NotificationService(self.state)
        self.service.notifications = [
            {
                "id": "1",
                "timestamp": "2023-01-01T00:00:00",
                "message": "Daily Mining Summary: 100 TH/s average hashrate, 100 SATS mined ($10.00)",
                "level": "info",
                "category": "hashrate",
                "data": {"daily_profit": 10.0, "currency": "USD"},
            }
        ]

    def test_update_notification_currency(self):
        with patch("notification_service.get_exchange_rates", return_value={"EUR": 0.5, "USD": 1.0}):
            updated = self.service.update_notification_currency("EUR")

        self.assertEqual(updated, 1)
        notif = self.service.notifications[0]
        self.assertEqual(notif["data"]["currency"], "EUR")
        self.assertAlmostEqual(notif["data"]["daily_profit"], 5.0)
        self.assertAlmostEqual(notif["data"]["daily_profit_usd"], 10.0)
        self.assertIn("€", notif["message"])

    def test_convert_back_to_usd(self):
        # First convert to JPY
        with patch("notification_service.get_exchange_rates", return_value={"JPY": 150, "USD": 1}):
            self.service.update_notification_currency("JPY")

        notif = self.service.notifications[0]
        self.assertEqual(notif["data"]["currency"], "JPY")
        self.assertAlmostEqual(notif["data"]["daily_profit"], 1500.0)
        self.assertAlmostEqual(notif["data"]["daily_profit_usd"], 10.0)

        # Now convert back to USD
        with patch("notification_service.get_exchange_rates", return_value={"JPY": 150, "USD": 1}):
            updated = self.service.update_notification_currency("USD")

        self.assertEqual(updated, 1)
        notif = self.service.notifications[0]
        self.assertEqual(notif["data"]["currency"], "USD")
        self.assertAlmostEqual(notif["data"]["daily_profit"], 10.0)
        self.assertAlmostEqual(notif["data"]["daily_profit_usd"], 10.0)
        self.assertIn("$", notif["message"])

    def test_update_notification_currency_missing_rate(self):
        """Ensure notifications remain unchanged when a rate is missing."""
        with patch("notification_service.get_exchange_rates", return_value={"EUR": 0.5}):
            updated = self.service.update_notification_currency("JPY")

        self.assertEqual(updated, 0)
        notif = self.service.notifications[0]
        self.assertEqual(notif["data"]["currency"], "USD")
        self.assertAlmostEqual(notif["data"]["daily_profit"], 10.0)

    def test_update_notification_currency_missing_old_rate(self):
        """Skip update when existing currency has no exchange rate."""
        self.service.notifications[0]["data"]["currency"] = "JPY"
        self.service.notifications[0]["data"]["daily_profit"] = 1500.0

        with patch("notification_service.get_exchange_rates", return_value={"USD": 1.0}):
            updated = self.service.update_notification_currency("USD")

        self.assertEqual(updated, 0)
        notif = self.service.notifications[0]
        self.assertEqual(notif["data"]["currency"], "JPY")
        self.assertEqual(notif["data"]["daily_profit"], 1500.0)

    def test_parse_timestamp_with_z_suffix(self):
        with patch("notification_service.get_timezone", return_value="UTC"):
            svc = NotificationService(DummyStateManager())
            dt = svc._parse_timestamp("2024-01-02T03:04:05Z")
        self.assertIsNotNone(dt.tzinfo)
        self.assertEqual(dt.year, 2024)
        self.assertEqual(dt.minute, 4)

    def test_get_current_time_fallback_tz(self):
        svc = NotificationService(DummyStateManager())
        with patch("notification_service.pytz.timezone", side_effect=Exception("bad")):
            dt = svc._get_current_time()
        self.assertIsNotNone(dt.tzinfo)

    def test_get_exchange_rates_without_service_uses_session(self):
        class DummySession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                pass

            def get(self, url, timeout=5):
                class R:
                    ok = True

                    def json(self):
                        return {"result": "success", "conversion_rates": {"USD": 1}}

                return R()

        with patch("notification_service.requests.Session", lambda: DummySession()):
            with patch("notification_service.get_exchange_rate_api_key", return_value="k"):
                with patch("notification_service.MiningDashboardService", side_effect=AssertionError()):
                    rates = notification_service.get_exchange_rates(None)

        self.assertEqual(rates, {"USD": 1})

    def test_get_exchange_rates_closes_response(self):
        class DummyResponse:
            def __init__(self):
                self.closed = False
                self.ok = True

            def json(self):
                return {"result": "success", "conversion_rates": {"USD": 1}}

            def close(self):
                self.closed = True

        resp = DummyResponse()

        class DummySession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                pass

            def get(self, url, timeout=5):
                return resp

        with patch("notification_service.requests.Session", lambda: DummySession()):
            with patch("notification_service.get_exchange_rate_api_key", return_value="k"):
                rates = notification_service.get_exchange_rates(None)

        self.assertEqual(rates, {"USD": 1})
        self.assertTrue(resp.closed)


class RedisValueTest(unittest.TestCase):
    def test_get_redis_value_zero(self):
        class DummyRedis:
            def get(self, key):
                return b"0"

        state = DummyStateManager()
        state.redis_client = DummyRedis()
        svc = NotificationService(state)
        result = svc._get_redis_value("val", "default")
        self.assertEqual(result, "0")

    def test_get_redis_value_str(self):
        class DummyRedis:
            def get(self, key):
                return "1"  # return a plain string instead of bytes

        state = DummyStateManager()
        state.redis_client = DummyRedis()
        svc = NotificationService(state)

        result = svc._get_redis_value("val", "default")
        self.assertEqual(result, "1")


if __name__ == "__main__":
    unittest.main()
