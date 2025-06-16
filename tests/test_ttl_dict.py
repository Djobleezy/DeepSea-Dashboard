import time
import threading
import pytest

from cache_utils import TTLDict


def test_ttl_dict_basic(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    d = TTLDict(ttl_seconds=10)
    d["a"] = 1
    assert d["a"] == 1

    fake_time[0] += 5
    assert d.get("a") == 1

    fake_time[0] += 6
    with pytest.raises(KeyError):
        _ = d["a"]
    assert d.get("a") is None
    assert "a" not in d


def test_ttl_dict_maxsize(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    d = TTLDict(ttl_seconds=10, maxsize=2)
    d["a"] = 1
    d["b"] = 2
    assert len(d) == 2

    d["c"] = 3
    assert len(d) == 2
    assert "a" not in d


def test_ttl_dict_maxsize_zero(monkeypatch):
    d = TTLDict(ttl_seconds=10, maxsize=0)
    d["a"] = 1
    assert len(d) == 0
    with pytest.raises(KeyError):
        _ = d["a"]


def test_ttl_dict_thread_safety(monkeypatch):
    monkeypatch.setattr(time, "time", lambda: 0)
    d = TTLDict(ttl_seconds=10)
    errors = []

    def worker(idx):
        try:
            for i in range(50):
                key = f"{idx}-{i}"
                d[key] = i
                assert d.get(key) == i
        except Exception as exc:  # pragma: no cover - shouldn't happen
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(d) == 250

def test_ttl_dict_iteration_purges(monkeypatch):
    fake_time = [0]
    monkeypatch.setattr(time, "time", lambda: fake_time[0])

    d = TTLDict(ttl_seconds=10)
    d["a"] = 1
    fake_time[0] += 11

    assert list(d) == []
    assert len(d) == 0

