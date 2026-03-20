"""Health check endpoint."""

import time

from fastapi import APIRouter

from app import background
from app.config import get_wallet
from app.models import HealthStatus
from app.services.cache import is_redis_connected

router = APIRouter()


@router.get("/health", response_model=HealthStatus, tags=["system"])
async def health_check() -> HealthStatus:
    """Check service health — version, Redis status, wallet configuration, and uptime.

    This endpoint is excluded from rate limiting and is safe to poll frequently.
    Returns 200 even when Redis is disconnected (Redis is not required for operation).
    """
    return HealthStatus(
        status="ok",
        version="2.0.3",
        wallet_configured=bool(get_wallet()),
        redis_connected=await is_redis_connected(),
        last_refresh=background.get_last_refresh(),
        uptime_seconds=background.get_uptime(),
        server_timestamp=time.time(),
    )
