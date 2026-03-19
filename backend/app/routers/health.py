"""Health check endpoint."""

import time
from fastapi import APIRouter

from app import background
from app.config import get_wallet
from app.models import HealthStatus
from app.services.cache import is_redis_connected

router = APIRouter()


@router.get("/health", response_model=HealthStatus)
async def health_check():
    return HealthStatus(
        status="ok",
        version="2.0.0",
        wallet_configured=bool(get_wallet()),
        redis_connected=await is_redis_connected(),
        last_refresh=background.get_last_refresh(),
        uptime_seconds=background.get_uptime(),
    )
