"""Utility helpers for caching expensive operations."""

import json
import time
from functools import wraps


def ttl_cache(ttl_seconds=60):
    """Simple decorator providing a time based cache."""

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
            cached = cache.get(key)
            if cached and now - cached[1] < ttl_seconds:
                return cached[0]
            result = func(*args, **kwargs)
            if result is not None:
                cache[key] = (result, now)
            return result

        def cache_clear():
            cache.clear()

        wrapper.cache_clear = cache_clear
        return wrapper

    return decorator

__all__ = ["ttl_cache"]
