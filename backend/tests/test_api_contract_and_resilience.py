"""Tests for route contracts, error handling, and scraper resilience."""

from types import SimpleNamespace

import httpx
import pytest

from app.routers import blocks, workers
from app.services.ocean_client import OceanClient


@pytest.mark.asyncio
async def test_workers_response_totals_follow_filtered_set(monkeypatch):
    cached = {
        "workers": [
            {"name": "a", "status": "online", "hashrate_3hr": 100.0, "hashrate_60sec": 100.0},
            {"name": "b", "status": "offline", "hashrate_3hr": 0.0, "hashrate_60sec": 0.0},
        ],
        "workers_total": 2,
        "hashrate_unit": "TH/s",
        "timestamp": "2026-03-18T00:00:00Z",
    }

    async def fake_cache_get(_key):
        return cached

    monkeypatch.setattr(workers, "cache_get", fake_cache_get)
    monkeypatch.setattr(workers.background, "get_cache_key", lambda name: f"deepsea:test:{name}")
    monkeypatch.setattr(workers.background, "get_current_metrics", lambda: {"unpaid_earnings": 0.01})

    result = await workers.get_workers(status="online", sort_by="name", descending=False)

    assert result.workers_total == 1
    assert result.workers_online == 1
    assert result.workers_offline == 0
    assert result.total_hashrate == 100.0
    assert [w.name for w in result.workers] == ["a"]


@pytest.mark.asyncio
async def test_blocks_endpoint_returns_502_on_upstream_error(monkeypatch):
    async def boom(_start_height=None):
        raise httpx.ConnectError("upstream down")

    monkeypatch.setattr(blocks, "_fetch_mempool_blocks", boom)

    with pytest.raises(blocks.HTTPException) as exc:
        await blocks.get_blocks(page=0, page_size=20)

    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_ocean_scraper_fallback_selector_parses_rows(monkeypatch):
    html = """
    <html>
      <body>
        <table id="workers">
          <tbody>
            <tr>
              <td>miner-01</td>
              <td>Online</td>
              <td>1 min ago</td>
              <td>123.5 TH/s</td>
              <td>120.0 TH/s</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
    """

    client = OceanClient(wallet="test-wallet")

    async def fake_get(_url, timeout=None, headers=None):
        return SimpleNamespace(text=html)

    monkeypatch.setattr(client, "_get", fake_get)

    result = await client._get_worker_data_scrape()

    assert result is not None
    assert result["workers_total"] == 1
    assert result["workers"][0]["name"] == "miner-01"
    assert result["workers"][0]["status"] == "online"
    assert result["workers"][0]["hashrate_3hr"] == 120.0


def _payouts_html(include_lightning: bool = True) -> str:
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=5)).strftime("%Y-%m-%d %H:%M")
    older = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    lightning_row = f"""
    <tr class="table-row">
      <td class="table-cell">{recent}</td>
      <td class="table-cell"><a href="/info/tx/lightning/ln-abc123">⚡ ln-abc123</a></td>
      <td class="table-cell">0.00150000 BTC</td>
    </tr>
    """
    return f"""
<html><body>
  <table><tbody id="payouts-tablerows">
    {lightning_row if include_lightning else ""}
    <tr class="table-row">
      <td class="table-cell">{older}</td>
      <td class="table-cell"><a href="https://mempool.space/tx/deadbeef">deadbeef</a></td>
      <td class="table-cell">0.00200000 BTC</td>
    </tr>
  </tbody></table>
</body></html>
"""

EMPTY_PAYOUTS_HTML = '<html><body><table><tbody id="payouts-tablerows"></tbody></table></body></html>'


@pytest.mark.asyncio
async def test_payment_history_falls_back_to_scrape_for_lightning_payouts(monkeypatch):
    """earnpay omits Lightning payouts; the stats-page scraper must pick them up."""
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return SimpleNamespace(json=lambda: {"result": {"payouts": []}})
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360, btc_price=100000.0)

    assert len(payments) == 2
    ln, onchain = payments
    assert ln["lightning_txid"] == "ln-abc123"
    assert ln["txid"] == ""
    assert ln["amount_sats"] == 150_000
    assert ln["status"] == "confirmed"
    assert ln["fiat_value"] == pytest.approx(0.0015 * 100000.0)
    assert onchain["txid"] == "deadbeef"
    assert onchain["lightning_txid"] == ""
    assert onchain["amount_sats"] == 200_000


