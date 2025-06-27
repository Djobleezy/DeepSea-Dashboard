import json
import gzip
import sys
import types
import gc

if "redis" not in sys.modules:
    redis_mod = types.ModuleType("redis")

    class DummyRedisModule:
        @classmethod
        def from_url(cls, url):
            return cls()

        def ping(self):
            pass

    redis_mod.Redis = DummyRedisModule
    sys.modules["redis"] = redis_mod

from collections import deque
from state_manager import StateManager, MAX_VARIANCE_HISTORY_ENTRIES, MAX_HISTORY_ENTRIES


class DummyRedis:
    def __init__(self):
        self.storage = {}

    def set(self, key, value):
        if isinstance(value, str):
            value = value.encode("utf-8")
        self.storage[key] = value

    def get(self, key):
        return self.storage.get(key)

    def ping(self):
        pass


def test_save_and_load_graph_state_gzip():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    mgr.arrow_history = {
        "hashrate_60sec": deque([
            {"time": "2024-01-01 00:00:01", "value": 1, "arrow": "", "unit": "th/s"}
        ], maxlen=180)
    }
    mgr.hashrate_history = [1]
    mgr.metrics_log = deque(
        [{"timestamp": "t", "metrics": {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}}], maxlen=180
    )

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


def test_load_graph_state_plain_json():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    state = {
        "arrow_history": {"hashrate_60sec": [{"time": "t", "value": 1, "arrow": "", "unit": "th/s"}]},
        "hashrate_history": [1],
        "metrics_log": [{"timestamp": "t", "metrics": {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}}],
    }
    mgr.redis_client.set(f"{mgr.STATE_KEY}_version", "1.0")
    mgr.redis_client.set(mgr.STATE_KEY, json.dumps(state))

    new_mgr = StateManager()
    new_mgr.redis_client = mgr.redis_client
    new_mgr.load_graph_state()

    assert new_mgr.arrow_history["hashrate_60sec"][0]["value"] == 1


def test_variance_history_calculation(monkeypatch):
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    first = {
        "estimated_earnings_per_day_sats": 100,
        "estimated_earnings_next_block_sats": 50,
        "estimated_rewards_in_window_sats": 10,
    }
    mgr.update_metrics_history(first)
    assert first["estimated_earnings_per_day_sats_variance_3hr"] is None
    assert first["estimated_earnings_per_day_sats_variance_progress"] < 100

    # Pre-fill variance history to simulate 3 hours of data
    for key in [
        "estimated_earnings_per_day_sats",
        "estimated_earnings_next_block_sats",
        "estimated_rewards_in_window_sats",
    ]:
        history = mgr.variance_history[key]
        for _ in range(MAX_VARIANCE_HISTORY_ENTRIES - 1):
            history.append({"time": history[0]["time"], "value": first[key]})

    second = {
        "estimated_earnings_per_day_sats": 120,
        "estimated_earnings_next_block_sats": 60,
        "estimated_rewards_in_window_sats": 20,
    }
    mgr.update_metrics_history(second)

    assert second["estimated_earnings_per_day_sats_variance_3hr"] == 20
    assert second["estimated_earnings_next_block_sats_variance_3hr"] == 10
    assert second["estimated_rewards_in_window_sats_variance_3hr"] == 10
    assert second["estimated_earnings_per_day_sats_variance_progress"] == 100


def test_network_hashrate_variance_calculation(monkeypatch):
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    first = {"network_hashrate": 400}
    mgr.update_metrics_history(first)
    assert first["network_hashrate_variance_3hr"] is None

    history = mgr.variance_history["network_hashrate"]
    for _ in range(MAX_VARIANCE_HISTORY_ENTRIES - 1):
        history.append({"time": history[0]["time"], "value": first["network_hashrate"]})

    second = {"network_hashrate": 450}
    mgr.update_metrics_history(second)

    assert second["network_hashrate_variance_3hr"] == 50
    assert second["network_hashrate_variance_progress"] == 100


def test_autofill_variance_gaps(monkeypatch):
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    first = {"network_hashrate": 400}
    mgr.update_metrics_history(first)

    history = mgr.variance_history["network_hashrate"]
    for _ in range(MAX_VARIANCE_HISTORY_ENTRIES - 2):
        history.append({"time": history[-1]["time"], "value": first["network_hashrate"]})

    history[-1]["time"] = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=2)

    second = {"network_hashrate": 450}
    mgr.update_metrics_history(second)

    assert second["network_hashrate_variance_progress"] == 100


