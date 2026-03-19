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