@pytest.mark.asyncio
async def test_payment_history_scrape_respects_days_window(monkeypatch):
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return None
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=1)

    assert payments == []


def _earnpay_response(ts: int) -> SimpleNamespace:
    payload = {
            "result": {
                "payouts": [
                    {
                        "ts": ts,
                        "on_chain_txid": "deadbeef",
                        "total_satoshis_net_paid": 200_000,
                    }
                ]
            }
        }
    return SimpleNamespace(json=lambda: payload)


@pytest.mark.asyncio
async def test_payment_history_merges_lightning_payouts_with_api_results(monkeypatch):
    """A miner with on-chain history in the API and newer Lightning payouts
    only visible on the stats page must see both, without duplicates."""
    import time

    client = OceanClient(wallet="test-wallet")
    seven_days_ago = int(time.time()) - 7 * 86400

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return _earnpay_response(seven_days_ago)
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert payments[0]["lightning_txid"] == "ln-abc123"  # newer, sorted first
    assert payments[1]["txid"] == "deadbeef"
    assert sum(1 for p in payments if p["txid"] == "deadbeef") == 1


@pytest.mark.asyncio
async def test_payment_history_scrape_stops_when_pages_repeat(monkeypatch):
    """API-known rows are deduped from the result, and pagination stops as
    soon as a page yields no unseen rows (here: page 1 repeats page 0)."""
    import time

    client = OceanClient(wallet="test-wallet")
    seven_days_ago = int(time.time()) - 7 * 86400
    pages_fetched = []

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return _earnpay_response(seven_days_ago)
        pages_fetched.append(url)
        return SimpleNamespace(text=_payouts_html(include_lightning=False))

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 1
    assert payments[0]["txid"] == "deadbeef"
    assert len(pages_fetched) == 2  # page 1 has no unseen rows -> stop


@pytest.mark.asyncio
async def test_payment_history_finds_lightning_era_behind_onchain_page(monkeypatch):
    """A miner who switched from Lightning to on-chain payouts: page 0 is
    entirely API-known on-chain rows, but pagination must continue and pick
    up the older Lightning payouts on page 1."""
    import time
    from datetime import datetime, timedelta, timezone

    client = OceanClient(wallet="test-wallet")
    seven_days_ago = int(time.time()) - 7 * 86400
    old_ln_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d %H:%M")
    page1_html = f"""
<html><body>
  <table><tbody id="payouts-tablerows">
    <tr class="table-row">
      <td class="table-cell">{old_ln_date}</td>
      <td class="table-cell"><a href="/info/tx/lightning/ln-old456">⚡ ln-old456</a></td>
      <td class="table-cell">0.00050000 BTC</td>
    </tr>
  </tbody></table>
</body></html>
"""

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return _earnpay_response(seven_days_ago)
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html(include_lightning=False))
        if "page=1" in url:
            return SimpleNamespace(text=page1_html)
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert payments[0]["txid"] == "deadbeef"  # newer on-chain from API
    assert payments[1]["lightning_txid"] == "ln-old456"


@pytest.mark.asyncio
async def test_payment_history_survives_invalid_configured_timezone(monkeypatch):
    """A bad timezone in config.json must degrade dates to UTC, not 500."""
    from app.services import ocean_client as oc

    monkeypatch.setattr(oc, "get_timezone", lambda: "Not/AZone")
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return SimpleNamespace(json=lambda: {"result": {"payouts": []}})
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert payments[0]["lightning_txid"] == "ln-abc123"
    assert payments[0]["date_iso"] is not None


