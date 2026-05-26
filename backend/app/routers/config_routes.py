"""Config GET/POST and timezone list endpoints."""

import asyncio
import logging

import pytz
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app import background
from app.config import load_config, save_config
from app.models import AppConfig, ConfigUpdate

_log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/config", response_model=AppConfig, tags=["config"])
async def get_config() -> AppConfig:
    """Return the current dashboard configuration.

    Reads from ``config.json`` at the repo root. All fields have safe defaults
    so this endpoint always returns a valid response even if the file is missing.
    """
    cfg = await run_in_threadpool(load_config)
    return AppConfig(
        wallet=cfg.get("wallet", ""),
        power_cost=float(cfg.get("power_cost", 0.12)),
        power_usage=float(cfg.get("power_usage", 3450)),
        currency=cfg.get("currency", "USD"),
        timezone=cfg.get("timezone", "America/Los_Angeles"),
        network_fee=float(cfg.get("network_fee", 0.5)),
        extended_history=bool(cfg.get("extended_history", False)),
        datum_gateway_url=cfg.get("datum_gateway_url", "") or "",
    )


@router.post("/config", response_model=AppConfig, tags=["config"])
async def update_config(payload: ConfigUpdate) -> AppConfig:
    """Update dashboard configuration and trigger a background metrics refresh.

    Only provided (non-null) fields are updated — omitted fields retain their
    current values. The config is saved atomically and a metrics refresh is
    fired in the background so new data reflects the new wallet/settings.
    """
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    await run_in_threadpool(save_config, update)

    # If the DATUM gateway URL changed, drop the probe cache so the
    # next /api/datum/status call hits the new endpoint immediately
    # instead of waiting up to CACHE_TTL for the stale result to age out.
    if "datum_gateway_url" in update:
        try:
            from app.services.datum_gateway_client import _reset_cache_for_tests

            _reset_cache_for_tests()
        except Exception:  # pragma: no cover — defensive import guard
            pass

    # Fire-and-forget: don't block the response waiting for Ocean API calls
    asyncio.ensure_future(_safe_refresh())

    return await get_config()


async def _safe_refresh() -> None:
    """Trigger a background metrics refresh, swallowing errors."""
    try:
        await background.trigger_refresh()
    except Exception as e:
        _log.warning("Config refresh failed after save: %s", e)


@router.get("/timezones", response_model=dict, tags=["config"])
async def list_timezones() -> dict[str, list[str]]:
    """Return all valid IANA timezone strings for the config timezone field."""
    return {"timezones": sorted(pytz.all_timezones)}
