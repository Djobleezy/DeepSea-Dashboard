"""Workers endpoints."""

from typing import Literal

from fastapi import APIRouter, Query

from app import background
from app.config import get_wallet
from app.models import WorkerSummary
from app.services.cache import cache_get
from app.services.worker_service import build_worker_summary, filter_workers, sort_workers

router = APIRouter()


@router.get("/workers", response_model=WorkerSummary, tags=["workers"])
async def get_workers(
    status: Literal["all", "online", "offline"] = Query(default="all", description="Filter: all|online|offline"),
    sort_by: Literal["name", "status", "hashrate", "hashrate_3hr", "hashrate_60sec", "earnings", "efficiency", "last_share"] = Query(
        default="name", description="Sort column"
    ),
    descending: bool = Query(default=False, description="Sort descending"),
) -> WorkerSummary:
    """Return the worker fleet with per-worker metrics and earnings distribution.

    Hashrates, status, efficiency, power consumption, and ASIC model are enriched
    by the worker service. Unpaid earnings are distributed proportionally by
    hashrate across all workers, separately from estimated daily revenue.
    Totals reflect the selected filter. Supports sorting by any metric column.
    """
    wallet = get_wallet().strip()
    cached = background.get_current_workers() or await cache_get(background.get_cache_key("workers"))
    if not cached or cached.get("wallet", wallet) != wallet:
        return WorkerSummary(wallet=wallet, data_status="unavailable" if wallet else "unconfigured")

    # Old cache entries may predate the canonical worker response. Never mutate
    # a cached dictionary while preparing a filtered REST response.
    if "total_daily_earnings_btc" not in cached:
        cached = build_worker_summary(cached, background.get_current_metrics() or {}, {}, wallet)
    workers = sort_workers(filter_workers(cached.get("workers", []), status), sort_by, descending)
    return WorkerSummary(
        **{
            **cached,
            "workers": workers,
            "workers_total": len(workers),
            "workers_online": sum(w.get("status") == "online" for w in workers),
            "workers_offline": sum(w.get("status") == "offline" for w in workers),
            "total_hashrate": sum(float(w.get("hashrate_3hr") or 0) for w in workers),
            "total_earnings": sum(float(w.get("earnings") or 0) for w in workers),
            "total_daily_earnings_btc": sum(float(w.get("estimated_daily_btc") or 0) for w in workers),
            "total_power_watts": sum(float(w.get("power_consumption") or 0) for w in workers),
        }
    )
