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

    recent = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d %H:%M")
    older = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
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
        if "ppage=0" in url:
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
        if "ppage=0" in url:
            return SimpleNamespace(text=_payouts_html())
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=1)

    assert payments == []


def _earnpay_response(ts: int) -> SimpleNamespace:
    return SimpleNamespace(
        json=lambda: {
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
    )


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
        if "ppage=0" in url:
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
        if "ppage=0" in url:
            return SimpleNamespace(text=_payouts_html(include_lightning=False))
        if "ppage=1" in url:
            return SimpleNamespace(text=page1_html)
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 2
    assert payments[0]["txid"] == "deadbeef"  # newer on-chain from API
    assert payments[1]["lightning_txid"] == "ln-old456"
