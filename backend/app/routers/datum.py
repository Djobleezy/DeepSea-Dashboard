"""Report gateway reachability separately from historical pool-fee evidence.

A reachable gateway does not prove an active DATUM pool connection: the v0.4.1
widget reports miners and hashrate, not upstream readiness. The status and
explanation describe only the reachability observed by the dashboard.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app import background
from app.models import DashboardMetrics
from app.services.datum_gateway_client import get_datum_status

router = APIRouter()

# These bounds match the frontend historical fee-evidence band.
# Keep them in sync if the band ever changes — there is also a copy in
# frontend/src/utils/datum.ts.
DATUM_FEE_BAND_LOW = 0.9
DATUM_FEE_BAND_HIGH = 1.3


class DatumStatus(BaseModel):
    """Response model for ``GET /api/datum/status``.

    Fields are deliberately verbose so the frontend can render an
    informative tooltip explaining *why* the badge is the color it is —
    that transparency is the whole point of this endpoint.
    """

    status: Literal["reachable", "unreachable", "unknown"]
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


def _classify(probe_reachable: bool, fees_in_band: bool, probe_method: str) -> tuple[str, str]:
    """Combine probe + fee signals into a (status, explanation) pair.

    The explanation strings are user-facing — the dashboard renders them
    in the badge tooltip.  Keep them short and concrete; this is the
    place where we *teach* users why the badge isn't matching their
    expectation, which is the core ask of the bug report.
    """
    fee_evidence = (
        "Historical pool fees are in the DATUM range."
        if fees_in_band
        else "Historical pool fees are outside the DATUM range."
    )
    if probe_method == "none":
        return (
            "unknown",
            f"No live gateway status is available. {fee_evidence} "
            "Fees alone do not establish whether DATUM is connected.",
        )
    if probe_reachable:
        return (
            "reachable",
            f"The gateway is reachable. {fee_evidence} "
            "This probe cannot verify its connection to the DATUM pool.",
        )
    return (
        "unreachable",
        f"The dashboard could not reach the gateway. {fee_evidence} "
        "Check the gateway address and connectivity; the gateway may still be mining.",
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