def test_variance_history_persistence(monkeypatch):
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    from datetime import datetime
    from zoneinfo import ZoneInfo

    now = datetime(2024, 1, 1, tzinfo=ZoneInfo("UTC"))
    mgr.arrow_history = {
        "hashrate_60sec": deque([
            {"time": "2024-01-01 00:00:01", "value": 1, "arrow": "", "unit": "th/s"}
        ], maxlen=180)
    }
    mgr.hashrate_history = [1]
    mgr.metrics_log = deque(
        [{"timestamp": "t", "metrics": {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}}], maxlen=180
    )
    mgr.variance_history = {
        "estimated_earnings_per_day_sats": deque([{"time": now, "value": 100}], maxlen=MAX_VARIANCE_HISTORY_ENTRIES)
    }

    mgr.save_graph_state()

    new_mgr = StateManager()
    new_mgr.redis_client = mgr.redis_client
    new_mgr.load_graph_state()

    original = list(mgr.variance_history["estimated_earnings_per_day_sats"])
    loaded = list(new_mgr.variance_history["estimated_earnings_per_day_sats"])
    assert loaded == original


def test_persist_critical_state_and_load():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()

    cached = {"server_timestamp": 100}
    mgr.persist_critical_state(cached, 200, 300)

    raw = mgr.redis_client.get("critical_state")
    stored = json.loads(raw.decode("utf-8"))
    assert stored["cached_metrics_timestamp"] == 100
    assert stored["last_successful_run"] == 200
    assert stored["last_update_time"] == 300

    # Loading should return the stored values
    last_run, last_update = mgr.load_critical_state()
    assert last_run == 200
    assert last_update == 300


def test_load_critical_state_handles_str():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()

    state = {"last_successful_run": 1, "last_update_time": 2, "cached_metrics_timestamp": 3}
    # Store raw string rather than bytes
    mgr.redis_client.storage["critical_state"] = json.dumps(state)

    last_run, last_update = mgr.load_critical_state()
    assert last_run == 1
    assert last_update == 2


def test_prune_old_data():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    mgr.last_prune_time = 0

    # Create history longer than MAX_HISTORY_ENTRIES
    entries = [{"time": str(i), "value": i, "arrow": ""} for i in range(MAX_HISTORY_ENTRIES + 50)]
    mgr.arrow_history["hashrate_60sec"] = deque(entries, maxlen=MAX_HISTORY_ENTRIES + 50)

    m_entries = [{"timestamp": str(i), "metrics": {"hashrate_60sec": i}} for i in range(MAX_HISTORY_ENTRIES + 50)]
    mgr.metrics_log = deque(m_entries, maxlen=MAX_HISTORY_ENTRIES + 50)

    assert len(mgr.arrow_history["hashrate_60sec"]) > MAX_HISTORY_ENTRIES
    assert len(mgr.metrics_log) > MAX_HISTORY_ENTRIES

    mgr.prune_old_data()

    assert len(mgr.arrow_history["hashrate_60sec"]) <= MAX_HISTORY_ENTRIES
    assert len(mgr.metrics_log) <= MAX_HISTORY_ENTRIES

    # First entry should be averaged when compressed
    first_entry = mgr.arrow_history["hashrate_60sec"][0]
    assert first_entry["value"] == 0.5

def test_hashrate_history_limit():
    mgr = StateManager()
    for i in range(MAX_HISTORY_ENTRIES + 10):
        mgr.hashrate_history.append(i)

    assert isinstance(mgr.hashrate_history, deque)
    assert len(mgr.hashrate_history) == MAX_HISTORY_ENTRIES


def test_hashrate_history_loaded_as_deque(monkeypatch):
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    data = {
        "arrow_history": {},
        "hashrate_history": list(range(5)),
        "metrics_log": [],
    }
    mgr.redis_client.set(f"{mgr.STATE_KEY}_version", "2.0")
    mgr.redis_client.set(mgr.STATE_KEY, json.dumps(data))

    new_mgr = StateManager()
    new_mgr.redis_client = mgr.redis_client
    new_mgr.load_graph_state()

    assert isinstance(new_mgr.hashrate_history, deque)
    assert new_mgr.hashrate_history.maxlen == MAX_HISTORY_ENTRIES


