"""Utility helpers for caching expensive operations."""

import json
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
        object_caches = weakref.WeakKeyDictionary()
        cache = {}
        lock = threading.Lock()

        def _serialize(value):
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
            expired = [k for k, (_, ts) in cache_dict.items() if now - ts >= ttl_seconds]
            for k in expired:
                del cache_dict[k]

        @wraps(func)
        def wrapper(*args, **kwargs):
            if args and hasattr(args[0], "__dict__"):
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
            with lock:
                cache.clear()
                object_caches.clear()

        def cache_size():
            now = time.time()
            with lock:
                _purge_expired(cache, now)
                for c in list(object_caches.values()):
                    _purge_expired(c, now)
                return len(cache) + sum(len(c) for c in object_caches.values())

        wrapper.cache_clear = cache_clear
        wrapper.cache_size = cache_size
        return wrapper

    return decorator

__all__ = ["ttl_cache"]
