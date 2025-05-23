import sys
import types

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

import unittest
from unittest.mock import patch

from data_service import MiningDashboardService
from models import OceanData


class MetricsConversionTest(unittest.TestCase):
    @patch("config.get_currency", return_value="EUR")
    def test_fetch_metrics_converts_currency(self, mock_cur):
        svc = MiningDashboardService(0, 0, "w")
        with (
            patch.object(svc, "get_ocean_data") as go,
            patch.object(svc, "get_bitcoin_stats") as gb,
            patch.object(svc, "fetch_exchange_rates") as fer,
        ):
            go.return_value = OceanData(hashrate_3hr=100, hashrate_3hr_unit="TH/s", pool_fees_percentage=0.0)
            gb.return_value = (0, 100e18, 10000, 0)
            fer.return_value = {"EUR": 0.5}
            metrics = svc.fetch_metrics()
        self.assertAlmostEqual(metrics["btc_price"], 5000)
        self.assertAlmostEqual(metrics["daily_revenue"], 2.25)
        self.assertAlmostEqual(metrics["daily_profit_usd"], 2.25)
        self.assertEqual(metrics["currency"], "EUR")


class EarningsConversionTest(unittest.TestCase):
    @patch("config.get_currency", return_value="EUR")
    def test_get_earnings_data_converts_currency(self, mock_cur):
        svc = MiningDashboardService(0, 0, "w")
        with (
            patch.object(svc, "get_payment_history_api") as gpha,
            patch.object(svc, "get_ocean_data") as go,
            patch.object(svc, "get_bitcoin_stats") as gb,
            patch.object(svc, "fetch_exchange_rates") as fer,
        ):
            gpha.return_value = [
                {
                    "date": "2023-01-01 00:00",
                    "amount_btc": 0.1,
                    "amount_sats": 10000000,
                    "date_iso": "2023-01-01T00:00:00",
                    "fiat_value": 1000,
                }
            ]
            go.return_value = OceanData(unpaid_earnings=0.2, est_time_to_payout="soon")
            gb.return_value = (0, 0, 10000, 0)
            fer.return_value = {"EUR": 0.5}
            data = svc.get_earnings_data()
        self.assertAlmostEqual(data["total_paid_usd"], 1000)
        self.assertAlmostEqual(data["total_paid_fiat"], 500)
        self.assertAlmostEqual(data["payments"][0]["fiat_value"], 500)
        self.assertAlmostEqual(data["monthly_summaries"][0]["total_fiat"], 500)
        self.assertEqual(data["btc_price"], 5000)
        self.assertEqual(data["currency"], "EUR")
        self.assertIsNone(data["avg_days_between_payouts"])


if __name__ == "__main__":
    unittest.main()
