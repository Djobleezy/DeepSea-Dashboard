"""Utility helpers for caching expensive operations."""

import json
import time
from functools import wraps


def ttl_cache(ttl_seconds=60, maxsize=None):
    """Simple decorator providing a time-based cache.

    Args:
        ttl_seconds (int): How long to store each cached item.
        maxsize (int, optional): Maximum number of entries to keep in the cache.

    """

    def decorator(func):
        cache = {}

        def _serialize(value):
            try:
                hash(value)
                return value
            except TypeError:
                try:
                    return json.dumps(value, sort_keys=True)
                except Exception:
                    return str(value)

        def _purge_expired(now):
            expired = [k for k, (_, ts) in cache.items() if now - ts >= ttl_seconds]
            for k in expired:
                del cache[k]

        @wraps(func)
        def wrapper(*args, **kwargs):
            if args and hasattr(args[0], "__dict__"):
                key_prefix = id(args[0])
                key_args = args[1:]
            else:
                key_prefix = None
                key_args = args

            serialized_args = tuple(_serialize(a) for a in key_args)
            serialized_kwargs = tuple(sorted((k, _serialize(v)) for k, v in kwargs.items()))
            key = (key_prefix, serialized_args, serialized_kwargs)
            now = time.time()
            _purge_expired(now)
            cached = cache.get(key)
            if cached and now - cached[1] < ttl_seconds:
                return cached[0]
            result = func(*args, **kwargs)
            if result is not None:
                now = time.time()
                _purge_expired(now)
                if maxsize is not None and len(cache) >= maxsize:
                    oldest_key = min(cache.items(), key=lambda item: item[1][1])[0]
                    del cache[oldest_key]
                cache[key] = (result, now)
            return result

        def cache_clear():
            cache.clear()

        def cache_size():
            return len(cache)

        wrapper.cache_clear = cache_clear
        wrapper.cache_size = cache_size
        return wrapper

    return decorator

__all__ = ["ttl_cache"]
