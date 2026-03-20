"""Blocks endpoint — fetches recent Bitcoin network blocks from mempool.space."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.models import Block, BlocksResponse

router = APIRouter()
_log = logging.getLogger(__name__)

MEMPOOL_API = "https://mempool.space/api"
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _time_ago(epoch: int) -> str:
    delta = int(time.time()) - epoch
    if delta < 0:
        return "just now"
    if delta < 60:
        return f"{delta}s ago"
    if delta < 3600:
        return f"{delta // 60}m ago"
    h = delta // 3600
    m = (delta % 3600) // 60
    return f"{h}h {m}m ago" if m else f"{h}h ago"


def _parse_mempool_block(raw: dict) -> Block:
    height = raw.get("height", 0)
    ts = raw.get("timestamp", 0)
    pool_name = ""
    pool_info = raw.get("extras", {}).get("pool", {})
    if isinstance(pool_info, dict):
        pool_name = pool_info.get("name", "Unknown")
    elif isinstance(pool_info, str):
        pool_name = pool_info

    reward_sat = raw.get("extras", {}).get("reward", 0) or 0
    total_fees = raw.get("extras", {}).get("totalFees", 0) or 0

    return Block(
        height=height,
        hash=raw.get("id", ""),
        timestamp=datetime.fromtimestamp(ts, tz=ZoneInfo("UTC")).isoformat() if ts else "",
        time_ago=_time_ago(ts) if ts else "",
        tx_count=raw.get("tx_count", 0),
        fees_btc=total_fees / 1e8,
        reward_btc=reward_sat / 1e8,
        pool=pool_name,
        miner_earnings_sats=0,
        pool_fees_percentage=0.0,
    )


async def _fetch_mempool_blocks(start_height: int | None = None) -> list[dict]:
    """Fetch ~15 blocks from mempool.space API."""
    url = f"{MEMPOOL_API}/v1/blocks/{start_height}" if start_height else f"{MEMPOOL_API}/v1/blocks"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


@router.get("/blocks", response_model=BlocksResponse, tags=["blocks"])
async def get_blocks(
    page: int = Query(default=0, ge=0, description="Page number (0-indexed)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Results per page (1–100)"),
) -> BlocksResponse:
    """Fetch recent Bitcoin network blocks from mempool.space.

    Supports pagination via ``page`` and ``page_size``. Block data includes
    height, hash, timestamp, transaction count, fees, reward, and mining pool.
    Returns 502 if mempool.space is unreachable.
    """
    try:
        # mempool.space returns ~15 blocks per call, paginate by fetching from a start height
        all_blocks: list[dict] = []
        start_height = None

        # Fetch enough pages to fill the request
        pages_needed = (page * page_size + page_size + 14) // 15  # ceil
        for _ in range(max(1, pages_needed)):
            batch = await _fetch_mempool_blocks(start_height)
            if not batch:
                break
            all_blocks.extend(batch)
            # Next batch starts from the lowest height - 1
            start_height = batch[-1].get("height", 0) - 1
            if len(all_blocks) >= page * page_size + page_size:
                break

        # Slice for pagination
        offset = page * page_size
        page_blocks = all_blocks[offset : offset + page_size]
        blocks = [_parse_mempool_block(b) for b in page_blocks]

        return BlocksResponse(
            blocks=blocks,
            page=page,
            page_size=page_size,
            total=len(blocks),
        )
    except httpx.HTTPError as e:
        _log.warning("Failed to fetch blocks from mempool.space: %s", e)
        raise HTTPException(status_code=502, detail="Failed to fetch blocks from upstream")
    except Exception as e:
        _log.exception("Unexpected blocks endpoint error: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/pool-blocks", tags=["blocks"])
async def get_pool_blocks(
    hours: int = Query(default=6, ge=1, le=72),
):
    """Return recent Ocean pool blocks within the last *hours*.

    Used by the chart annotation hook to retroactively mark pool blocks
    that were found while the user wasn't watching.
    """
    from app import background

    client = background._client
    if client is None:
        return {"blocks": []}
    blocks = await client.get_blocks(page=0, page_size=20)
    cutoff = time.time() - hours * 3600
    result = []
    for b in blocks:
        ts_raw = b.get("ts") or b.get("time") or b.get("timestamp")
        if not ts_raw:
            continue
        try:
            ts_str = str(ts_raw)
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=ZoneInfo("UTC"))
                epoch = dt.timestamp()
            except (ValueError, TypeError):
                epoch = float(ts_str)
        except (ValueError, TypeError):
            continue
        if epoch >= cutoff:
            result.append({
                "height": b.get("height"),
                "timestamp": int(epoch * 1000),  # JS milliseconds
                "time_ago": _time_ago(int(epoch)),
            })
    return {"blocks": result}
