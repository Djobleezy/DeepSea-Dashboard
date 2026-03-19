"""Metrics aggregation, normalisation, and financial calculations.

This module is the core data-assembly layer for the dashboard.  It coordinates
parallel fetches from multiple Ocean API endpoints, normalises units, computes
financial metrics, and returns a fully typed :class:`~app.models.DashboardMetrics`
instance.

**Aggregation pipeline** (``fetch_full_metrics``):

1. Fire five concurrent API calls via ``asyncio.gather``: user hashrates, stat
   snapshot, pool stats, latest block info, and Bitcoin network stats.
2. Merge all result dicts into a single flat ``merged`` dict (later sources
   overwrite earlier ones for conflicting keys).
3. Normalise all hashrate fields to TH/s.
4. Resolve ``workers_hashing`` from the per-user hashrate endpoint (not the
   pool-wide count).
5. Estimate ``daily_mined_sats`` from the hashrate-to-network-hashrate ratio.
6. Compute profitability figures (revenue, power cost, profit) using config values.
7. Optionally merge fields only available via HTML scraping (``est_time_to_payout``,
   ``pool_fees_percentage``, ``blocks_found``) from a pre-cached scrape result.
8. Detect low-hashrate mode (< 1 TH/s on the 60-second window).
9. Construct and return a :class:`~app.models.DashboardMetrics` Pydantic model.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from app.config import get_power_cost, get_power_usage
from app.models import DashboardMetrics, convert_to_ths, format_hashrate
from app.services.ocean_client import OceanClient

SATS_PER_BTC = 100_000_000
_log = logging.getLogger(__name__)


def _normalize_hashrate_fields(data: dict) -> dict:
    """Convert all hashrate fields in ``data`` to TH/s.

    Reads each ``hashrate_*`` field and its companion ``*_unit`` field,
    converts to TH/s using :func:`~app.models.convert_to_ths`, and writes
    back ``"TH/s"`` as the unit.  Unknown or unconvertible values are
    replaced with ``0.0``.

    Args:
        data: Flat metrics dict containing raw hashrate values.

    Returns:
        A new dict with normalised hashrate fields.
    """
    out = dict(data)
    for field in ("hashrate_60sec", "hashrate_10min", "hashrate_3hr", "hashrate_24hr"):
        raw = out.get(field)
        unit = out.get(f"{field}_unit", "TH/s")
        if raw is not None:
            try:
                ths = convert_to_ths(float(raw), unit)
                out[field] = ths
                out[f"{field}_unit"] = "TH/s"
            except (TypeError, ValueError):
                out[field] = 0.0
                out[f"{field}_unit"] = "TH/s"
    return out


def compute_financials(
    daily_sats: int,
    monthly_sats: int,
    btc_price: float,
    power_cost: float,
    power_usage: float,
) -> dict[str, float]:
    """Calculate daily and monthly revenue, power cost, and profit in USD.

    Formulas::

        daily_revenue  = (daily_sats / 1e8) × btc_price
        daily_power    = (power_usage_w / 1000) × 24 h × power_cost_per_kwh
        daily_profit   = daily_revenue - daily_power
        monthly_profit = monthly_revenue - (daily_power × 30)

    Args:
        daily_sats: Estimated sats mined per day.
        monthly_sats: Estimated sats mined per month (typically daily × 30).
        btc_price: Current BTC price in USD.
        power_cost: Electricity cost in $/kWh (from config).
        power_usage: Total miner power draw in watts (from config).

    Returns:
        Dict with keys: ``daily_revenue``, ``daily_power_cost``,
        ``daily_profit_usd``, ``monthly_profit_usd`` (all USD, rounded to 2 dp).
    """
    daily_revenue = (daily_sats / SATS_PER_BTC) * btc_price
    monthly_revenue = (monthly_sats / SATS_PER_BTC) * btc_price
    daily_power = (power_usage / 1000) * 24 * power_cost
    daily_profit = daily_revenue - daily_power
    monthly_profit = monthly_revenue - daily_power * 30
    return {
        "daily_revenue": round(daily_revenue, 2),
        "daily_power_cost": round(daily_power, 2),
        "daily_profit_usd": round(daily_profit, 2),
        "monthly_profit_usd": round(monthly_profit, 2),
    }


def estimate_daily_sats_from_hashrate(
    hashrate_ths: float,
    network_hashrate_hs: float,
    block_reward_btc: float = 3.125,
) -> int:
    """Estimate daily mined satoshis from the miner's share of network hashrate.

    Uses the proportional-share formula::

        daily_btc = (user_H/s / network_H/s) × 144 blocks/day × block_reward_btc

    This is a theoretical estimate; actual earnings depend on pool luck,
    fees, and variance.

    Args:
        hashrate_ths: Miner's hashrate in TH/s.
        network_hashrate_hs: Current network hashrate in H/s (raw).
        block_reward_btc: Current block subsidy in BTC (default 3.125 post-4th
            halving).

    Returns:
        Estimated daily earnings in satoshis (integer).  Returns ``0`` if
        either hashrate argument is zero or negative.
    """
    if network_hashrate_hs <= 0 or hashrate_ths <= 0:
        return 0
    user_hs = hashrate_ths * 1e12
    blocks_per_day = 144
    ratio = user_hs / network_hashrate_hs
    daily_btc = ratio * blocks_per_day * block_reward_btc
    return int(daily_btc * SATS_PER_BTC)


async def fetch_full_metrics(
    client: OceanClient,
    cached_scrape: Optional[dict] = None,
) -> DashboardMetrics:
    """Fetch, merge, and normalise all metrics into a ``DashboardMetrics`` model.

    Executes five Ocean/Bitcoin API calls concurrently, merges results, applies
    normalisation and financial calculations, and returns a fully populated
    :class:`~app.models.DashboardMetrics` instance.

    Args:
        client: Authenticated :class:`~app.services.ocean_client.OceanClient`
            instance for the configured wallet.
        cached_scrape: Optional dict of fields sourced from a previous HTML
            scrape (e.g. ``est_time_to_payout``, ``pool_fees_percentage``,
            ``blocks_found``).  Used to fill in values not available via the
            REST API.  Pass ``None`` to skip scrape merging.

    Returns:
        A fully populated :class:`~app.models.DashboardMetrics` instance.
        Fields that could not be fetched retain their default values (typically
        ``0.0`` or ``"N/A"``).
    """
    power_cost = get_power_cost()
    power_usage = get_power_usage()

    (
        hr_data,
        snap_data,
        pool_data,
        block_data,
        btc_data,
    ) = await asyncio.gather(
        client.get_user_hashrate(),
        client.get_statsnap(),
        client.get_pool_stat(),
        client.get_latest_block_info(),
        client.get_bitcoin_stats(),
        return_exceptions=False,
    )

    merged: dict[str, Any] = {}
    merged.update(hr_data)
    merged.update(snap_data)
    merged.update(pool_data)
    merged.update(block_data)

    # BTC stats
    btc_price = float(btc_data.get("btc_price", 0))
    merged["btc_price"] = btc_price
    merged["network_hashrate_raw"] = btc_data.get("network_hashrate", 0)
    merged["difficulty"] = float(btc_data.get("difficulty") or pool_data.get("difficulty") or 0)

    # Format network hashrate
    nh_raw = float(merged.get("network_hashrate_raw") or 0)
    nh_ths = convert_to_ths(nh_raw, "H/s")
    nh_val, nh_unit = format_hashrate(nh_ths)
    merged["network_hashrate"] = nh_val
    merged["network_hashrate_unit"] = nh_unit

    # Normalize user hashrates
    merged = _normalize_hashrate_fields(merged)

    # workers_hashing: prefer user_hashrate active_worker_count (per-user, not pool total)
    # pool_stat gives pool-wide count — don't use it for workers_hashing
    workers_hashing = int(hr_data.get("workers_hashing") or 0)
    merged["workers_hashing"] = workers_hashing

    # Earnings estimates
    hr_3hr_ths = float(merged.get("hashrate_3hr") or 0)
    daily_sats = estimate_daily_sats_from_hashrate(hr_3hr_ths, nh_raw)
    monthly_sats = daily_sats * 30
    merged["daily_mined_sats"] = daily_sats
    merged["monthly_mined_sats"] = monthly_sats

    # Financials
    financials = compute_financials(daily_sats, monthly_sats, btc_price, power_cost, power_usage)
    merged.update(financials)

    # Scrape fallback for fields only available via HTML
    if cached_scrape:
        for field in ("est_time_to_payout", "pool_fees_percentage", "blocks_found"):
            if merged.get(field) is None or merged.get(field) == 0:
                val = cached_scrape.get(field)
                if val is not None:
                    merged[field] = val

    # Low hashrate mode detection — designed for BitAxe / small tabletop
    # miners whose 60-second readings are extremely volatile (they may only
    # submit a share every few minutes).  When active the frontend switches
    # the primary chart line from 60-sec to 3-hr data, notification
    # thresholds use the 3-hr window, and the "60 SEC" card is de-emphasised.
    #
    # Threshold: < 1 TH/s on the *3-hour* window.  We use the 3-hr reading
    # because 60-sec is unreliable at low hashrates — that's the whole point
    # of the mode.
    hr_3hr = float(merged.get("hashrate_3hr") or 0)
    merged["low_hashrate_mode"] = hr_3hr < 1.0  # < 1 TH/s on 3hr avg

    merged["server_timestamp"] = time.time()

    # Build typed model
    safe: dict[str, Any] = {}
    for field in DashboardMetrics.model_fields:
        val = merged.get(field)
        if val is not None:
            safe[field] = val

    return DashboardMetrics(**safe)