@pytest.mark.asyncio
async def test_payment_history_keeps_distinct_lightning_payment_with_same_time_and_amount(monkeypatch):
    """Date and value alone are not a transaction identity."""
    import time

    client = OceanClient(wallet="test-wallet")
    seven_days_ago = int(time.time()) - 7 * 86400
    html = _payouts_html(include_lightning=False).replace(
        "https://mempool.space/tx/deadbeef", "/info/tx/lightning/distinct-ln"
    )

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return _earnpay_response(seven_days_ago)
        return SimpleNamespace(text=html if "page=0" in url else EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert {p["txid"] or p["lightning_txid"] for p in payments} == {"deadbeef", "distinct-ln"}


@pytest.mark.asyncio
async def test_payment_history_deduplicates_lightning_ids_from_api(monkeypatch):
    import time

    client = OceanClient(wallet="test-wallet")
    response = _earnpay_response(int(time.time()) - 5 * 86400)
    payout = response.json()["result"]["payouts"][0]
    payout.update(on_chain_txid=None, lightning_txid="ln-abc123", total_satoshis_net_paid=150_000)

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return response
        return SimpleNamespace(text=_payouts_html() if "page=0" in url else EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert sum(p["lightning_txid"] == "ln-abc123" for p in payments) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("with_api_history", [False, True])
async def test_payment_history_timeout_preserves_completed_pages(monkeypatch, with_api_history):
    """An unresponsive later page cannot discard already collected payouts."""
    import asyncio
    import time

    from app.services import ocean_client as oc

    monkeypatch.setattr(oc, "PAYOUT_SCRAPE_BUDGET_SECONDS", 0.03)
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return _earnpay_response(int(time.time()) - 7 * 86400) if with_api_history else None
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        await asyncio.sleep(1)
        raise AssertionError("scrape budget should cancel this request")

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await asyncio.wait_for(client.get_payment_history(days=360), timeout=0.5)

    assert len(payments) == 2
    assert payments[0]["lightning_txid"] == "ln-abc123"


@pytest.mark.asyncio
async def test_payment_history_orders_by_instant_across_daylight_saving_fallback(monkeypatch):
    client = OceanClient(wallet="test-wallet")
    older = {"date": "2025-11-02 01:45", "date_iso": "2025-11-02T01:45:00-07:00",
             "txid": "onchain", "lightning_txid": "", "amount_sats": 1}
    newer = {"date": "2025-11-02 01:15", "date_iso": "2025-11-02T01:15:00-08:00",
             "txid": "", "lightning_txid": "ln", "amount_sats": 2}

    async def fake_api(**kwargs):
        return [older]

    async def fake_scrape(**kwargs):
        return [newer]

    monkeypatch.setattr(client, "_get_payment_history_api", fake_api)
    monkeypatch.setattr(client, "_get_payment_history_scrape", fake_scrape)

    assert await client.get_payment_history(days=360) == [newer, older]


@pytest.mark.asyncio
async def test_payment_history_parses_pagination_row_fragments(monkeypatch):
    """Ocean's widget endpoint returns rows without a surrounding table."""
    from datetime import datetime, timedelta, timezone

    client = OceanClient(wallet="test-wallet")
    recent = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
    urls = []

    async def fake_get(url, timeout=None, headers=None):
        urls.append(url)
        if "page=0" in url:
            return SimpleNamespace(text=f"""
              <tr class="table-row">
                <td class="table-cell date-text"><div class="date-text">{recent}</div></td>
                <td class="table-cell"><a href="/info/tx/lightning/ln-fragment">⚡ ln-fragment</a></td>
                <td class="table-cell">0.00000003 BTC</td>
              </tr>
            """)
        return SimpleNamespace(text="")

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client._get_payment_history_scrape(days=2)

    assert len(payments) == 1
    assert payments[0]["lightning_txid"] == "ln-fragment"
    assert payments[0]["amount_sats"] == 3
    assert urls[0].endswith("/template/workers/payouts/rows?user=test-wallet&page=0")
    assert urls[1].endswith("&page=1")


@pytest.mark.asyncio
async def test_payment_history_treats_naive_api_timestamp_as_utc(monkeypatch):
    import os
    import time

    from app.services import ocean_client as oc

    monkeypatch.setattr(oc, "get_timezone", lambda: "America/Los_Angeles")
    client = OceanClient(wallet="test-wallet")
    response = _earnpay_response("2026-10-19T21:31:47")

    async def fake_get(url, timeout=None, headers=None):
        return response

    monkeypatch.setattr(client, "_get", fake_get)

    if not hasattr(time, "tzset"):
        pytest.skip("requires process timezone support")
    previous_tz = os.environ.get("TZ")
    monkeypatch.setenv("TZ", "Pacific/Honolulu")
    time.tzset()
    try:
        payments = await client._get_payment_history_api(days=365)
    finally:
        if previous_tz is None:
            monkeypatch.delenv("TZ")
        else:
            monkeypatch.setenv("TZ", previous_tz)
        time.tzset()

    assert payments[0]["date_iso"] == "2026-10-19T14:31:47-07:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_value", ["NaN", "inf", "-0.1"])
async def test_payment_history_skips_invalid_scraped_amounts(monkeypatch, invalid_value):
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        return SimpleNamespace(text=_payouts_html(include_lightning=False).replace("0.00200000", invalid_value))

    monkeypatch.setattr(client, "_get", fake_get)

    assert await client._get_payment_history_scrape(days=360) == []


@pytest.mark.asyncio
async def test_payment_history_skips_scraped_dates_outside_known_window(monkeypatch):
    from datetime import datetime, timedelta, timezone

    client = OceanClient(wallet="test-wallet")
    html = _payouts_html(include_lightning=False)
    date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    html = html.replace(date, "Unknown date")

    async def fake_get(url, timeout=None, headers=None):
        return SimpleNamespace(text=html)

    monkeypatch.setattr(client, "_get", fake_get)

    assert await client._get_payment_history_scrape(days=360) == []


@pytest.mark.asyncio
async def test_payment_history_can_reach_500_payouts_at_five_rows_per_page(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from urllib.parse import parse_qs, urlsplit

    client = OceanClient(wallet="test-wallet")
    now = datetime.now(timezone.utc)
    pages = []

    async def fake_get(url, timeout=None, headers=None):
        page = int(parse_qs(urlsplit(url).query)["page"][0])
        pages.append(page)
        rows = []
        for offset in range(5):
            index = page * 5 + offset
            date = (now - timedelta(minutes=index + 1)).strftime("%Y-%m-%d %H:%M")
            rows.append(f"""
                <tr><td>{date}</td><td><a href="/info/tx/lightning/ln-{index}">payment</a></td>
                <td>0.00000001 BTC</td></tr>
            """)
        return SimpleNamespace(text="".join(rows))

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client._get_payment_history_scrape(days=1)

    assert len(payments) == 500
    assert payments[-1]["lightning_txid"] == "ln-499"
    assert pages == list(range(100))


@pytest.mark.asyncio
async def test_payment_history_returns_scraped_rows_when_api_hangs(monkeypatch):
    import asyncio

    from app.services import ocean_client as oc

    monkeypatch.setattr(oc, "PAYOUT_API_BUDGET_SECONDS", 0.03)
    client = OceanClient(wallet="test-wallet")
    api_cancelled = asyncio.Event()

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            try:
                await asyncio.sleep(1)
            finally:
                api_cancelled.set()
        return SimpleNamespace(text=_payouts_html() if "page=0" in url else EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await asyncio.wait_for(client.get_payment_history(days=360), timeout=0.3)

    assert api_cancelled.is_set()
    assert len(payments) == 2
    assert payments[0]["lightning_txid"] == "ln-abc123"


@pytest.mark.asyncio
async def test_payment_history_source_budgets_run_concurrently(monkeypatch):
    """A near-deadline API response must not postpone the scrape deadline."""
    import asyncio
    import time

    from app.services import ocean_client as oc

    monkeypatch.setattr(oc, "PAYOUT_API_BUDGET_SECONDS", 0.2)
    monkeypatch.setattr(oc, "PAYOUT_SCRAPE_BUDGET_SECONDS", 0.2)
    client = OceanClient(wallet="test-wallet")

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            await asyncio.sleep(0.15)
            return _earnpay_response(int(time.time()) - 7 * 86400)
        if "page=0" in url:
            return SimpleNamespace(text=_payouts_html())
        await asyncio.sleep(1)
        raise AssertionError("the scrape deadline should cancel later pages")

    monkeypatch.setattr(client, "_get", fake_get)

    # Sequential source budgets would take at least 0.35 seconds here.
    payments = await asyncio.wait_for(client.get_payment_history(days=360), timeout=0.3)

    assert len(payments) == 2
    assert payments[0]["lightning_txid"] == "ln-abc123"
    assert payments[1]["txid"] == "deadbeef"


@pytest.mark.asyncio
@pytest.mark.parametrize("lightning", [False, True])
async def test_payment_history_prefers_api_record_for_cross_source_transaction(monkeypatch, lightning):
    import time

    client = OceanClient(wallet="test-wallet")
    response = _earnpay_response(int(time.time()) - 5 * 86400)
    payout = response.json()["result"]["payouts"][0]
    payout["total_satoshis_net_paid"] = 123_456
    identifier = "deadbeef"
    if lightning:
        identifier = "ln-abc123"
        payout.update(on_chain_txid="", lightning_txid=identifier)

    async def fake_get(url, timeout=None, headers=None):
        if "earnpay" in url:
            return response
        return SimpleNamespace(text=_payouts_html() if "page=0" in url else EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)
    matching = [p for p in payments if (p["lightning_txid"] if lightning else p["txid"]) == identifier]

    assert len(payments) == 2
    assert len(matching) == 1
    assert matching[0]["amount_sats"] == 123_456
