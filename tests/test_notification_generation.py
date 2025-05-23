import unittest
from unittest.mock import patch
import pytest
from notification_service import NotificationService

pytestmark = pytest.mark.usefixtures("dummy_deps")


class DummyRedis:
    def __init__(self):
        self.store = {}

    def get(self, key):
        value = self.store.get(key)
        if value is None:
            return None
        if isinstance(value, (bytes, bytearray)):
            return value
        return str(value).encode("utf-8")

    def set(self, key, value):
        self.store[key] = value if isinstance(value, (bytes, bytearray)) else str(value).encode("utf-8")


class DummyStateManager:
    def __init__(self):
        self.redis_client = DummyRedis()
        self.notifications = []

    def get_notifications(self):
        return list(self.notifications)

    def save_notifications(self, notifications):
        self.notifications = list(notifications)
        return True


class NotificationGenerationTest(unittest.TestCase):
    def setUp(self):
        self.cfg_patch = patch("notification_service.load_config", return_value={"currency": "USD"})
        self.rate_patch = patch("notification_service.get_exchange_rates", return_value={"USD": 1.0})
        self.cfg_patch.start()
        self.rate_patch.start()
        self.state = DummyStateManager()
        self.service = NotificationService(self.state)

    def tearDown(self):
        self.cfg_patch.stop()
        self.rate_patch.stop()

    def test_generation_flow(self):
        initial_metrics = {
            "last_block_height": 100,
            "last_block_earnings": "500",
            "hashrate_10min": 100,
            "hashrate_10min_unit": "TH/s",
            "hashrate_3hr": 100,
            "hashrate_3hr_unit": "TH/s",
            "hashrate_24hr": 100,
            "hashrate_24hr_unit": "TH/s",
            "daily_mined_sats": 1000,
            "daily_profit_usd": 1.0,
        }

        # Initial call just stores the block height
        new_n = self.service.check_and_generate_notifications(initial_metrics, None)
        self.assertEqual(new_n, [])

        updated_metrics = dict(initial_metrics)
        updated_metrics["last_block_height"] = 101
        updated_metrics["last_block_earnings"] = "700"
        updated_metrics["hashrate_10min"] = 50  # 50% drop
        updated_metrics["daily_mined_sats"] = 2000
        updated_metrics["daily_profit_usd"] = 2.0

        with (
            patch.object(self.service, "_should_post_daily_stats", return_value=True),
            patch.object(self.service, "_generate_daily_stats", wraps=self.service._generate_daily_stats) as daily_mock,
            patch.object(
                self.service, "_generate_block_notification", wraps=self.service._generate_block_notification
            ) as block_mock,
            patch.object(
                self.service, "_check_hashrate_change", wraps=self.service._check_hashrate_change
            ) as hash_mock,
        ):
            notifications = self.service.check_and_generate_notifications(updated_metrics, initial_metrics)

        self.assertEqual(block_mock.call_count, 1)
        self.assertEqual(hash_mock.call_count, 1)
        self.assertEqual(daily_mock.call_count, 1)
        self.assertEqual(len(notifications), 3)

        cats = {n["category"] for n in notifications}
        self.assertIn("block", cats)
        self.assertIn("hashrate", cats)
        self.assertEqual(self.service.get_unread_count(), 3)


if __name__ == "__main__":
    unittest.main()
