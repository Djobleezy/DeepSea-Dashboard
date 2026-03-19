"""Redis cache wrapper with graceful fallback to an in-process dict."""

import json
import logging
import time
from typing import Any, Optional

_redis_client = None
_local_cache: dict[str, tuple[Any, float]] = {}


async def init_cache(redis_url: str = "redis://redis:6379") -> None:
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
    if _redis_client is None:
        return False
    try:
        await _redis_client.ping()
        return True
    except Exception:
        return False


async def cache_get(key: str) -> Optional[Any]:
    if _redis_client is not None:
        try:
            val = await _redis_client.get(key)
            if val is not None:
                return json.loads(val)
        except Exception as e:
            logging.warning("Redis get error: %s", e)
    # Fallback
    entry = _local_cache.get(key)
    if entry is not None:
        value, expiry = entry
        if expiry == 0 or time.time() < expiry:
            return value
        del _local_cache[key]
    return None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    serialized = json.dumps(value, default=str)
    if _redis_client is not None:
        try:
            await _redis_client.setex(key, ttl, serialized)
            return
        except Exception as e:
            logging.warning("Redis set error: %s", e)
    # Fallback
    expiry = time.time() + ttl if ttl > 0 else 0
    _local_cache[key] = (json.loads(serialized), expiry)


async def cache_delete(key: str) -> None:
    if _redis_client is not None:
        try:
            await _redis_client.delete(key)
            return
        except Exception as e:
            logging.warning("Redis delete error: %s", e)
    _local_cache.pop(key, None)
