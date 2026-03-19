"""Blocks endpoint."""

from __future__ import annotations

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.config import get_wallet
from app.models import Block, BlocksResponse
from app.services.ocean_client import OceanClient

router = APIRouter()


def _parse_block(raw: dict) -> Block:
    height = int(raw.get("height") or 0)
    ts_raw = raw.get("ts") or raw.get("time") or raw.get("timestamp")
    ts_str = ""
    time_ago = ""
    if ts_raw:
        try:
            try:
                dt = datetime.fromisoformat(str(ts_raw)).replace(tzinfo=ZoneInfo("UTC"))
            except (ValueError, TypeError):
                dt = datetime.fromtimestamp(float(ts_raw), tz=ZoneInfo("UTC"))
            ts_str = dt.isoformat()
            delta = int(time.time() - dt.timestamp())
            if delta < 60:
                time_ago = f"{delta}s ago"
            elif delta < 3600:
                time_ago = f"{delta // 60}m ago"
            else:
                h = delta // 3600
                m = (delta % 3600) // 60
                time_ago = f"{h}h {m}m ago" if m else f"{h}h ago"
        except Exception:
            pass

    return Block(
        height=height,
        hash=raw.get("hash", ""),
        timestamp=ts_str,
        time_ago=time_ago,
        tx_count=int(raw.get("tx_count") or raw.get("ntx") or 0),
        fees_btc=float(raw.get("fees") or raw.get("total_fees") or 0) / 1e8,
        reward_btc=float(raw.get("reward") or raw.get("coinbase") or 312500000) / 1e8,
        pool=raw.get("pool", "Ocean.xyz"),
        miner_earnings_sats=int(raw.get("miner_earnings_sats") or 0),
        pool_fees_percentage=float(raw.get("pool_fees_pct") or 0),
    )


@router.get("/blocks", response_model=BlocksResponse)
async def get_blocks(
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=20, ge=1, le=100),
):
    wallet = get_wallet()
    if not wallet:
        return BlocksResponse()

    client = OceanClient(wallet=wallet)
    try:
        raw_blocks = await client.get_blocks(page=page, page_size=page_size)
        blocks = [_parse_block(b) for b in raw_blocks]
        return BlocksResponse(
            blocks=blocks,
            page=page,
            page_size=page_size,
            total=len(blocks),
        )
    finally:
        await client.close()
