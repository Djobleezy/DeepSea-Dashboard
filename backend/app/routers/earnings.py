"""Earnings and payout history endpoints."""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Query

from app import background
from app.config import get_currency, get_wallet
from app.models import EarningsResponse, Payment
from app.services.ocean_client import OceanClient

router = APIRouter()

SATS_PER_BTC = 100_000_000


@router.get("/earnings", response_model=EarningsResponse, tags=["earnings"])
async def get_earnings(
    days: int = Query(default=90, ge=1, le=365, description="History window in days (1–365)"),
) -> EarningsResponse:
    """Return payment history and earnings aggregates for the configured wallet.

    Fetches payout records from the Ocean.xyz API and computes daily/monthly
    summaries. Requires ``wallet`` to be set in config. Returns empty response
    with 200 if wallet is not configured.
    """
    wallet = get_wallet()
    if not wallet:
        return EarningsResponse()

    # Get BTC price from cached metrics
    btc_price = None
    metrics = background.get_current_metrics()
    if metrics:
        btc_price = metrics.get("btc_price")

    client = OceanClient(wallet=wallet)
    try:
        raw_payments = await client.get_payment_history(days=days, btc_price=btc_price)
    finally:
        await client.close()

    payments = [Payment(**p) for p in raw_payments]
    total_sats = sum(p.amount_sats for p in payments)
    total_btc = total_sats / SATS_PER_BTC

    # Monthly summary
    monthly: dict[str, dict] = defaultdict(lambda: {"sats": 0, "btc": 0.0, "fiat": 0.0, "count": 0})
    for p in payments:
        if p.date:
            month_key = p.date[:7]  # "YYYY-MM"
            monthly[month_key]["sats"] += p.amount_sats
            monthly[month_key]["btc"] += p.amount_btc
            monthly[month_key]["fiat"] += p.fiat_value or 0
            monthly[month_key]["count"] += 1

    monthly_list = [
        {"month": k, **v} for k, v in sorted(monthly.items(), reverse=True)
    ]

    return EarningsResponse(
        payments=payments,
        total_btc=round(total_btc, 8),
        total_sats=total_sats,
        monthly_summary=monthly_list,
        currency=get_currency(),
    )