def test_extended_history_entries(monkeypatch):
    import state_manager as sm
    sm.MAX_HISTORY_ENTRIES = 10
    mgr = sm.StateManager()
    for i in range(15):
        mgr.metrics_log.append({"timestamp": str(i), "metrics": {}})
    assert len(mgr.metrics_log) == sm.MAX_HISTORY_ENTRIES

def test_metrics_log_snapshot_omits_history(monkeypatch):
    """metrics_log should not store arrow_history or history fields."""
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    metrics = {"hashrate_60sec": 1}
    mgr.update_metrics_history(metrics)

    latest = mgr.metrics_log[-1]["metrics"]
    assert "arrow_history" not in latest
    assert "history" not in latest


def test_metrics_log_snapshot_omits_workers(monkeypatch):
    """metrics_log should not store workers field."""
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    metrics = {"workers": [{"id": 1}, {"id": 2}]}
    mgr.update_metrics_history(metrics)

    latest = mgr.metrics_log[-1]["metrics"]
    assert "workers" not in latest


def test_close_closes_redis_connection():
    mgr = StateManager()

    class DummyRedis:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

        def ping(self):
            pass

    dummy = DummyRedis()
    mgr.redis_client = dummy

    mgr.close()

    assert dummy.closed
    assert mgr.redis_client is None


def test_close_clears_cached_data():
    from datetime import datetime

    mgr = StateManager()
    mgr.arrow_history = {"k": deque([{"time": "2024-01-01 00:00:00", "value": 1}])}
    mgr.hashrate_history.append(1)
    mgr.metrics_log.append({"timestamp": "t", "metrics": {"a": 1}})
    mgr.payout_history = [1]
    mgr.variance_history = {"v": deque([{"time": datetime.now(), "value": 1}])}
    mgr.last_earnings = {"v": 1}

    mgr.close()

    assert mgr.arrow_history == {}
    assert len(mgr.hashrate_history) == 0
    assert len(mgr.metrics_log) == 0
    assert mgr.payout_history == []
    assert mgr.variance_history == {}
    assert mgr.last_earnings == {}
    assert mgr.load_graph_state.cache_size() == 0
    assert mgr.load_payout_history.cache_size() == 0
    assert mgr.load_last_earnings.cache_size() == 0


def test_load_methods_cache_maxsize(monkeypatch):
    """Repeated instances should not grow caches indefinitely."""

    class DummyRedis:
        def __init__(self):
            self.storage = {}

        def get(self, key):
            return self.storage.get(key)

        def set(self, key, value):
            self.storage[key] = value

    redis_client = DummyRedis()
    for _ in range(3):
        mgr = StateManager()
        mgr.redis_client = redis_client
        mgr.load_graph_state()
        mgr.load_payout_history()
        mgr.load_last_earnings()
        mgr.close()
        del mgr
        gc.collect()

    assert StateManager.load_graph_state.cache_size() <= 1
    assert StateManager.load_payout_history.cache_size() <= 1
    assert StateManager.load_last_earnings.cache_size() <= 1


def test_update_metrics_history_copies_entries(monkeypatch):
    """arrow_history in metrics should not reference internal state objects."""
    mgr = StateManager()
    monkeypatch.setattr("state_manager.get_timezone", lambda: "UTC")

    metrics = {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}
    mgr.update_metrics_history(metrics)

    state_entry = mgr.arrow_history["hashrate_60sec"][-1]
    metrics_entry = metrics["arrow_history"]["hashrate_60sec"][-1]

    assert metrics_entry is not state_entry


def test_save_graph_state_extended_history(monkeypatch):
    import state_manager as sm

    sm.MAX_HISTORY_ENTRIES = 20
    mgr = sm.StateManager()
    mgr.redis_client = DummyRedis()

    hist = deque(maxlen=sm.MAX_HISTORY_ENTRIES)
    for i in range(25):
        hist.append({"time": str(i), "value": i, "arrow": ""})
    mgr.arrow_history = {"hashrate_60sec": hist}

    mgr.last_save_time = 0
    mgr.save_graph_state()

    raw = mgr.redis_client.get(mgr.STATE_KEY)
    data = json.loads(gzip.decompress(raw).decode("utf-8"))

    assert len(data["arrow_history"]["hashrate_60sec"]) == sm.MAX_HISTORY_ENTRIES
