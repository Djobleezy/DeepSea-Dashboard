"""Tests for the DATUM gateway probe + /api/datum/status endpoint.

These cover the bug the feature was built for: pool_fees_percentage lags
real DATUM activation, so a freshly-enabled gateway used to show
"DATUM OFFLINE" until Ocean's stats caught up.  The probe + state
machine should now surface a "transitioning" state instead.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app import background
from app.main import app
from app.services import datum_gateway_client as dgc


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def reset_probe_cache():
    """Always start each test with a clean probe cache."""
    dgc._reset_cache_for_tests()
    yield
    dgc._reset_cache_for_tests()


# ---------------------------------------------------------------------------
# _parse_hashrate_ths
# ---------------------------------------------------------------------------

def test_parse_hashrate_ths_converts_known_units():
    assert dgc._parse_hashrate_ths("1.50", "TH/s") == pytest.approx(1.5)
    assert dgc._parse_hashrate_ths("500", "GH/s") == pytest.approx(0.5)
    assert dgc._parse_hashrate_ths("2.0", "PH/s") == pytest.approx(2000.0)
    assert dgc._parse_hashrate_ths("1000", "MH/s") == pytest.approx(0.001)


def test_parse_hashrate_ths_handles_bad_input():
    assert dgc._parse_hashrate_ths("not-a-number", "TH/s") is None
    assert dgc._parse_hashrate_ths(None, "TH/s") is None  # type: ignore[arg-type]


def test_parse_hashrate_ths_returns_raw_for_unknown_unit():
    # We surface the raw number rather than silently dropping it; the
    # caller can still inspect the original unit if it really cares.
    assert dgc._parse_hashrate_ths("42", "WIDGETS/s") == 42.0


# ---------------------------------------------------------------------------
# umbrel-api probe
# ---------------------------------------------------------------------------

class _FakeAsyncClient:
    """Minimal httpx.AsyncClient stand-in for parametrised probe tests."""

    def __init__(self, response=None, exc=None):
        self._response = response
        self._exc = exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, _url):
        if self._exc is not None:
            raise self._exc
        return self._response


def _resp(status=200, json_body=None):
    """Build a minimal httpx-like response for the probe to consume."""
    r = SimpleNamespace()
    r.status_code = status
    r.json = lambda: json_body if json_body is not None else {}
    return r


@pytest.mark.asyncio
async def test_probe_umbrel_api_happy_path(monkeypatch):
    """Reachable gateway with connections + hashrate is parsed correctly."""
    body = {
        "type": "three-stats",
        "items": [
            {"title": "Connections", "text": "3", "subtext": "Worker"},
            {"title": "Hashrate", "text": "1.25", "subtext": "PH/s"},
        ],
    }
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _FakeAsyncClient(response=_resp(200, body)))

    result = await dgc._probe_umbrel_api("http://datum_datum_1:21000")

    assert result.reachable is True
    assert result.status == "connected"
    assert result.probe == "umbrel-api"
    assert result.connections == 3
    # 1.25 PH/s == 1250 TH/s
    assert result.hashrate_ths == pytest.approx(1250.0)
    assert result.reason is None


@pytest.mark.asyncio
async def test_probe_umbrel_api_reachable_with_zero_workers(monkeypatch):
    """Gateway up but no miners attached \u2014 still 'connected' (daemon alive)."""
    body = {
        "items": [
            {"title": "Connections", "text": "0", "subtext": "Worker"},
            {"title": "Hashrate", "text": "0.00", "subtext": "TH/s"},
        ],
    }
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _FakeAsyncClient(response=_resp(200, body)))

    result = await dgc._probe_umbrel_api("http://127.0.0.1:21000")
    assert result.reachable is True
    assert result.connections == 0
    assert result.hashrate_ths == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_probe_umbrel_api_http_error(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _FakeAsyncClient(response=_resp(503)))
    result = await dgc._probe_umbrel_api("http://127.0.0.1:21000")
    assert result.reachable is False
    assert "http-503" in (result.reason or "")


@pytest.mark.asyncio
async def test_probe_umbrel_api_connect_error(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout=None: _FakeAsyncClient(exc=httpx.ConnectError("nope")),
    )
    result = await dgc._probe_umbrel_api("http://127.0.0.1:21000")
    assert result.reachable is False
    assert result.reason and result.reason.startswith("http-error")


@pytest.mark.asyncio
async def test_probe_umbrel_api_invalid_json(monkeypatch):
    bad_resp = SimpleNamespace()
    bad_resp.status_code = 200

    def _raise_json():
        raise ValueError("nope")

    bad_resp.json = _raise_json
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _FakeAsyncClient(response=bad_resp))
    result = await dgc._probe_umbrel_api("http://127.0.0.1:21000")
    assert result.reachable is False
    assert result.reason == "invalid-json"


# ---------------------------------------------------------------------------
# stratum-tcp probe
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_probe_stratum_tcp_success(monkeypatch):
    """A successful TCP connect makes the gateway 'reachable' via stratum."""
    def fake_check(host, port):
        assert host == "127.0.0.1"
        assert port == dgc.DEFAULT_STRATUM_PORT
        return None

    monkeypatch.setattr(dgc, "_blocking_tcp_check", fake_check)
    result = await dgc._probe_stratum_tcp("http://127.0.0.1:21000")
    assert result.reachable is True
    assert result.probe == "stratum-tcp"


@pytest.mark.asyncio
async def test_probe_stratum_tcp_refused(monkeypatch):
    def fake_check(host, port):
        raise ConnectionRefusedError("nope")

    monkeypatch.setattr(dgc, "_blocking_tcp_check", fake_check)
    result = await dgc._probe_stratum_tcp("http://127.0.0.1:21000")
    assert result.reachable is False
    assert result.reason and "ConnectionRefusedError" in result.reason


# ---------------------------------------------------------------------------
# get_datum_status cache + dispatch
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_datum_status_no_config_returns_unknown(monkeypatch):
    """Nothing configured + autodiscover off \u2014 status is 'unknown'."""
    monkeypatch.delenv("DATUM_GATEWAY_URL", raising=False)
    monkeypatch.delenv("DATUM_GATEWAY_AUTODISCOVER", raising=False)
    monkeypatch.setattr(dgc, "load_config", lambda: {"datum_gateway_url": ""})

    result = await dgc.get_datum_status(force=True)
    assert result.reachable is False
    assert result.status == "unknown"
    assert result.probe == "none"
    assert result.reason == "not-configured"


@pytest.mark.asyncio
async def test_get_datum_status_uses_env_override(monkeypatch):
    """Env var beats config file."""
    monkeypatch.setenv("DATUM_GATEWAY_URL", "http://gateway.local:7152")
    monkeypatch.setattr(dgc, "load_config", lambda: {"datum_gateway_url": "http://other:1234"})

    body = {"items": [{"title": "Connections", "text": "1"}, {"title": "Hashrate", "text": "1", "subtext": "TH/s"}]}
    seen_urls = []

    class _Capturing(_FakeAsyncClient):
        async def get(self, url):
            seen_urls.append(url)
            return _resp(200, body)

    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _Capturing(response=_resp(200, body)))

    result = await dgc.get_datum_status(force=True)
    assert result.reachable is True
    assert result.gateway_url == "http://gateway.local:7152"
    assert seen_urls == ["http://gateway.local:7152/umbrel-api"]


@pytest.mark.asyncio
async def test_get_datum_status_falls_back_to_tcp(monkeypatch):
    """If umbrel-api fails (e.g. vanilla build), TCP-connect on stratum is tried."""
    monkeypatch.setenv("DATUM_GATEWAY_URL", "http://127.0.0.1:7152")

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout=None: _FakeAsyncClient(exc=httpx.ConnectError("api closed")),
    )

    def fake_tcp(host, port):
        return None  # success

    monkeypatch.setattr(dgc, "_blocking_tcp_check", fake_tcp)

    result = await dgc.get_datum_status(force=True)
    assert result.reachable is True
    assert result.probe == "stratum-tcp"


@pytest.mark.asyncio
async def test_get_datum_status_caches_results(monkeypatch):
    """Repeat calls within CACHE_TTL must not re-probe."""
    monkeypatch.setenv("DATUM_GATEWAY_URL", "http://127.0.0.1:21000")

    call_count = {"n": 0}
    body = {"items": [{"title": "Connections", "text": "1"}, {"title": "Hashrate", "text": "1", "subtext": "TH/s"}]}

    class _Counting(_FakeAsyncClient):
        async def get(self, url):
            call_count["n"] += 1
            return _resp(200, body)

    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: _Counting(response=_resp(200, body)))

    first = await dgc.get_datum_status(force=True)
    second = await dgc.get_datum_status()  # no force \u2014 should hit cache
    third = await dgc.get_datum_status()

    assert call_count["n"] == 1, "second/third calls should be cached"
    assert first.checked_at == second.checked_at == third.checked_at


# ---------------------------------------------------------------------------
# /api/datum/status endpoint \u2014 the full state machine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_endpoint_connected_when_probe_and_fees_agree(client, monkeypatch):
    """Steady-state happy path \u2014 probe up AND fees in band."""
    monkeypatch.setattr(
        "app.routers.datum.get_datum_status",
        _async_returning(dgc.DatumProbeResult(
            reachable=True,
            status="connected",
            probe="umbrel-api",
            gateway_url="http://127.0.0.1:21000",
            connections=2,
            hashrate_ths=120.0,
            checked_at=1.0,
        )),
    )
    monkeypatch.setattr(background, "get_current_metrics", lambda: {"pool_fees_percentage": 1.05})

    resp = await client.get("/api/datum/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "connected"
    assert data["probe_reachable"] is True
    assert data["fees_in_datum_band"] is True
    assert data["connections"] == 2


@pytest.mark.asyncio
async def test_endpoint_transitioning_when_probe_up_but_fees_lag(client, monkeypatch):
    """The headline bug: DATUM just enabled, fees haven't caught up."""
    monkeypatch.setattr(
        "app.routers.datum.get_datum_status",
        _async_returning(dgc.DatumProbeResult(
            reachable=True,
            status="connected",
            probe="umbrel-api",
            gateway_url="http://127.0.0.1:21000",
            connections=1,
            hashrate_ths=2.0,
            checked_at=2.0,
        )),
    )
    # Fee % well below the 0.9% threshold \u2014 mimics a brand-new DATUM user.
    monkeypatch.setattr(background, "get_current_metrics", lambda: {"pool_fees_percentage": 0.05})

    resp = await client.get("/api/datum/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "transitioning"
    assert data["probe_reachable"] is True
    assert data["fees_in_datum_band"] is False
    # The user-facing explanation should call out the lagging-fee root cause.
    assert "hours" in data["explanation"].lower() or "fees" in data["explanation"].lower()


@pytest.mark.asyncio
async def test_endpoint_transitioning_when_fees_in_band_but_probe_down(client, monkeypatch):
    """Inverse case: fees still look DATUM-shaped but probe is failing."""
    monkeypatch.setattr(
        "app.routers.datum.get_datum_status",
        _async_returning(dgc.DatumProbeResult(
            reachable=False,
            status="offline",
            probe="umbrel-api",
            gateway_url="http://127.0.0.1:21000",
            reason="http-error: ConnectError",
            checked_at=3.0,
        )),
    )
    monkeypatch.setattr(background, "get_current_metrics", lambda: {"pool_fees_percentage": 1.0})

    resp = await client.get("/api/datum/status")
    data = resp.json()
    assert data["status"] == "transitioning"
    assert data["probe_reachable"] is False


@pytest.mark.asyncio
async def test_endpoint_offline_when_both_signals_negative(client, monkeypatch):
    monkeypatch.setattr(
        "app.routers.datum.get_datum_status",
        _async_returning(dgc.DatumProbeResult(
            reachable=False,
            status="offline",
            probe="umbrel-api",
            gateway_url="http://127.0.0.1:21000",
            reason="http-error: ConnectError",
            checked_at=4.0,
        )),
    )
    monkeypatch.setattr(background, "get_current_metrics", lambda: {"pool_fees_percentage": 2.0})

    resp = await client.get("/api/datum/status")
    data = resp.json()
    assert data["status"] == "offline"


@pytest.mark.asyncio
async def test_endpoint_unknown_when_no_probe_and_no_fees(client, monkeypatch):
    """No probe configured, no fee data yet \u2014 'unknown' rather than a false claim."""
    monkeypatch.setattr(
        "app.routers.datum.get_datum_status",
        _async_returning(dgc.DatumProbeResult(
            reachable=False,
            status="unknown",
            probe="none",
            gateway_url=None,
            reason="not-configured",
            checked_at=5.0,
        )),
    )
    monkeypatch.setattr(background, "get_current_metrics", lambda: {"pool_fees_percentage": 0.0})

    resp = await client.get("/api/datum/status")
    data = resp.json()
    assert data["status"] == "unknown"


@pytest.mark.asyncio
async def test_health_endpoint_reports_datum_configured_flag(client, monkeypatch):
    """The Dashboard reads /health to decide whether to poll /datum/status."""
    monkeypatch.setattr("app.routers.health.get_datum_gateway_url", lambda: "http://127.0.0.1:21000")
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["datum_gateway_configured"] is True


@pytest.mark.asyncio
async def test_health_endpoint_reports_no_datum_when_unset(client, monkeypatch):
    monkeypatch.setattr("app.routers.health.get_datum_gateway_url", lambda: "")
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["datum_gateway_configured"] is False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _async_returning(value):
    """Build an async function that returns ``value`` regardless of args."""
    async def _f(*_a, **_kw):
        return value
    return _f
