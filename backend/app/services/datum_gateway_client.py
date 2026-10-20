"""Check reachability of a configured local DATUM gateway.

Try the `/umbrel-api` widget first, then TCP port 23334 for builds without
that widget. These probes establish reachability only: DATUM v0.4.1 does
not report pool readiness here. Historical fees are not connection status.

The environment variable DATUM_GATEWAY_URL takes precedence over config.json.
Optional DATUM_GATEWAY_AUTODISCOVER probes known local deployment addresses.
Results are cached for 15 seconds; each network attempt has a 2-second timeout.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import math
import os
import socket
import time
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.config import load_config

_log = logging.getLogger(__name__)

# Cache the probe result for this many seconds.  The dashboard refreshes
# every 30-60 s, so 15 s gives us at most one extra probe per visible
# refresh cycle while still surfacing real outages quickly.
CACHE_TTL = 15.0

# How long any single probe is allowed to take.  Tight enough that a
# misconfigured URL won't slow the dashboard down.
PROBE_TIMEOUT = 2.0

# Default stratum port from the upstream DATUM gateway config.
DEFAULT_STRATUM_PORT = 23334

# UmbrelOS-style defaults we'll try when auto-discovery is enabled.
# These are intentionally narrow — we don't want to scan the user's
# network, just check the two most common deployment shapes.
AUTODISCOVER_CANDIDATES: tuple[str, ...] = (
    # Umbrel container hostname (api port 21000 per their compose)
    "http://datum_datum_1:21000",
    # Loopback default (upstream gateway example uses 7152)
    "http://127.0.0.1:7152",
    # Loopback with the Umbrel port (some self-hosters reuse it)
    "http://127.0.0.1:21000",
)


@dataclass
class DatumProbeResult:
    """One probe attempt's outcome.

    Attributes:
        reachable: ``True`` if any probe succeeded.
        status: Coarse label: ``connected`` | ``offline`` | ``unknown``.
            ``unknown`` means no URL was configured and auto-discovery is
            off, so we cannot make any statement about reachability.
        probe: Which method produced the result
            (``umbrel-api`` | ``stratum-tcp`` | ``none``).
        gateway_url: The URL we actually probed (may be auto-discovered).
        connections: Worker connection count (only via umbrel-api).
        hashrate_ths: Estimated hashrate in TH/s (only via umbrel-api).
        reason: Short human-readable error if not reachable.
        checked_at: Unix timestamp of the probe.
    """

    reachable: bool
    status: str
    probe: str
    gateway_url: Optional[str]
    connections: Optional[int] = None
    hashrate_ths: Optional[float] = None
    reason: Optional[str] = None
    checked_at: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


# Module-level cache.  Single in-process; the background refresh loop
# also calls into here so this stays warm without per-request work.
_cached_result: Optional[DatumProbeResult] = None
_cached_at: float = 0.0
_probe_lock = asyncio.Lock()
_cache_generation = 0


# Hostnames that resolve to in-cluster Docker services we expect users to
# point at on Umbrel / Start9 / docker-compose setups.  These bypass the
# IP-literal allowlist because Docker's embedded DNS only resolves them
# inside the user's own container network.
_TRUSTED_DOCKER_HOSTS: frozenset[str] = frozenset(
    {
        "datum_datum_1",
        "datum_gateway",
        "datum",
        "datum_web_1",
        "localhost",
    }
)


def _is_safe_gateway_host(host: str) -> tuple[bool, str]:
    """Return ``(ok, reason)`` for a candidate gateway host.

    The DATUM gateway URL is user-controlled via the unauthenticated
    ``/api/config`` endpoint, and the resolved URL is fed directly into
    outbound HTTP and TCP connects.  Without this guard the probe is an
    SSRF and port-scan primitive: an attacker who can reach
    ``/api/config`` could point the dashboard at cloud-metadata
    endpoints (``169.254.169.254``), an arbitrary LAN host, or an
    internal API on localhost.

    Policy: allow only loopback, RFC1918 private ranges, and a small
    set of well-known Docker service names.  Reject link-local,
    multicast, public IPs, and anything we can't classify.
    """
    if not host:
        return False, "empty-host"

    h = host.strip().lower()

    # Strip an optional ``[ipv6]`` bracket form that urlparse already
    # removes, but be defensive in case callers pass a raw string.
    if h.startswith("[") and h.endswith("]"):
        h = h[1:-1]

    # Allow a curated list of Docker service hostnames — these only
    # resolve inside the user's own container network.
    if h in _TRUSTED_DOCKER_HOSTS:
        return True, "docker-service"

    # If it parses as an IP literal, classify it.
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        # Not an IP — reject unrecognised hostnames.  We don't do DNS
        # lookups here because (a) that's another network round-trip
        # before the probe, and (b) an attacker controls the hostname
        # and could trivially defeat a one-shot resolve via TTL games.
        return False, "unrecognised-host"

    if ip.is_loopback:
        return True, "loopback"
    if ip.is_link_local:
        return False, "link-local"  # blocks 169.254.169.254 metadata
    if ip.is_multicast:
        return False, "multicast"
    if ip.is_unspecified:
        return False, "unspecified"  # 0.0.0.0 / ::
    if ip.is_reserved:
        return False, "reserved"
    if ip.is_private:
        return True, "private"
    return False, "public-ip"


def _validate_gateway_url(url: str) -> Optional[str]:
    """Normalise + validate a candidate gateway URL.

    Returns the cleaned URL string when the URL is shaped like
    ``http(s)://<safe-host>[:port][/...]``, otherwise ``None``.  Logs a
    warning when a URL is rejected so misconfiguration is debuggable.
    """
    if not url:
        return None
    cleaned = url.strip().rstrip("/")
    if not cleaned:
        return None
    try:
        parsed = urlparse(cleaned)
        # Accessing .port validates malformed and out-of-range ports.
        parsed.port
    except ValueError:
        _log.warning("DATUM gateway URL rejected (unparseable): %r", url)
        return None
    if parsed.scheme not in {"http", "https"}:
        _log.warning("DATUM gateway URL rejected (bad scheme %r)", parsed.scheme)
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    host = parsed.hostname or ""
    ok, reason = _is_safe_gateway_host(host)
    if not ok:
        _log.warning(
            "DATUM gateway URL rejected (host=%r reason=%s)", host, reason
        )
        return None
    return cleaned


def _resolve_gateway_url() -> Optional[str]:
    """Return the configured DATUM gateway base URL, or None.

    Validates against :func:`_is_safe_gateway_host` so a user-supplied
    ``datum_gateway_url`` cannot turn the probe into an SSRF / port
    scanner.  Invalid URLs are logged and treated as "not configured".
    """
    env_url = os.environ.get("DATUM_GATEWAY_URL", "").strip()
    if env_url:
        validated = _validate_gateway_url(env_url)
        if validated:
            return validated
        # Fall through to config if env was invalid; this matches the
        # "env > config" precedence while still letting a sane config
        # value win if the env is garbage.
    try:
        cfg = load_config()
    except Exception:  # pragma: no cover — load_config is defensive itself
        return None
    cfg_url = (cfg.get("datum_gateway_url") or "").strip()
    if cfg_url:
        return _validate_gateway_url(cfg_url)
    return None


def _autodiscover_enabled() -> bool:
    return os.environ.get("DATUM_GATEWAY_AUTODISCOVER", "").lower() in {"1", "true", "yes"}


def _parse_hashrate_ths(text: str, unit: str) -> Optional[float]:
    """Convert the gateway's ``"%.2f %s"`` hashrate to TH/s.

    The umbrel-api widget formats hashrate via the gateway's
    ``dynamic_hash_unit`` helper, which yields units like ``H/s``, ``KH/s``,
    ``MH/s``, ``GH/s``, ``TH/s``, ``PH/s``, ``EH/s``.  We normalise to TH/s
    so the dashboard can render it next to the existing TH/s metrics.
    """
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    unit_u = (unit or "").strip().upper()
    multipliers = {
        "H/S": 1e-12,
        "KH/S": 1e-9,
        "MH/S": 1e-6,
        "GH/S": 1e-3,
        "TH/S": 1.0,
        "PH/S": 1e3,
        "EH/S": 1e6,
    }
    factor = multipliers.get(unit_u)
    if factor is None:
        # Unknown unit — return None rather than the raw number, which
        # would silently misreport hashrate magnitude (the result is
        # stored in ``hashrate_ths``).  If the gateway ever ships a new
        # unit we'd rather show "unknown" than a wrong number.
        _log.warning("DATUM probe: unknown hashrate unit %r (value=%r)", unit, text)
        return None
    result = value * factor
    return result if math.isfinite(result) else None


async def _probe_umbrel_api(base_url: str) -> DatumProbeResult:
    """Probe ``<base_url>/umbrel-api`` and parse the JSON widget payload."""
    url = f"{base_url}/umbrel-api"
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            resp = await client.get(url)
    except (httpx.RequestError, asyncio.TimeoutError) as e:
        return DatumProbeResult(
            reachable=False,
            status="offline",
            probe="umbrel-api",
            gateway_url=base_url,
            reason=f"http-error: {type(e).__name__}",
            checked_at=time.time(),
        )

    if resp.status_code != 200:
        return DatumProbeResult(
            reachable=False,
            status="offline",
            probe="umbrel-api",
            gateway_url=base_url,
            reason=f"http-{resp.status_code}",
            checked_at=time.time(),
        )

    try:
        body = resp.json()
    except ValueError:
        return DatumProbeResult(
            reachable=False,
            status="offline",
            probe="umbrel-api",
            gateway_url=base_url,
            reason="invalid-json",
            checked_at=time.time(),
        )

    if not isinstance(body, dict) or body.get("type") not in {"three-stats", "four-stats"}:
        return DatumProbeResult(
            reachable=False, status="offline", probe="umbrel-api", gateway_url=base_url,
            reason="invalid-payload", checked_at=time.time(),
        )
    items = body.get("items")
    if not isinstance(items, list):
        items = []
    connections: Optional[int] = None
    hashrate_ths: Optional[float] = None
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("title"), str):
            continue
        title = item["title"].lower()
        text = item.get("text")
        subtext = item.get("subtext")
        if title == "connections":
            try:
                connections = int(text)
                if connections < 0:
                    connections = None
            except (TypeError, ValueError):
                connections = None
        elif title == "hashrate":
            hashrate_ths = _parse_hashrate_ths(text, subtext if isinstance(subtext, str) else "")

    if connections is None and hashrate_ths is None:
        return DatumProbeResult(
            reachable=False, status="offline", probe="umbrel-api", gateway_url=base_url,
            reason="invalid-payload", checked_at=time.time(),
        )

    # Gateway is up if it answered the API at all.  Connections == 0 is
    # still "reachable" — the daemon is alive, no miners hooked up yet.
    # We surface the count so the UI can show it.
    return DatumProbeResult(
        reachable=True,
        status="connected",
        probe="umbrel-api",
        gateway_url=base_url,
        connections=connections,
        hashrate_ths=hashrate_ths,
        checked_at=time.time(),
    )


async def _probe_stratum_tcp(base_url: str, stratum_port: int = DEFAULT_STRATUM_PORT) -> DatumProbeResult:
    """TCP-connect to the stratum port to verify the gateway is listening.

    Uses the hostname from ``base_url`` (or, if no URL is set, the caller
    can pass in a host-only URL like ``tcp://127.0.0.1``).  Does **not**
    speak Stratum — opening the socket is sufficient evidence the gateway
    is accepting connections.
    """
    parsed = urlparse(base_url)
    host = parsed.hostname or "127.0.0.1"

    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(None, _blocking_tcp_check, host, stratum_port),
            timeout=PROBE_TIMEOUT,
        )
    except (asyncio.TimeoutError, OSError) as e:
        return DatumProbeResult(
            reachable=False,
            status="offline",
            probe="stratum-tcp",
            gateway_url=base_url,
            reason=f"tcp-error: {type(e).__name__}",
            checked_at=time.time(),
        )

    return DatumProbeResult(
        reachable=True,
        status="connected",
        probe="stratum-tcp",
        gateway_url=base_url,
        checked_at=time.time(),
    )


def _blocking_tcp_check(host: str, port: int) -> None:
    """Open and close a TCP socket; raises on failure.

    Pulled out as a separate function so we can run it in an executor —
    ``socket.create_connection`` is blocking and we don't want to depend
    on platform asyncio resolver edge cases for this short check.
    """
    with socket.create_connection((host, port), timeout=PROBE_TIMEOUT):
        pass


async def _do_probe() -> DatumProbeResult:
    """Run the configured probe(s) and return the best result.

    Order of operations:
    1. Explicit URL (env or config) — try umbrel-api, then stratum-tcp.
    2. Auto-discovery (only if ``DATUM_GATEWAY_AUTODISCOVER=1``) — try
       each candidate against umbrel-api until one succeeds.
    3. Nothing configured + auto-discovery off → ``unknown`` status.
    """
    base_url = _resolve_gateway_url()

    if base_url:
        # Try the rich JSON probe first.
        result = await _probe_umbrel_api(base_url)
        if result.reachable:
            return result
        # Fall back to a simple TCP connect on the stratum port.  Use the
        # same host the user pointed us at — they may have a build
        # without DATUM_API_FOR_UMBREL but still expose stratum.
        tcp_result = await _probe_stratum_tcp(base_url)
        if tcp_result.reachable:
            return tcp_result
        # Both failed — return the more informative HTTP result.
        return result

    if _autodiscover_enabled():
        for candidate in AUTODISCOVER_CANDIDATES:
            result = await _probe_umbrel_api(candidate)
            if result.reachable:
                return result
        return DatumProbeResult(
            reachable=False,
            status="offline",
            probe="none",
            gateway_url=None,
            reason="autodiscover-failed",
            checked_at=time.time(),
        )

    return DatumProbeResult(
        reachable=False,
        status="unknown",
        probe="none",
        gateway_url=None,
        reason="not-configured",
        checked_at=time.time(),
    )


async def get_datum_status(force: bool = False) -> DatumProbeResult:
    """Return the cached probe result, refreshing if stale or forced.

    Args:
        force: If ``True``, bypass the cache and run a fresh probe.

    Returns:
        :class:`DatumProbeResult` — never raises.
    """
    global _cached_result, _cached_at

    now = time.time()
    if not force and _cached_result is not None and (now - _cached_at) < CACHE_TTL:
        return _cached_result

    # Single-flight: if many requests hit at once during refresh, let
    # exactly one of them do the work.
    async with _probe_lock:
        # Re-check inside the lock — another caller may have refreshed.
        now = time.time()
        if not force and _cached_result is not None and (now - _cached_at) < CACHE_TTL:
            return _cached_result

        while True:
            generation = _cache_generation
            try:
                result = await _do_probe()
            except Exception as e:  # pragma: no cover — last-resort guard
                _log.warning("DATUM probe unexpectedly raised: %s", e)
                result = DatumProbeResult(
                    reachable=False,
                    status="unknown",
                    probe="none",
                    gateway_url=_resolve_gateway_url(),
                    reason=f"probe-exception: {type(e).__name__}",
                    checked_at=time.time(),
                )
            if generation == _cache_generation:
                break
            # Configuration changed while a probe was in flight. Discard
            # its result and probe the new destination before caching.

        _cached_result = result
        _cached_at = result.checked_at
        return result


def clear_cache() -> None:
    """Invalidate the module-level probe cache.

    Public API — call this whenever the gateway URL or any other input
    to ``_do_probe`` changes (e.g. ``/api/config`` updates the URL) so
    the next ``get_datum_status`` call runs a fresh probe instead of
    waiting up to :data:`CACHE_TTL` for the stale result to age out.
    """
    global _cached_result, _cached_at, _cache_generation
    _cached_result = None
    _cached_at = 0.0
    _cache_generation += 1


# Backwards-compatible alias.  Tests imported this name before
# ``clear_cache`` existed; keep it working until external tests catch up.
def _reset_cache_for_tests() -> None:
    """Deprecated alias for :func:`clear_cache` — kept for test backcompat."""
    clear_cache()
