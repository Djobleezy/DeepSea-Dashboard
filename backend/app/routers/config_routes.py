"""Config GET/POST and timezone list endpoints."""

import pytz
from fastapi import APIRouter

from app.config import load_config, save_config
from app.models import AppConfig, ConfigUpdate

router = APIRouter()


@router.get("/config", response_model=AppConfig)
async def get_config():
    cfg = load_config()
    return AppConfig(
        wallet=cfg.get("wallet", ""),
        power_cost=float(cfg.get("power_cost", 0.12)),
        power_usage=float(cfg.get("power_usage", 3450)),
        currency=cfg.get("currency", "USD"),
        timezone=cfg.get("timezone", "America/Los_Angeles"),
        network_fee=float(cfg.get("network_fee", 0.5)),
        extended_history=bool(cfg.get("extended_history", False)),
    )


@router.post("/config", response_model=AppConfig)
async def update_config(payload: ConfigUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    save_config(update)
    return await get_config()


@router.get("/timezones")
async def list_timezones():
    return {"timezones": sorted(pytz.all_timezones)}
