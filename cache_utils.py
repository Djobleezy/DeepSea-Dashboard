"""Utility helpers for caching expensive operations."""

import json
import logging
import time
import threading
import weakref
from functools import wraps

def ttl_cache(ttl_seconds=60, maxsize=None):
    """Simple decorator providing a thread-safe time-based cache.

    Args:
        ttl_seconds (int): How long to store each cached item.
        maxsize (int, optional): Maximum number of entries to keep in the cache.

    """

    def decorator(func):
        # ``object_caches`` stores per-instance caches when decorating methods
        # so that each object gets its own cache entries. ``cache`` holds
        # results for regular functions.
        object_caches = weakref.WeakKeyDictionary()
        cache = {}
        # ``lock`` guards access to both cache dictionaries to keep them thread
        # safe when the decorated function is called concurrently.
        lock = threading.Lock()

        def _serialize(value):
            """Convert non-hashable values to a stable, hashable representation."""
            try:
                hash(value)
                return value
            except TypeError:
                if isinstance(value, (set, frozenset)):
                    value = sorted(value)
                try:
                    return json.dumps(value, sort_keys=True, default=str)
                except Exception:
                    return str(value)

        def _purge_expired(cache_dict, now):
            """Remove items older than ``ttl_seconds`` from the cache."""
            expired = [k for k, (_, ts) in cache_dict.items() if now - ts >= ttl_seconds]
            for k in expired:
                del cache_dict[k]

        @wraps(func)
        def wrapper(*args, **kwargs):
            """Return cached results when available or call the wrapped function."""
            if maxsize == 0:
                return func(*args, **kwargs)
            if args and (hasattr(args[0], "__dict__") or hasattr(args[0].__class__, "__slots__")):
                obj = args[0]
                key_args = args[1:]
                with lock:
                    cache_dict = object_caches.setdefault(obj, {})
            else:
                obj = None
                key_args = args
                cache_dict = cache

            serialized_args = tuple(_serialize(a) for a in key_args)
            serialized_kwargs = tuple(sorted((k, _serialize(v)) for k, v in kwargs.items()))
            key = (serialized_args, serialized_kwargs)
            now = time.time()
            with lock:
                _purge_expired(cache_dict, now)
                cached = cache_dict.get(key)
                if cached and now - cached[1] < ttl_seconds:
                    return cached[0]
            result = func(*args, **kwargs)
            if result is not None:
                now = time.time()
                with lock:
                    _purge_expired(cache_dict, now)
                    if maxsize is not None and len(cache_dict) >= maxsize:
                        oldest_key = min(cache_dict.items(), key=lambda item: item[1][1])[0]
                        del cache_dict[oldest_key]
                    cache_dict[key] = (result, now)
            return result

        def cache_clear():
            """Remove all cached values for both functions and methods."""
            with lock:
                cache.clear()
                object_caches.clear()

        def cache_purge():
            """Purge expired items from all caches without clearing everything."""
            now = time.time()
            with lock:
                _purge_expired(cache, now)
                for c in list(object_caches.values()):
                    _purge_expired(c, now)

        def cache_size():
            """Return the current number of cached entries after removing expired items."""
            now = time.time()
            with lock:
                _purge_expired(cache, now)
                for c in list(object_caches.values()):
                    _purge_expired(c, now)
                return len(cache) + sum(len(c) for c in object_caches.values())

        wrapper.cache_clear = cache_clear
        wrapper.cache_size = cache_size
        wrapper.cache_purge = cache_purge
        return wrapper

    return decorator


class TTLDict:
    """Dictionary-like object that expires entries after a fixed TTL."""

    def __init__(self, ttl_seconds=60, maxsize=None):
        """Create a new ``TTLDict`` instance."""

        self.ttl_seconds = ttl_seconds
        self.maxsize = maxsize
        self._store = {}
        self._lock = threading.Lock()

    def _purge_expired(self):
        """Remove expired entries based on ``ttl_seconds``."""

        now = time.time()
        expired = [k for k, (_, ts) in self._store.items() if now - ts >= self.ttl_seconds]
        for k in expired:
            del self._store[k]

    def __setitem__(self, key, value):
        with self._lock:
            self._purge_expired()
            if self.maxsize == 0:
                return
            if self.maxsize is not None and len(self._store) >= self.maxsize:
                oldest = min(self._store.items(), key=lambda item: item[1][1])[0]
                del self._store[oldest]
            self._store[key] = (value, time.time())

    def __getitem__(self, key):
        with self._lock:
            self._purge_expired()
            value, ts = self._store[key]
            if time.time() - ts >= self.ttl_seconds:
                del self._store[key]
                raise KeyError(key)
            return value

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key):
        try:
            self[key]
            return True
        except KeyError:
            return False

    def __len__(self):
        with self._lock:
            self._purge_expired()
            return len(self._store)

    def pop(self, key, default=None):
        with self._lock:
            self._purge_expired()
            return self._store.pop(key, (default, time.time()))[0]

    def clear(self):
        with self._lock:
            self._store.clear()

    def items(self):
        with self._lock:
            self._purge_expired()
            return [(k, v[0]) for k, v in self._store.items()]

    def __iter__(self):
        """Iterate over keys while purging expired entries."""
        with self._lock:
            self._purge_expired()
            keys = list(self._store.keys())
        for key in keys:
            yield key

    def values(self):
        """Return list of values after purging expired items."""
        with self._lock:
            self._purge_expired()
            return [v[0] for v in self._store.values()]

    def purge(self):
        """Public method to purge expired entries."""
        with self._lock:
            self._purge_expired()


