import types
import sys

# Ensure time module is available
import time

if "cache_utils" not in sys.modules:
    pass

from cache_utils import ttl_cache


def test_ttl_cache(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    call_count = {"count": 0}

    @ttl_cache(ttl_seconds=5)
    def add(a, b):
        call_count["count"] += 1
        return a + b

    assert add(1, 2) == 3
    assert call_count["count"] == 1

    fake_time[0] += 2
    assert add(1, 2) == 3
    assert call_count["count"] == 1

    fake_time[0] += 5
    assert add(1, 2) == 3
    assert call_count["count"] == 2
