import time

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


def test_ttl_cache_unhashable(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    call_count = {"count": 0}

    @ttl_cache(ttl_seconds=5)
    def add_dict(d):
        call_count["count"] += 1
        return d["a"] + d["b"]

    data = {"a": 1, "b": 2}
    assert add_dict(data) == 3
    assert call_count["count"] == 1

    fake_time[0] += 1
    # Different dict object with same contents should hit cache
    data2 = {"b": 2, "a": 1}
    assert add_dict(data2) == 3
    assert call_count["count"] == 1

    fake_time[0] += 6
    assert add_dict(data) == 3
    assert call_count["count"] == 2


def test_ttl_cache_cleanup(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    @ttl_cache(ttl_seconds=1)
    def identity(x):
        return x

    for i in range(10):
        assert identity(i) == i
        assert identity.cache_size() == 1
        fake_time[0] += 2

    identity(99)
    assert identity.cache_size() == 1


def test_ttl_cache_maxsize(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    @ttl_cache(ttl_seconds=10, maxsize=2)
    def identity(x):
        return x

    identity(1)
    identity(2)
    assert identity.cache_size() == 2

    identity(3)
    assert identity.cache_size() == 2
    fake_time[0] += 1
    # Oldest entry (1) should have been removed
    assert identity(1) == 1
    assert identity.cache_size() == 2
