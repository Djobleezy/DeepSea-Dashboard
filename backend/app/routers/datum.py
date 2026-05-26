"""GET /api/datum/status — live DATUM Gateway reachability + lagging-fee state.

The dashboard's DATUM badge used to derive purely from
``pool_fees_percentage`` (between 0.9% and 1.3% = connected).  That signal
**lags reality** by hours or days for new DATUM users because Ocean's
stats page averages historical work.  This endpoint surfaces a
**current-state** signal by probing the DATUM Gateway directly, while
still returning the fee-based signal so the UI can show a
"transitioning" state when the two disagree.

State machine returned in ``status``:

- ``connected`` — probe reachable AND fees in band.  Steady-state happy path.
- ``transitioning`` — probe reachable XOR fees in band.  Either DATUM was
  just enabled and fees haven't caught up, OR the probe lost the gateway
  but historical fees still look DATUM-shaped.
- ``offline`` — probe unreachable AND fees out of band (or probe missing
  and fees out of band).
- ``unknown`` — no gateway URL configured and auto-discovery disabled
  AND fees zero/unset.  The dashboard should fall back to the legacy
  badge behaviour here so we don't regress users who never set this up.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app import background
from app.models import DashboardMetrics
from app.services.datum_gateway_client import get_datum_status

router = APIRouter()

# These bounds match the legacy frontend isDatumConnected() check.
# Keep them in sync if the band ever changes — there is also a copy in
# frontend/src/pages/Dashboard.tsx.
DATUM_FEE_BAND_LOW = 0.9
DATUM_FEE_BAND_HIGH = 1.3


class DatumStatus(BaseModel):
    """Response model for ``GET /api/datum/status``.

    Fields are deliberately verbose so the frontend can render an
    informative tooltip explaining *why* the badge is the color it is —
    that transparency is the whole point of this endpoint.
    """

    status: str  # connected | transitioning | offline | unknown
    probe_reachable: bool
    probe_method: str  # umbrel-api | stratum-tcp | none
    gateway_url: Optional[str] = None
    connections: Optional[int] = None
    hashrate_ths: Optional[float] = None
    pool_fees_percentage: float = 0.0
    fees_in_datum_band: bool = False
    fee_band_low: float = DATUM_FEE_BAND_LOW
    fee_band_high: float = DATUM_FEE_BAND_HIGH
    explanation: str = ""
    last_check: float = 0.0
    probe_error: Optional[str] = None


def _classify(probe_reachable: bool, fees_in_band: bool, probe_method: str, fees_pct: float) -> tuple[str, str]:
    """Combine probe + fee signals into a (status, explanation) pair.

    The explanation strings are user-facing — the dashboard renders them
    in the badge tooltip.  Keep them short and concrete; this is the
    place where we *teach* users why the badge isn't matching their
    expectation, which is the core ask of the bug report.
    """
    if probe_method == "none":
        # No probe configured — we can only say what the fee field says.
        if fees_in_band:
            return (
                "connected",
                "Pool fees within DATUM range (no direct gateway probe configured).",
            )
        if fees_pct > 0:
            return (
                "offline",
                "Pool fees outside DATUM range and no direct gateway probe configured. "
                "If you just enabled DATUM, set DATUM_GATEWAY_URL so the dashboard "
                "can confirm the gateway is up while fees catch up.",
            )
        return (
            "unknown",
            "No DATUM gateway URL configured and pool fees not yet reported.",
        )

    if probe_reachable and fees_in_band:
        return (
            "connected",
            "DATUM gateway reachable and pool fees in the DATUM range.",
        )
    if probe_reachable and not fees_in_band:
        # The headline bug case — DATUM is on, fees just haven't caught up.
        return (
            "transitioning",
            "DATUM gateway is reachable but pool fees haven't shifted into the "
            "DATUM range yet. Ocean averages your fee % over historical work, "
            "so it can take hours or days after you enable DATUM for the number "
            "to settle. Your gateway is running — this is expected.",
        )
    if (not probe_reachable) and fees_in_band:
        return (
            "transitioning",
            "Pool fees are in the DATUM range but the gateway probe failed. "
            "Your historical mining was via DATUM; check whether the gateway "
            "process is still running.",
        )
    return (
        "offline",
        "DATUM gateway probe failed and pool fees are outside the DATUM range.",
    )


@router.get("/datum/status", response_model=DatumStatus, tags=["datum"])
async def datum_status() -> DatumStatus:
    """Return the current DATUM Gateway reachability + fee-band status.

    Cheap to call — the underlying probe is cached for ~15 s.  Safe to
    poll alongside ``/api/metrics``; the frontend wires this into the
    same refresh cycle.
    """
    probe = await get_datum_status()

    # Pull pool fees from the most recent metrics snapshot rather than
    # making another upstream call.  Fall back to zero if the background
    # loop hasn't populated yet.
    raw_metrics = background.get_current_metrics() or {}
    metrics = DashboardMetrics(**raw_metrics) if raw_metrics else DashboardMetrics()
    fees_pct = float(metrics.pool_fees_percentage or 0.0)
    fees_in_band = DATUM_FEE_BAND_LOW <= fees_pct <= DATUM_FEE_BAND_HIGH

    status_label, explanation = _classify(
        probe_reachable=probe.reachable,
        fees_in_band=fees_in_band,
        probe_method=probe.probe,
        fees_pct=fees_pct,
    )

    return DatumStatus(
        status=status_label,
        probe_reachable=probe.reachable,
        probe_method=probe.probe,
        gateway_url=probe.gateway_url,
        connections=probe.connections,
        hashrate_ths=probe.hashrate_ths,
        pool_fees_percentage=fees_pct,
        fees_in_datum_band=fees_in_band,
        explanation=explanation,
        last_check=probe.checked_at,
        probe_error=probe.reason,
    )
