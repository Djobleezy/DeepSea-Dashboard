"""Regression checks based on the public Ocean worker formats seen in live testing."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest

from app.services import ocean_client
from app.services.ocean_client import OceanClient


def json_response(payload):
    return SimpleNamespace(json=lambda: payload)


@pytest.mark.asyncio
async def test_native_worker_arrays_keep_all_25_workers_and_full_precision(monkeypatch):
    records = {
        f"miner-{i:02}": [{"hashrate_10800s": str((100 + i) * 10**12 + 123), "hashrate_60s": "1000000000000"}]
        for i in range(25)
    }
    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response({"result": {"workers": records}})))
    fallback = AsyncMock(return_value=None)
    monkeypatch.setattr(client, "_get_worker_data_scrape", fallback)

    result = await client.get_worker_data()

    assert result["workers_total"] == 25
    assert result["workers_online"] == 25
    assert result["total_hashrate"] == pytest.approx(sum((100 + i) + .000000000123 for i in range(25)))
    assert {worker["name"] for worker in result["workers"]} == set(records)
    fallback.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("as_list", [False, True])
async def test_legacy_worker_shapes_remain_supported(monkeypatch, as_list):
    first = {"name": "miner-a", "hashrate_10800": 2e12, "hashrate_60s": 1e12}
    second = {"workername": "miner-b", "hashrate_7200": 3e12, "hashrate_60s": 0}
    workers = [first, second] if as_list else {"miner-a": first, "miner-b": second, "total": 999}
    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response({"workers": workers})))

    result = await client._get_worker_data_api()

    assert result["total_hashrate"] == 5
    assert result["workers_total"] == 2


@pytest.mark.asyncio
async def test_worker_zero_three_hour_interval_does_not_use_shorter_window(monkeypatch):
    client = OceanClient("test-wallet")
    payload = {"result": {"workers": {"miner-a": [{
        "hashrate_10800s": 0, "hashrate_10800": 5e12, "hashrate_3600s": 4e12,
        "hashrate_300s": 3e12, "hashrate_60s": 0,
    }]}}}
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response(payload)))

    result = await client._get_worker_data_api()

    assert result["workers"][0]["hashrate_3hr"] == 0
    assert result["workers"][0]["status"] == "offline"


@pytest.mark.asyncio
async def test_user_zero_three_hour_interval_does_not_use_older_window(monkeypatch):
    client = OceanClient("test-wallet")
    payload = {"result": {"hashrate_10800s": 0, "hashrate_7200s": 5e12, "hashrate_3600s": 4e12}}
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response(payload)))
    assert (await client.get_user_hashrate())["hashrate_3hr"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [[], [{}, {}], {"hashrate_10800s": "bad"}, {"hashrate_10800s": float("nan")}])
async def test_malformed_named_worker_invalidates_whole_snapshot(monkeypatch, invalid):
    client = OceanClient("test-wallet")
    payload = {"result": {"workers": {
        "valid-miner": [{"hashrate_10800s": 2e12}], "invalid-miner": invalid,
    }}}
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response(payload)))
    assert await client._get_worker_data_api() is None


def worker_row(name, rate=100, status="Online"):
    return (f'<tr class="table-row"><td>{name}</td><td>{status}</td><td>1 min ago</td>'
            f'<td>{rate} TH/s</td><td>{rate} TH/s</td></tr>')


def worker_page(rows, total=None, next_page=None, extra_links=""):
    counts = f'<div id="workers-page-counts">Showing results of {total} results</div>' if total is not None else ""
    next_link = f'<a href="/stats/test-wallet?wpage={next_page}&amp;nav=t#workers-fulltable">Next</a>' if next_page is not None else ""
    return (f'<div id="workers-fulltable"><table><tbody id="workers-tablerows">{rows}</tbody></table>'
            f'<div id="workers-footer">{counts}{next_link}{extra_links}</div></div>')


@pytest.mark.asyncio
async def test_html_fallback_reads_every_page_and_includes_inactive_workers(monkeypatch):
    pages = [
        worker_page(worker_row("Total", 2500) + ''.join(worker_row(f"miner-{i}") for i in range(14)), 26, 1),
        worker_page(''.join(worker_row(f"miner-{i}", 0 if i == 24 else 100, "Offline" if i == 24 else "Online") for i in range(14, 25)), 26),
    ]
    urls = []

    async def get(url, **_kwargs):
        urls.append(url)
        query = parse_qs(urlsplit(url).query)
        assert query["wactive"] == ["off"]
        return SimpleNamespace(text=pages[int(query["wpage"][0])])

    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", get)
    result = await client._get_worker_data_scrape()

    assert result["workers_total"] == 25
    assert result["workers_online"] == 24
    assert result["workers_offline"] == 1
    assert result["total_hashrate"] == 2400
    assert len(urls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("second", [None, "<html>Error</html>", worker_page(worker_row("miner-a"), 3)])
async def test_failed_or_repeated_page_never_returns_partial_fleet(monkeypatch, second):
    pages = [worker_page(worker_row("miner-a"), 3, 1), second]

    async def get(url, **_kwargs):
        page = int(parse_qs(urlsplit(url).query)["wpage"][0])
        return None if pages[page] is None else SimpleNamespace(text=pages[page])

    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", get)
    assert await client._get_worker_data_scrape() is None


@pytest.mark.asyncio
async def test_advertised_total_without_next_page_is_incomplete(monkeypatch):
    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=SimpleNamespace(
        text=worker_page(worker_row("miner-a"), total=25)
    )))
    assert await client._get_worker_data_scrape() is None


@pytest.mark.asyncio
async def test_html_pagination_has_a_hard_page_bound(monkeypatch):
    monkeypatch.setattr(ocean_client, "MAX_WORKER_PAGES", 2)
    client = OceanClient("test-wallet")

    async def get(url, **_kwargs):
        page = int(parse_qs(urlsplit(url).query)["wpage"][0])
        return SimpleNamespace(text=worker_page(worker_row(f"miner-{page}"), next_page=page + 1))

    monkeypatch.setattr(client, "_get", get)
    assert await client._get_worker_data_scrape() is None


@pytest.mark.asyncio
async def test_html_pagination_has_a_total_time_bound(monkeypatch):
    monkeypatch.setattr(ocean_client, "WORKER_SCRAPE_BUDGET_SECONDS", .01)
    client = OceanClient("test-wallet")

    async def get(_url, **_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(client, "_get", get)
    assert await client._get_worker_data_scrape() is None


@pytest.mark.asyncio
async def test_pagination_does_not_follow_off_origin_or_other_wallet_links(monkeypatch):
    links = ('<a href="https://elsewhere.example/stats/test-wallet?wpage=1">Elsewhere</a>'
             '<a href="/stats/other-wallet?wpage=1">Other wallet</a>'
             '<a href="http://[broken?wpage=1">Malformed URL</a>')
    client = OceanClient("test-wallet")
    get = AsyncMock(return_value=SimpleNamespace(text=worker_page(worker_row("miner-a"), 1, extra_links=links)))
    monkeypatch.setattr(client, "_get", get)
    result = await client._get_worker_data_scrape()
    assert result["workers_total"] == 1
    get.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["total", "online", "offline", "status", "worker"])
@pytest.mark.parametrize("wrapped", [False, True])
async def test_reserved_labels_with_worker_fields_are_real_api_workers(monkeypatch, name, wrapped):
    record = {"hashrate_10800s": 2e12, "hashrate_60s": 1e12}
    client = OceanClient("test-wallet")
    payload = {"workers": {name: [record] if wrapped else record, "miner-a": {"hashrate_10800s": 1e12}}}
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=json_response(payload)))

    result = await client._get_worker_data_api()

    assert result["workers_total"] == 2
    assert result["total_hashrate"] == 3
    assert {worker["name"] for worker in result["workers"]} == {name, "miner-a"}


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["total", "online", "offline", "status", "worker"])
async def test_worker_link_preserves_reserved_html_name_but_skips_total_summary(monkeypatch, name):
    summary = worker_row('<a href="/stats/test-wallet">Total</a>', 2)
    actual = worker_row(f'<a href="/stats/test-wallet.{name}">{name}</a>', 2)
    client = OceanClient("test-wallet")
    monkeypatch.setattr(client, "_get", AsyncMock(return_value=SimpleNamespace(
        text=worker_page(summary + actual, total=2)
    )))

    result = await client._get_worker_data_scrape()

    assert result["workers_total"] == 1
    assert result["total_hashrate"] == 2
    assert result["workers"][0]["name"] == name
