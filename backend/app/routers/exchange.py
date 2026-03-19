"""GET /api/exchange-rates — current USD-based exchange rates."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.exchange_service import SUPPORTED_CURRENCIES, get_exchange_rates

router = APIRouter()


@router.get("/exchange-rates")
async def exchange_rates() -> dict:
    """Return exchange rates relative to USD for all supported currencies.

    Response example::

        {
            "base": "USD",
            "currencies": ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF"],
            "rates": {"USD": 1.0, "EUR": 0.92, "GBP": 0.79, ...}
        }

    Rates are cached for 1 hour. Degrades gracefully to ``{"USD": 1.0}`` if
    the upstream Frankfurter API is unreachable.
    """
    rates = await get_exchange_rates()
    return {
        "base": "USD",
        "currencies": SUPPORTED_CURRENCIES,
        "rates": rates,
    }
