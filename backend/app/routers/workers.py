"""Workers endpoints."""

from fastapi import APIRouter, Query

from app import background
from app.models import WorkerSummary
from app.services.cache import cache_get
from app.services.worker_service import filter_workers, sort_workers

router = APIRouter()


@router.get("/workers", response_model=WorkerSummary)
async def get_workers(
    status: str = Query(default="all", description="Filter: all|online|offline"),
    sort_by: str = Query(default="name", description="Sort column"),
    descending: bool = Query(default=False),
):
    cached = await cache_get("workers")
    if not cached:
        live = background.get_current_workers()
        if live:
            cached = live
        else:
            return WorkerSummary()

    workers = cached.get("workers", [])
    workers = filter_workers(workers, status)
    workers = sort_workers(workers, sort_by, descending)

    return WorkerSummary(
        workers=workers,
        total_hashrate=cached.get("total_hashrate", 0.0),
        hashrate_unit=cached.get("hashrate_unit", "TH/s"),
        workers_total=cached.get("workers_total", len(workers)),
        workers_online=sum(1 for w in workers if w.get("status") == "online"),
        workers_offline=sum(1 for w in workers if w.get("status") == "offline"),
        total_earnings=cached.get("total_earnings", 0.0),
        timestamp=cached.get("timestamp", ""),
    )
