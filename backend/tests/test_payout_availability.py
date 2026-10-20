"""Payout windows and source failures must not turn into misleading totals."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.routers import earnings
from app.services import ocean_client
from app.services.ocean_client import OceanClient, PaymentHistory


EMPTY_TABLE = '<table><tbody id="payouts-tablerows"></tbody></table>'
NOW = datetime(2026, 10, 20, 18, 30, tzinfo=timezone.utc)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


def api_response(payouts):
    return SimpleNamespace(json=lambda: {"result": {"payouts": payouts}})


def api_row(instant, txid="api"):
    return {"ts": instant.isoformat(), "on_chain_txid": txid, "total_satoshis_net_paid": 42}


def html_row(instant, txid="html"):
    return (
        f'<tr><td>{instant:%Y-%m-%d %H:%M}</td>'
        f'<td><a href="/info/tx/lightning/{txid}">{txid}</a></td>'
        '<td>0.00000042 BTC</td></tr>'
    )


@pytest.mark.asyncio
async def test_payout_sources_share_exact_rolling_utc_window(monkeypatch):
    monkeypatch.setattr(ocean_client, "datetime", FrozenDatetime)
    monkeypatch.setattr(ocean_client, "get_timezone", lambda: "Pacific/Honolulu")
    cutoff = NOW - timedelta(days=3)
    points = {
        "future": NOW + timedelta(minutes=1),
        "latest": NOW - timedelta(minutes=1),
        "inside": cutoff + timedelta(minutes=1),
        "boundary": cutoff,
        "outside": cutoff - timedelta(minutes=1),
        "calendar_start": cutoff.replace(hour=0, minute=0),
    }
    client = OceanClient("test-wallet")
    urls = []

    async def fake_get(url, **kwargs):
        urls.append(url)
        if "earnpay" in url:
            return api_response([api_row(instant, f"api-{name}") for name, instant in points.items()])
        if "page=0" in url:
            return SimpleNamespace(text="".join(
                html_row(instant, f"html-{name}") for name, instant in points.items()
            ))
        return SimpleNamespace(text=EMPTY_TABLE)

    monkeypatch.setattr(client, "_get", fake_get)

    result = await client.get_payment_history(days=3)

    assert result.data_status == "fresh"
    assert {row["txid"] or row["lightning_txid"] for row in result} == {
        "api-latest", "api-inside", "api-boundary",
        "html-latest", "html-inside", "html-boundary",
    }
    assert all(cutoff <= datetime.fromisoformat(row["date_iso"]) <= NOW for row in result)
    assert any(url.endswith("/2026-10-16/2026-10-21") for url in urls)


@pytest.mark.asyncio
@pytest.mark.parametrize("api_available,html_available,expected", [
    (True, True, "fresh"),
    (True, False, "partial"),
    (False, True, "partial"),
    (False, False, "unavailable"),
])
async def test_empty_history_retains_source_availability(monkeypatch, api_available, html_available, expected):
    client = OceanClient("test-wallet")

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            return api_response([]) if api_available else None
        return SimpleNamespace(text=EMPTY_TABLE) if html_available else None

    monkeypatch.setattr(client, "_get", fake_get)
    result = await client.get_payment_history(days=30)
    assert result == []
    assert result.data_status == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("malformed_records", [False, True])
async def test_malformed_upstream_responses_are_unavailable(monkeypatch, malformed_records):
    client = OceanClient("test-wallet")

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            if malformed_records:
                return api_response([{"ts": "unknown", "total_satoshis_net_paid": 42}])
            return SimpleNamespace(json=lambda: {"error": "temporarily unavailable"})
        if malformed_records:
            return SimpleNamespace(text=html_row(NOW).replace("2026-10-20 18:30", "unknown"))
        return SimpleNamespace(text="<html><body>Service temporarily unavailable</body></html>")

    monkeypatch.setattr(client, "_get", fake_get)
    result = await client.get_payment_history(days=30)
    assert result == []
    assert result.data_status == "unavailable"


@pytest.mark.asyncio
async def test_partial_scrape_preserves_lightning_and_reports_missing_pages(monkeypatch):
    client = OceanClient("test-wallet")

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            return api_response([])
        if "page=0" in url:
            return SimpleNamespace(text=html_row(datetime.now(timezone.utc) - timedelta(days=1)))
        return None

    monkeypatch.setattr(client, "_get", fake_get)
    result = await client.get_payment_history(days=30)
    assert result.data_status == "partial"
    assert len(result) == 1
    assert result[0]["lightning_txid"] == "html"
    assert result[0]["amount_sats"] == 42


@pytest.mark.asyncio
async def test_invalid_api_record_does_not_discard_other_payments(monkeypatch):
    client = OceanClient("test-wallet")

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            return api_response([
                api_row(datetime.now(timezone.utc) - timedelta(days=1)),
                {"ts": "unknown", "total_satoshis_net_paid": 100},
            ])
        return SimpleNamespace(text=EMPTY_TABLE)

    monkeypatch.setattr(client, "_get", fake_get)
    result = await client.get_payment_history(days=30)
    assert result.data_status == "partial"
    assert len(result) == 1
    assert result[0]["amount_sats"] == 42


@pytest.mark.asyncio
async def test_overflowing_scraped_amount_reports_partial_without_crashing(monkeypatch):
    client = OceanClient("test-wallet")

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            return api_response([])
        row = html_row(datetime.now(timezone.utc) - timedelta(days=1))
        return SimpleNamespace(text=row.replace("0.00000042", "1e308"))

    monkeypatch.setattr(client, "_get", fake_get)
    result = await client.get_payment_history(days=30)
    assert result == []
    assert result.data_status == "partial"


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["api", "html", "merge"])
async def test_capped_payout_history_is_partial(monkeypatch, source):
    monkeypatch.setattr(ocean_client, "MAX_PAYOUT_HISTORY", 2)
    client = OceanClient("test-wallet")
    instant = datetime.now(timezone.utc) - timedelta(days=1)

    async def fake_get(url, **kwargs):
        if "earnpay" in url:
            return api_response(
                [api_row(instant, f"api-{index}") for index in range(3)]
                if source == "api" else []
            )
        if source == "html":
            return SimpleNamespace(text="".join(html_row(instant, f"html-{index}") for index in range(3)))
        return SimpleNamespace(text=EMPTY_TABLE)

    monkeypatch.setattr(client, "_get", fake_get)
    if source == "merge":
        # Neither source is capped, but their combined unique rows are.
        async def fake_api(**kwargs):
            return PaymentHistory([{
                "date": "2026-10-19 18:30", "date_iso": instant.isoformat(),
                "txid": "api-1", "lightning_txid": "", "amount_sats": 42,
            }])

        async def fake_html(**kwargs):
            return PaymentHistory([{
                "date": "2026-10-19 18:30", "date_iso": instant.isoformat(),
                "txid": "", "lightning_txid": f"html-{index}", "amount_sats": 42,
            } for index in range(2)])

        monkeypatch.setattr(client, "_get_payment_history_api", fake_api)
        monkeypatch.setattr(client, "_get_payment_history_scrape", fake_html)

    result = await client.get_payment_history(days=30)
    assert len(result) == 2
    assert result.data_status == "partial"


@pytest.mark.asyncio
@pytest.mark.parametrize("available,complete,expected", [
    (True, True, "fresh"),
    (True, False, "partial"),
    (False, False, "unavailable"),
])
async def test_earnings_endpoint_exposes_availability_and_closes_client(monkeypatch, available, complete, expected):
    closed = []
    row = {
        "date": "2026-10-19 18:30", "date_iso": "2026-10-19T18:30:00+00:00",
        "txid": "api", "amount_sats": 42, "amount_btc": 0.00000042,
    }

    class FakeClient:
        def __init__(self, wallet):
            assert wallet == "test-wallet"

        async def get_payment_history(self, days, btc_price):
            return PaymentHistory([row] if available else [], available=available, complete=complete)

        async def close(self):
            closed.append(True)

    monkeypatch.setattr(earnings, "OceanClient", FakeClient)
    monkeypatch.setattr(earnings, "get_wallet", lambda: "test-wallet")
    monkeypatch.setattr(earnings.background, "get_current_metrics", lambda: {"btc_price": 100000})

    if expected == "unavailable":
        with pytest.raises(earnings.HTTPException) as error:
            await earnings.get_earnings(days=30)
        assert error.value.status_code == 503
        assert "temporarily unavailable" in error.value.detail
    else:
        response = await earnings.get_earnings(days=30)
        assert response.data_status == expected
        assert bool(response.data_error) == (expected == "partial")
        assert response.total_sats == 42
        assert response.total_btc == 0.00000042
        assert response.monthly_summary[0]["sats"] == 42
    assert closed == [True]


@pytest.mark.asyncio
async def test_earnings_without_wallet_reports_unconfigured(monkeypatch):
    monkeypatch.setattr(earnings, "get_wallet", lambda: "")
    response = await earnings.get_earnings(days=30)
    assert response.data_status == "unconfigured"
    assert response.payments == []
