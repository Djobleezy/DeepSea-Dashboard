"""Worker settings endpoints — persist ASIC overrides and electricity rate."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, StringConstraints

import aiosqlite

from app import background
from app.config import get_power_cost, save_config
from app.db import (
    get_db,
    get_worker_overrides,
    set_worker_overrides,
)

router = APIRouter(tags=["worker-settings"])


# ── Models ────────────────────────────────────────────────────────────────


class WorkerOverride(BaseModel):
    asicId: str | None = Field(default=None, min_length=1, max_length=128)
    efficiency: float | None = Field(default=None, gt=0, le=200)
    power: float | None = Field(default=None, ge=0, le=50_000)


WorkerName = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class WorkerOverridesPayload(BaseModel):
    overrides: dict[WorkerName, WorkerOverride]


class WorkerOverridesResponse(BaseModel):
    overrides: dict[str, WorkerOverride]
    electricity_rate: float


class ElectricityRatePayload(BaseModel):
    rate: float = Field(ge=0, le=10)


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.get(
    "/workers/settings",
    response_model=WorkerOverridesResponse,
    summary="Get all worker ASIC overrides and electricity rate",
)
async def get_settings(db: aiosqlite.Connection = Depends(get_db)):
    overrides = await get_worker_overrides(db)
    return WorkerOverridesResponse(overrides=overrides, electricity_rate=get_power_cost())


@router.put(
    "/workers/settings",
    response_model=WorkerOverridesResponse,
    summary="Save all worker ASIC overrides",
)
async def save_settings(
    payload: WorkerOverridesPayload,
    db: aiosqlite.Connection = Depends(get_db),
):
    overrides_dict = {k: v.model_dump() for k, v in payload.overrides.items()}
    await set_worker_overrides(db, overrides_dict)
    await background.refresh_financials(db)
    return WorkerOverridesResponse(overrides=overrides_dict, electricity_rate=get_power_cost())


@router.put(
    "/workers/settings/electricity-rate",
    summary="Save electricity rate ($/kWh)",
)
async def save_electricity_rate(
    payload: ElectricityRatePayload,
    db: aiosqlite.Connection = Depends(get_db),
):
    await run_in_threadpool(save_config, {"power_cost": payload.rate})
    await background.refresh_financials(db)
    return {"electricity_rate": payload.rate}
