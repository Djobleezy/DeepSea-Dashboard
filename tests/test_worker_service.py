import types
import sys
import random
import pytest

# Provide lightweight stubs for external deps if missing
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

from worker_service import WorkerService


def test_generate_fallback_data_counts(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    metrics = {
        "workers_hashing": 2,
        "hashrate_3hr": 60,
        "hashrate_3hr_unit": "TH/s",
        "unpaid_earnings": 0.1,
        "daily_mined_sats": 500,
    }
    data = svc.generate_fallback_data(metrics)
    assert data["workers_total"] == 2
    assert data["workers_online"] == 1
    assert data["workers_offline"] == 1
    assert data["daily_sats"] == 500


def test_generate_fallback_data_earnings_distribution(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    metrics = {
        "workers_hashing": 2,
        "hashrate_3hr": 60,
        "hashrate_3hr_unit": "TH/s",
        "unpaid_earnings": 0.2,
        "daily_mined_sats": 500,
    }
    data = svc.generate_fallback_data(metrics)
    earnings_sum = sum(w["earnings"] for w in data["workers"])
    assert pytest.approx(earnings_sum) == 0.2


def test_generate_fallback_data_zero_workers(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    metrics = {
        "workers_hashing": 0,
        "hashrate_3hr": 0,
        "hashrate_3hr_unit": "TH/s",
        "unpaid_earnings": 0.01,
        "daily_mined_sats": 0,
        "daily_btc_net": 0.000003,
    }
    data = svc.generate_fallback_data(metrics)
    assert data["workers_total"] == 1  # forced minimum
    assert data["workers_online"] == 1
    assert data["workers_offline"] == 0
    assert data["total_hashrate"] == 50.0
    assert data["daily_sats"] == 300


def test_sync_worker_counts_with_dashboard(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    worker_data = {
        "workers_total": 2,
        "workers_online": 1,
        "workers_offline": 1,
        "total_hashrate": 60,
        "hashrate_unit": "TH/s",
        "daily_sats": 50,
        "total_earnings": 0.1,
    }
    metrics = {
        "workers_hashing": 4,
        "hashrate_3hr": 100,
        "hashrate_3hr_unit": "TH/s",
        "daily_mined_sats": 150,
        "unpaid_earnings": 0.2,
    }
    svc.sync_worker_counts_with_dashboard(worker_data, metrics)
    assert worker_data["workers_total"] == 4
    assert worker_data["workers_online"] == 2
    assert worker_data["workers_offline"] == 2
    assert worker_data["total_hashrate"] == 100
    assert worker_data["hashrate_unit"] == "TH/s"
    assert worker_data["daily_sats"] == 150
    assert worker_data["total_earnings"] == 0.2


def test_generate_sequential_workers_deterministic(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    random.seed(0)
    svc = WorkerService()
    workers = svc.generate_sequential_workers(5, 100, "TH/s", total_unpaid_earnings=0.5)

    assert len(workers) == 5
    online = [w for w in workers if w["status"] == "online"]
    offline = [w for w in workers if w["status"] == "offline"]
    assert len(online) == 4
    assert len(offline) == 1

    total_hashrate = round(sum(w["hashrate_3hr"] for w in workers), 2)
    assert total_hashrate == 116.73

    total_earnings = round(sum(w["earnings"] for w in workers), 8)
    assert total_earnings == 0.5


def test_generate_simulated_workers_deterministic(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    random.seed(0)
    svc = WorkerService()
    workers = svc.generate_simulated_workers(5, 100, "TH/s", total_unpaid_earnings=0.5)

    assert len(workers) == 5
    online = [w for w in workers if w["status"] == "online"]
    offline = [w for w in workers if w["status"] == "offline"]
    assert len(online) == 4
    assert len(offline) == 1

    online_hashrate = round(sum(w["hashrate_3hr"] for w in online), 2)
    assert online_hashrate == 100.0

    total_earnings = round(sum(w["earnings"] for w in workers), 8)
    assert total_earnings == 0.5


def test_adjust_worker_instances_removes_excess(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    worker_data = {
        "workers": [svc.create_default_worker(f"w{i}", "online") for i in range(5)],
        "workers_total": 5,
        "workers_online": 5,
        "workers_offline": 0,
    }

    svc.adjust_worker_instances(worker_data, 3)
    assert len(worker_data["workers"]) == 3


def test_adjust_worker_instances_updates_counts(monkeypatch):
    monkeypatch.setattr("worker_service.get_timezone", lambda: "UTC")
    svc = WorkerService()
    worker_data = svc.generate_default_workers_data()

    svc.adjust_worker_instances(worker_data, 4)

    assert worker_data["workers_total"] == 4
    assert worker_data["workers_online"] + worker_data["workers_offline"] == 4
    assert len(worker_data["workers"]) == 4
