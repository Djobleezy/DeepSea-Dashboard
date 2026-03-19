"""Async cache layer with Redis as the primary store and an in-process dict fallback.

**Two-tier strategy:**

1. **Redis** (primary): Used when a Redis server is reachable at the URL passed to
   ``init_cache``.  All values are JSON-serialised before storage so complex Python
   objects (dicts, lists) round-trip cleanly.  TTL is set via Redis ``SETEX``.

2. **In-process dict** (fallback): Automatically engaged when Redis is unreachable at
   startup or when any subsequent Redis operation raises an exception.  Stores
   ``(value, expiry_timestamp)`` tuples; expired entries are evicted lazily on next
   read.  Suitable for single-process deployments or local development without Redis.

The fallback is transparent to callers — ``cache_get``, ``cache_set``, and
``cache_delete`` behave identically regardless of which tier is active.  If Redis
recovers, the module does **not** automatically reconnect; restart the process to
re-establish the Redis connection.

Note: The in-process fallback is not shared between worker processes.  Use Redis
for multi-process or multi-container deployments.
"""

import json
import logging
import time
from typing import Any, Optional

_redis_client = None
_local_cache: dict[str, tuple[Any, float]] = {}


async def init_cache(redis_url: str = "redis://redis:6379") -> None:
    """Connect to Redis and set the module-level client.

    On connection failure (unreachable host, auth error, etc.) the module falls
    back silently to the in-process dict cache.  This function is called once
    during the FastAPI lifespan startup.

    Args:
        redis_url: Redis connection URL (e.g. ``"redis://:password@host:6379"``).
    """
    global _redis_client
    try:
        import redis.asyncio as aioredis

        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
        await _redis_client.ping()
        logging.info("Redis connected at %s", redis_url)
    except Exception as e:
        logging.warning("Redis unavailable (%s), using in-process cache", e)
        _redis_client = None


async def is_redis_connected() -> bool:
    """Probe the Redis connection with a PING command.

    Returns:
        ``True`` if Redis responds to PING, ``False`` otherwise (including when
        the fallback is active).  On failure, resets ``_redis_client`` to
        ``None`` so subsequent cache calls use the local fallback.
    """
    global _redis_client
    if _redis_client is None:
        return False
    try:
        await _redis_client.ping()
        return True
    except Exception:
        _redis_client = None
        return False


async def cache_get(key: str) -> Optional[Any]:
    """Retrieve a cached value by key.

    Tries Redis first; falls back to the in-process dict on error or miss.
    Expired local-cache entries are evicted lazily.

    Args:
        key: Cache key string.

    Returns:
        The deserialised value, or ``None`` if the key is absent or expired.
    """
    global _redis_client
    if _redis_client is not None:
        try:
            val = await _redis_client.get(key)
            if val is not None:
                return json.loads(val)
        except Exception as e:
            logging.warning("Redis get error: %s; falling back to local cache", e)
            _redis_client = None
    # Fallback
    entry = _local_cache.get(key)
    if entry is not None:
        value, expiry = entry
        if expiry == 0 or time.time() < expiry:
            return value
        del _local_cache[key]
    return None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    """Store a value in the cache with a TTL.

    Serialises ``value`` to JSON using ``json.dumps(..., default=str)`` (so
    datetimes and other non-serialisable objects are coerced to strings).

    Args:
        key: Cache key string.
        value: Any JSON-serialisable value.
        ttl: Time-to-live in seconds (default 60).  A value of ``0`` means
            no expiry in the local fallback; Redis uses ``SETEX`` so 0 is
            avoided there.
    """
    global _redis_client
    serialized = json.dumps(value, default=str)
    if _redis_client is not None:
        try:
            await _redis_client.setex(key, ttl, serialized)
            return
        except Exception as e:
            logging.warning("Redis set error: %s; falling back to local cache", e)
            _redis_client = None
    # Fallback
    expiry = time.time() + ttl if ttl > 0 else 0
    _local_cache[key] = (json.loads(serialized), expiry)


async def cache_delete(key: str) -> None:
    """Delete a key from the cache (both Redis and local fallback).

    Args:
        key: Cache key to remove.  No-op if the key does not exist.
    """
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.delete(key)
            return
        except Exception as e:
            logging.warning("Redis delete error: %s; falling back to local cache", e)
            _redis_client = None
    _local_cache.pop(key, None)
