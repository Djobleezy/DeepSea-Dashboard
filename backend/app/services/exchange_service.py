"""Exchange rate service — fetches and caches currency rates from Frankfurter.app.

No API key required. Rates are cached for 1 hour. Gracefully degrades: if the
upstream API is unavailable, USD returns 1.0 and other currencies return None
(callers should handle None by displaying raw USD amounts or hiding conversion).

Supported currencies: USD, EUR, GBP, CAD, AUD, JPY, CHF
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

_log = logging.getLogger(__name__)

# Supported target currencies (always fetched relative to USD base)
SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF"]

_FRANKFURTER_URL = "https://api.frankfurter.app/latest"
_CACHE_TTL_SECONDS = 3600  # 1 hour

_cache: dict[str, Any] = {
    "rates": {"USD": 1.0},  # default — USD is always 1:1
    "expires_at": 0.0,
    "lock": None,  # asyncio.Lock, initialised on first use
}


def _get_lock() -> asyncio.Lock:
    if _cache["lock"] is None:
        _cache["lock"] = asyncio.Lock()
    return _cache["lock"]


async def get_exchange_rates(base: str = "USD") -> dict[str, float]:
    """Return a dict of {currency: rate_from_USD}.

    Always returns at minimum {"USD": 1.0}.  On API failure the dict may only
    contain previously cached currencies or just USD.
    """
    lock = _get_lock()
    async with lock:
        now = time.time()
        if now < _cache["expires_at"]:
            return dict(_cache["rates"])

        # Cache expired — try to refresh
        try:
            symbols = ",".join(c for c in SUPPORTED_CURRENCIES if c != "USD")
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    _FRANKFURTER_URL,
                    params={"base": "USD", "symbols": symbols},
                )
                resp.raise_for_status()
                data = resp.json()

            rates: dict[str, float] = {"USD": 1.0}
            if "rates" in data and isinstance(data["rates"], dict):
                for currency, rate in data["rates"].items():
                    if isinstance(rate, (int, float)) and rate > 0:
                        rates[currency] = float(rate)

            _cache["rates"] = rates
            _cache["expires_at"] = now + _CACHE_TTL_SECONDS
            _log.info("Exchange rates refreshed: %s", list(rates.keys()))

        except Exception as exc:  # noqa: BLE001
            _log.warning("Failed to fetch exchange rates: %s — using cached/default", exc)
            # Keep stale cache; bump expiry slightly to avoid hammering on repeated failures
            if _cache["expires_at"] == 0.0:
                # First-run failure: set a short retry window
                _cache["expires_at"] = now + 60.0
            # else: keep stale data until next natural expiry

        return dict(_cache["rates"])


async def get_rate_for_currency(currency: str) -> float:
    """Return the exchange rate (USD → currency). Returns 1.0 for USD or on error."""
    cur = (currency or "USD").upper()
    if cur == "USD":
        return 1.0
    rates = await get_exchange_rates()
    return rates.get(cur, 1.0)