class CircuitBreaker:
    """Simple three-state circuit breaker (CLOSED → OPEN → HALF-OPEN).

    Tracks consecutive failures for a named endpoint.  Once ``max_failures``
    successive failures are recorded the circuit opens and all calls are
    rejected immediately (returning ``None``) until the ``reset_timeout``
    elapses.  After the timeout one probe request is allowed (HALF-OPEN); if
    it succeeds the circuit resets to CLOSED; if it fails the timeout
    restarts.

    Usage::

        cb = CircuitBreaker(name="ocean.xyz", max_failures=5, reset_timeout=60)

        response = cb.call(session.get, url, timeout=10)
        if response is None:
            # Circuit is open or request failed
            ...

    The instance is thread-safe.
    """

    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"

    def __init__(self, name: str, max_failures: int = 5, reset_timeout: float = 60.0):
        self.name = name
        self.max_failures = max_failures
        self.reset_timeout = reset_timeout
        self._state = self.CLOSED
        self._failure_count = 0
        self._opened_at: float = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    def record_success(self) -> None:
        with self._lock:
            self._failure_count = 0
            self._state = self.CLOSED

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            if self._failure_count >= self.max_failures:
                if self._state != self.OPEN:
                    logging.warning(
                        "CircuitBreaker[%s]: opening after %d failures",
                        self.name,
                        self._failure_count,
                    )
                self._state = self.OPEN
                self._opened_at = time.time()

    def _allow_probe(self) -> bool:
        """Return True if enough time has passed to attempt a probe."""
        with self._lock:
            if self._state == self.CLOSED:
                return True
            if self._state == self.OPEN and (time.time() - self._opened_at) >= self.reset_timeout:
                self._state = self.HALF_OPEN
                logging.info("CircuitBreaker[%s]: entering HALF_OPEN — probing", self.name)
                return True
            if self._state == self.HALF_OPEN:
                return True
            return False

    def call(self, fn, *args, **kwargs):
        """Call *fn* if the circuit allows it; return ``None`` otherwise.

        Args:
            fn: Callable to invoke (e.g. ``session.get``).
            *args: Positional arguments forwarded to *fn*.
            **kwargs: Keyword arguments forwarded to *fn*.

        Returns:
            The return value of *fn* on success, or ``None`` when the circuit
            is open or *fn* raises an exception.
        """
        if not self._allow_probe():
            logging.debug("CircuitBreaker[%s]: OPEN — request blocked", self.name)
            return None
        try:
            result = fn(*args, **kwargs)
            self.record_success()
            return result
        except Exception as exc:
            self.record_failure()
            logging.error("CircuitBreaker[%s]: failure — %s", self.name, exc)
            return None


def retry_request(fn, *args, retries: int = 3, backoff: float = 1.0, **kwargs):
    """Call *fn* up to *retries* times with exponential back-off.

    Back-off sequence: ``backoff``, ``backoff * 2``, ``backoff * 4``, …

    On each failure the exception is logged.  Returns the result of the first
    successful call, or ``None`` if all attempts fail.

    Args:
        fn: Callable to invoke (e.g. a :class:`CircuitBreaker` ``call`` or
            plain ``session.get``).
        *args: Positional arguments forwarded to *fn*.
        retries: Maximum number of attempts (default 3).
        backoff: Initial back-off delay in seconds (default 1.0).
        **kwargs: Keyword arguments forwarded to *fn*.

    Returns:
        The return value of *fn* on success, or ``None`` after all retries.
    """
    delay = backoff
    for attempt in range(1, retries + 1):
        try:
            result = fn(*args, **kwargs)
            if result is not None:
                return result
        except Exception as exc:
            logging.warning("retry_request attempt %d/%d failed: %s", attempt, retries, exc)
        if attempt < retries:
            time.sleep(delay)
            delay *= 2
    return None


__all__ = ["ttl_cache", "TTLDict", "CircuitBreaker", "retry_request"]
