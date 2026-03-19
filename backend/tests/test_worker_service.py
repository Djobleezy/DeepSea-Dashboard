"""Tests for worker sorting/filtering helpers."""

from app.services.worker_service import sort_workers


def test_sort_workers_accepts_hashrate_3hr_alias():
    workers = [
        {"name": "slow", "hashrate_3hr": 10.0},
        {"name": "fast", "hashrate_3hr": 20.0},
    ]

    sorted_workers = sort_workers(workers, sort_by="hashrate_3hr", descending=True)

    assert [worker["name"] for worker in sorted_workers] == ["fast", "slow"]
