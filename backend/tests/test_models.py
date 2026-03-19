"""Tests for Pydantic models and utility functions."""

import pytest
from app.models import (
    DashboardMetrics,
    Worker,
    WorkerStatus,
    convert_to_ths,
    format_hashrate,
)


def test_convert_to_ths_h():
    assert abs(convert_to_ths(1e12, "H/s") - 1.0) < 1e-9


def test_convert_to_ths_ph():
    assert abs(convert_to_ths(1.0, "PH/s") - 1000.0) < 1e-9


def test_convert_to_ths_th():
    assert convert_to_ths(100.0, "TH/s") == 100.0


def test_format_hashrate_ths():
    val, unit = format_hashrate(500.0)
    assert unit == "TH/s"
    assert val == 500.0


def test_format_hashrate_phs():
    val, unit = format_hashrate(5000.0)
    assert unit == "PH/s"
    assert val == 5.0


def test_format_hashrate_ehs():
    val, unit = format_hashrate(1_500_000.0)
    assert unit == "EH/s"


def test_dashboard_metrics_defaults():
    m = DashboardMetrics()
    assert m.workers_hashing == 0
    assert m.hashrate_60sec_unit == "TH/s"
    assert isinstance(m.server_timestamp, float)


def test_dashboard_metrics_workers_hashing_int():
    m = DashboardMetrics(workers_hashing=18)
    assert m.workers_hashing == 18
    assert isinstance(m.workers_hashing, int)


def test_worker_model():
    w = Worker(name="miner01", status=WorkerStatus.ONLINE, hashrate_3hr=120.5)
    assert w.name == "miner01"
    assert w.status == WorkerStatus.ONLINE
    assert w.hashrate_3hr == 120.5


def test_worker_default_status():
    w = Worker(name="miner02")
    assert w.status == WorkerStatus.OFFLINE
