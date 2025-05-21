import json
import gzip
import sys
import types

if 'redis' not in sys.modules:
    redis_mod = types.ModuleType('redis')
    class DummyRedisModule:
        @classmethod
        def from_url(cls, url):
            return cls()
        def ping(self):
            pass
    redis_mod.Redis = DummyRedisModule
    sys.modules['redis'] = redis_mod

from collections import deque
from state_manager import StateManager
from datetime import timedelta

class DummyRedis:
    def __init__(self):
        self.storage = {}
    def set(self, key, value):
        self.storage[key] = value
    def get(self, key):
        return self.storage.get(key)
    def ping(self):
        pass

def test_save_and_load_graph_state_gzip():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    mgr.arrow_history = {"hashrate_60sec": deque([{"time": "00:00:01", "value": 1, "arrow": "", "unit": "th/s"}], maxlen=180)}
    mgr.hashrate_history = [1]
    mgr.metrics_log = deque([{"timestamp": "t", "metrics": {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}}], maxlen=180)

    mgr.save_graph_state()
    raw = mgr.redis_client.get(mgr.STATE_KEY)
    assert isinstance(raw, (bytes, bytearray))
    data = json.loads(gzip.decompress(raw).decode("utf-8"))
    assert "arrow_history" in data

    new_mgr = StateManager()
    new_mgr.redis_client = mgr.redis_client
    new_mgr.load_graph_state()
    assert new_mgr.arrow_history == mgr.arrow_history
    assert new_mgr.metrics_log[0]["metrics"]["hashrate_60sec"] == 1


def test_variance_history_calculation(monkeypatch):
    mgr = StateManager()
    monkeypatch.setattr('state_manager.get_timezone', lambda: 'UTC')

    first = {
        "estimated_earnings_per_day_sats": 100,
        "estimated_earnings_next_block_sats": 50,
        "estimated_rewards_in_window_sats": 10,
    }
    mgr.update_metrics_history(first)
    assert first["estimated_earnings_per_day_sats_variance_3hr"] == 0

    # Move the stored entry 3 hours back to simulate passage of time
    for key in [
        "estimated_earnings_per_day_sats",
        "estimated_earnings_next_block_sats",
        "estimated_rewards_in_window_sats",
    ]:
        history = mgr.variance_history[key]
        history[0]["time"] -= timedelta(hours=3) - timedelta(seconds=1)

    second = {
        "estimated_earnings_per_day_sats": 120,
        "estimated_earnings_next_block_sats": 60,
        "estimated_rewards_in_window_sats": 20,
    }
    mgr.update_metrics_history(second)

    assert second["estimated_earnings_per_day_sats_variance_3hr"] == 20
    assert second["estimated_earnings_next_block_sats_variance_3hr"] == 10
    assert second["estimated_rewards_in_window_sats_variance_3hr"] == 10
