"""Tests for DS-08: error handling hardening — CircuitBreaker, retry_request,
and their integration with OceanApiClientMixin."""

import time
import threading
import pytest

from cache_utils import CircuitBreaker, retry_request


# ---------------------------------------------------------------------------
# CircuitBreaker unit tests
# ---------------------------------------------------------------------------


class _AlwaysFail:
    """Callable that always raises RuntimeError."""

    def __call__(self, *args, **kwargs):
        raise RuntimeError("boom")


class _AlwaysSucceed:
    """Callable that always returns 'ok'."""

    def __call__(self, *args, **kwargs):
        return "ok"


class _FailThenSucceed:
    """Callable that fails *n* times then succeeds."""

    def __init__(self, n_failures: int):
        self.remaining = n_failures
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        if self.remaining > 0:
            self.remaining -= 1
            raise RuntimeError("transient error")
        return "ok"


def test_circuit_breaker_starts_closed():
    cb = CircuitBreaker(name="test", max_failures=3, reset_timeout=60)
    assert cb.state == CircuitBreaker.CLOSED


def test_circuit_breaker_opens_after_max_failures():
    cb = CircuitBreaker(name="test", max_failures=3, reset_timeout=60)
    fn = _AlwaysFail()
    for _ in range(3):
        cb.call(fn)
    assert cb.state == CircuitBreaker.OPEN


def test_circuit_breaker_blocks_when_open():
    cb = CircuitBreaker(name="test", max_failures=2, reset_timeout=60)
    fn = _AlwaysFail()
    cb.call(fn)
    cb.call(fn)
    assert cb.state == CircuitBreaker.OPEN

    # Call should be blocked (None returned without calling fn again)
    call_count_before = 0  # fn always raises so successful calls == 0
    result = cb.call(fn)
    assert result is None


def test_circuit_breaker_half_open_after_timeout(monkeypatch):
    cb = CircuitBreaker(name="test", max_failures=2, reset_timeout=10)
    fn = _AlwaysFail()
    cb.call(fn)
    cb.call(fn)
    assert cb.state == CircuitBreaker.OPEN

    # Manually set _opened_at far in the past so the reset_timeout has elapsed
    import cache_utils
    original_time = time.time
    monkeypatch.setattr(cache_utils.time, "time", lambda: original_time() + 11)

    # Allow one probe
    result = cb.call(_AlwaysSucceed())
    assert result == "ok"
    assert cb.state == CircuitBreaker.CLOSED


def test_circuit_breaker_stays_open_if_probe_fails(monkeypatch):
    import cache_utils
    original_time = time.time

    cb = CircuitBreaker(name="test", max_failures=2, reset_timeout=10)

    # Open the circuit
    fn = _AlwaysFail()
    cb.call(fn)
    cb.call(fn)

    # Simulate time passing past reset_timeout
    monkeypatch.setattr(cache_utils.time, "time", lambda: original_time() + 11)

    # Probe fails → circuit should re-open
    cb.call(_AlwaysFail())
    assert cb.state == CircuitBreaker.OPEN


def test_circuit_breaker_record_success_resets():
    cb = CircuitBreaker(name="test", max_failures=3, reset_timeout=60)
    for _ in range(2):
        cb.record_failure()
    cb.record_success()
    assert cb.state == CircuitBreaker.CLOSED
    assert cb._failure_count == 0


def test_circuit_breaker_thread_safe():
    """Concurrent record_failure calls should not corrupt state."""
    cb = CircuitBreaker(name="test", max_failures=100, reset_timeout=60)
    errors = []

    def worker():
        try:
            for _ in range(20):
                cb.record_failure()
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert cb._failure_count == 200  # 10 threads × 20 failures each


def test_circuit_breaker_call_passes_args():
    cb = CircuitBreaker(name="test", max_failures=5, reset_timeout=60)
    results = []

    def capture(*args, **kwargs):
        results.append((args, kwargs))
        return "captured"

    cb.call(capture, 1, 2, key="value")
    assert results == [((1, 2), {"key": "value"})]


# ---------------------------------------------------------------------------
# retry_request unit tests
# ---------------------------------------------------------------------------


def test_retry_request_succeeds_first_try():
    fn = _AlwaysSucceed()
    result = retry_request(fn, retries=3, backoff=0)
    assert result == "ok"


def test_retry_request_retries_on_failure(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _: None)
    fn = _FailThenSucceed(n_failures=2)
    result = retry_request(fn, retries=3, backoff=0.01)
    assert result == "ok"
    assert fn.calls == 3


def test_retry_request_exhausts_retries(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _: None)
    fn = _AlwaysFail()
    result = retry_request(fn, retries=3, backoff=0.01)
    assert result is None


def test_retry_request_returns_none_for_none_return(monkeypatch):
    """If fn returns None, retry_request should keep trying."""
    monkeypatch.setattr(time, "sleep", lambda _: None)
    calls = [0]

    def fn():
        calls[0] += 1
        return None

    result = retry_request(fn, retries=3, backoff=0)
    assert result is None
    assert calls[0] == 3  # All retries exhausted


def test_retry_request_exponential_backoff(monkeypatch):
    sleeps = []
    monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))
    fn = _AlwaysFail()
    retry_request(fn, retries=3, backoff=1.0)
    # Should sleep 1.0 then 2.0 (between attempts 1→2 and 2→3; no sleep after last)
    assert sleeps == [1.0, 2.0]


# ---------------------------------------------------------------------------
# Integration: CircuitBreaker + retry_request together
# ---------------------------------------------------------------------------


def test_circuit_and_retry_open_on_sustained_failure(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _: None)
    cb = CircuitBreaker(name="test", max_failures=3, reset_timeout=60)
    fn = _AlwaysFail()

    def guarded():
        return cb.call(fn)

    # 3 calls will open the circuit; subsequent ones return None immediately
    for _ in range(5):
        retry_request(guarded, retries=1, backoff=0)

    assert cb.state == CircuitBreaker.OPEN
