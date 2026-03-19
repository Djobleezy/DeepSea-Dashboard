"""Workers endpoints."""

from typing import Literal

from fastapi import APIRouter, Query

from app import background
from app.models import WorkerSummary
from app.services.cache import cache_get
from app.services.worker_service import filter_workers, sort_workers

router = APIRouter()


def _distribute_earnings(workers: list[dict], unpaid_btc: float) -> list[dict]:
    """Distribute unpaid earnings across workers proportionally by hashrate (like v1)."""
    if not workers or unpaid_btc <= 0:
        return workers

    total_hr = sum(float(w.get("hashrate_60sec", 0)) for w in workers)
    if total_hr <= 0:
        # Even split if no hashrate data
        share = unpaid_btc / len(workers)
        for w in workers:
            w["earnings"] = share
        return workers

    for w in workers:
        hr = float(w.get("hashrate_60sec", 0))
        w["earnings"] = (hr / total_hr) * unpaid_btc

    return workers


@router.get("/workers", response_model=WorkerSummary)
async def get_workers(
    status: Literal["all", "online", "offline"] = Query(default="all", description="Filter: all|online|offline"),
    sort_by: Literal["name", "status", "hashrate", "hashrate_3hr", "hashrate_60sec", "earnings", "efficiency", "last_share"] = Query(
        default="name", description="Sort column"
    ),
    descending: bool = Query(default=False),
):
    cached = await cache_get(background.get_cache_key("workers"))
    if not cached:
        live = background.get_current_workers()
        if live:
            cached = live
        else:
            return WorkerSummary()

    workers = cached.get("workers", [])

    # Distribute unpaid earnings from metrics proportionally by hashrate
    metrics = background.get_current_metrics()
    unpaid_btc = float(metrics.get("unpaid_earnings", 0)) if metrics else 0
    workers = _distribute_earnings(workers, unpaid_btc)

    workers = filter_workers(workers, status)
    workers = sort_workers(workers, sort_by, descending)

    workers_online = sum(1 for w in workers if w.get("status") == "online")
    workers_offline = sum(1 for w in workers if w.get("status") == "offline")
    total_hashrate = sum(float(w.get("hashrate_3hr", 0) or 0) for w in workers)

    return WorkerSummary(
        workers=workers,
        total_hashrate=total_hashrate,
        hashrate_unit=cached.get("hashrate_unit", "TH/s"),
        workers_total=len(workers),
        workers_online=workers_online,
        workers_offline=workers_offline,
        total_earnings=unpaid_btc,
        timestamp=cached.get("timestamp", ""),
    )
