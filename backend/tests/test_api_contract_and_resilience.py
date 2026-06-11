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


def _payouts_html() -> str:
    from datetime import datetime, timedelta, timezone

    recent = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d %H:%M")
    older = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    return f"""
<html><body>
  <table><tbody id="payouts-tablerows">
    <tr class="table-row">
      <td class="table-cell">{recent}</td>
      <td class="table-cell"><a href="/info/tx/lightning/ln-abc123">⚡ ln-abc123</a></td>
      <td class="table-cell">0.00150000 BTC</td>
    </tr>
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


@pytest.mark.asyncio
async def test_payment_history_prefers_api_when_it_has_payouts(monkeypatch):
    client = OceanClient(wallet="test-wallet")
    scrape_called = False

    async def fake_get(url, timeout=None, headers=None):
        nonlocal scrape_called
        if "earnpay" in url:
            return SimpleNamespace(
                json=lambda: {
                    "result": {
                        "payouts": [
                            {
                                "ts": 1764547200,
                                "on_chain_txid": "abcd",
                                "total_satoshis_net_paid": 100,
                            }
                        ]
                    }
                }
            )
        scrape_called = True
        return SimpleNamespace(text=EMPTY_PAYOUTS_HTML)

    monkeypatch.setattr(client, "_get", fake_get)

    payments = await client.get_payment_history(days=360)

    assert len(payments) == 1
    assert payments[0]["txid"] == "abcd"
    assert payments[0]["amount_sats"] == 100
    assert scrape_called is False
