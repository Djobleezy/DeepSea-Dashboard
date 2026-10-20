"""Ocean.xyz API + scraper client.

This module provides an async HTTP client for fetching mining data from Ocean.xyz.
It uses a **dual-source strategy**:

1. **Ocean REST API** (``https://api.ocean.xyz/v1/``): the primary data source for
   hashrates, pool stats, payment history, and worker data.  All endpoints are JSON
   and require only a Bitcoin wallet address — no authentication.

2. **HTML scraper** (``https://ocean.xyz/stats/<wallet>``): a fallback used when the
   API endpoint for worker data is unavailable or has an unknown format.  The
   scraper parses the worker table with BeautifulSoup.

**Retry logic:** every ``_get()`` call retries up to 3 times with exponential backoff
(max 4 s) on transient HTTP status codes (429, 500, 502, 503, 504) and network errors.
``Retry-After`` headers are respected for 429 responses.

**Bitcoin network stats** are fetched from mempool.guide with a mempool.space fallback.

Typical call order (in ``metrics_service.fetch_full_metrics``)::

    client = OceanClient(wallet)
    hr      = await client.get_user_hashrate()      # per-user hashrates
    snap    = await client.get_statsnap()            # unpaid earnings, last share
    pool    = await client.get_pool_stat()           # pool-wide stats
    block   = await client.get_latest_block_info()  # last block height/time
    btc     = await client.get_bitcoin_stats()      # BTC price, network hashrate
    workers = await client.get_worker_data()        # API + scraper fallback
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

from app.config import get_timezone
from app.models import convert_to_ths, format_hashrate

API_BASE = "https://api.ocean.xyz/v1"
OCEAN_STATS_URL = "https://ocean.xyz/stats/{wallet}"
OCEAN_PAYOUTS_URL = "https://ocean.xyz/template/workers/payouts/rows"
SATS_PER_BTC = 100_000_000
MAX_PAYOUT_HISTORY = 500
MAX_PAYOUT_PAGES = 100  # Ocean currently returns five payouts per page.
PAYOUT_API_BUDGET_SECONDS = 6
PAYOUT_SCRAPE_BUDGET_SECONDS = 6
MAX_WORKER_PAGES = 100
WORKER_SCRAPE_BUDGET_SECONDS = 12

_log = logging.getLogger(__name__)


def _first_present(data: dict, *keys: str) -> Any:
    """Select a reported interval without replacing an explicit zero."""
    return next((data[key] for key in keys if data.get(key) is not None), None)


def _worker_summary(workers: list[dict]) -> dict:
    return {
        "workers": workers,
        "total_hashrate": sum(worker["hashrate_3hr"] for worker in workers),
        "hashrate_unit": "TH/s",
        "workers_total": len(workers),
        "workers_online": sum(worker["status"] == "online" for worker in workers),
        "workers_offline": sum(worker["status"] == "offline" for worker in workers),
        "total_earnings": 0.0,
        "timestamp": datetime.now(ZoneInfo("UTC")).isoformat(),
    }


def _worker_record(name: str, hr60: float, hr3: float, status: str, last_share: str = "N/A") -> dict:
    return {
        "name": name,
        "status": status,
        "type": "ASIC",
        "model": "Unknown",
        "hashrate_60sec": hr60,
        "hashrate_60sec_unit": "TH/s",
        "hashrate_3hr": hr3,
        "hashrate_3hr_unit": "TH/s",
        "efficiency": 0.0,
        "last_share": last_share,
        "earnings": 0.0,
        "power_consumption": 0.0,
        "acceptance_rate": 100.0,
    }


def _safe_zoneinfo(name: str) -> ZoneInfo:
    """Return the named timezone, falling back to UTC when it is invalid.

    A bad ``timezone`` value in config.json must degrade payout dates to UTC
    rather than turn the earnings endpoint into a 500.
    """
    try:
        return ZoneInfo(name)
    except Exception:
        _log.warning("Invalid timezone %r; falling back to UTC", name)
        return ZoneInfo("UTC")


def _elapsed_str(ts_seconds: float) -> str:
    """Convert a UTC unix timestamp to 'X mins ago' string."""
    delta = int(time.time() - ts_seconds)
    if delta < 60:
        return f"{delta} secs ago"
    if delta < 3600:
        m = delta // 60
        return f"{m} {'min' if m == 1 else 'mins'} ago"
    h = delta // 3600
    m = (delta % 3600) // 60
    h_label = "hour" if h == 1 else "hours"
    if m > 0:
        return f"{h} {h_label}, {m} {'min' if m == 1 else 'mins'} ago"
    return f"{h} {h_label} ago"


class OceanClient:
    """Async Ocean.xyz API + scraper client.

    Manages a single shared ``httpx.AsyncClient`` instance (lazy-initialised on
    first use, re-created if closed) to benefit from connection pooling.

    Args:
        wallet: Bitcoin address used as the key for all per-user API calls.
        timeout: Default request timeout in seconds (default 10).  Individual
            methods may pass a longer timeout (e.g. 15 s for payment history).
    """

    def __init__(self, wallet: str, timeout: int = 10):
        self.wallet = wallet
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={"User-Agent": "DeepSea-Dashboard/2.0"},
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _get(
        self,
        url: str,
        timeout: int | float | None = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[httpx.Response]:
        """Perform a GET request with automatic retry on transient errors.

        Retries up to 3 times with exponential backoff (0.5 s, 1 s, 2 s, capped
        at 4 s).  A ``Retry-After`` header (integer seconds) is honoured for 429
        responses, capped at 10 s to avoid excessive stalls.

        Args:
            url: Full URL to fetch.
            timeout: Per-request timeout override (seconds).  Falls back to
                ``self.timeout`` when ``None``.
            headers: Additional HTTP headers to merge with the default
                ``User-Agent`` header.

        Returns:
            The ``httpx.Response`` on success, or ``None`` after all retries are
            exhausted or a non-transient error occurs.
        """
        client = await self._get_client()
        max_attempts = 3
        req_timeout = timeout or self.timeout

        for attempt in range(1, max_attempts + 1):
            try:
                resp = await client.get(url, timeout=req_timeout, headers=headers)

                # Transient upstream errors / rate limits: retry with backoff.
                if resp.status_code in (429, 500, 502, 503, 504):
                    if attempt < max_attempts:
                        retry_after_raw = resp.headers.get("Retry-After")
                        wait_s: float
                        if retry_after_raw and retry_after_raw.isdigit():
                            wait_s = max(0.1, min(float(retry_after_raw), 10.0))
                        else:
                            wait_s = min(0.5 * (2 ** (attempt - 1)), 4.0)
                        _log.warning(
                            "GET %s transient status=%s (attempt %d/%d), retrying in %.1fs",
                            url,
                            resp.status_code,
                            attempt,
                            max_attempts,
                            wait_s,
                        )
                        await asyncio.sleep(wait_s)
                        continue

                resp.raise_for_status()
                return resp

            except httpx.RequestError as e:
                if attempt < max_attempts:
                    wait_s = min(0.5 * (2 ** (attempt - 1)), 4.0)
                    _log.warning(
                        "GET %s request error (attempt %d/%d): %s; retrying in %.1fs",
                        url,
                        attempt,
                        max_attempts,
                        e,
                        wait_s,
                    )
                    await asyncio.sleep(wait_s)
                    continue
                _log.warning("GET %s failed after retries: %s", url, e)
                return None
            except httpx.HTTPStatusError as e:
                _log.warning("GET %s failed with status %s", url, e.response.status_code)
                return None
            except Exception as e:
                _log.warning("GET %s failed: %s", url, e)
                return None

        return None

    # ------------------------------------------------------------------
    # Core API Methods
    # ------------------------------------------------------------------

    async def get_user_hashrate(self) -> dict[str, Any]:
        """Fetch per-user hashrates and active worker count from the Ocean API.

        Calls ``/v1/user_hashrate/<wallet>`` and normalises all hashrate fields
        to TH/s.  Returns a partial dict suitable for merging into the metrics
        snapshot.

        Returns:
            Dict with keys: ``hashrate_60sec``, ``hashrate_10min``,
            ``hashrate_3hr``, ``hashrate_24hr`` (all TH/s floats), their
            corresponding ``_unit`` keys, and ``workers_hashing`` (int).
            Empty dict on error.
        """
        resp = await self._get(f"{API_BASE}/user_hashrate/{self.wallet}")
        if resp is None:
            return {}
        try:
            data = resp.json().get("result", {}) or {}
            result: dict[str, Any] = {}

            raw_60 = data.get("hashrate_60s")
            raw_10m = data.get("hashrate_600s")
            raw_3h = _first_present(data, "hashrate_10800s", "hashrate_7200s", "hashrate_3600s")
            raw_24h = data.get("hashrate_86400s")

            for key, raw in [
                ("hashrate_60sec", raw_60),
                ("hashrate_10min", raw_10m),
                ("hashrate_3hr", raw_3h),
                ("hashrate_24hr", raw_24h),
            ]:
                if raw is not None:
                    try:
                        result[key] = convert_to_ths(float(raw), "H/s")
                    except (ValueError, TypeError):
                        pass
                result[f"{key}_unit"] = "TH/s"

            active = data.get("active_worker_count")
            if active is not None:
                result["workers_hashing"] = int(active)

            return result
        except Exception as e:
            _log.error("Error parsing user_hashrate: %s", e)
            return {}

    async def get_statsnap(self) -> dict[str, Any]:
        """Fetch the miner's unpaid earnings snapshot from ``/v1/statsnap/<wallet>``.

        Returns:
            Dict with keys: ``unpaid_earnings`` (BTC float),
            ``estimated_earnings_next_block`` (BTC), ``estimated_rewards_in_window``
            (BTC), and ``total_last_share`` (localised timestamp string).
            Empty dict on error.
        """
        resp = await self._get(f"{API_BASE}/statsnap/{self.wallet}")
        if resp is None:
            return {}
        try:
            snap = resp.json().get("result", {}) or {}
            result: dict[str, Any] = {}

            unpaid = snap.get("unpaid")
            if unpaid is not None:
                result["unpaid_earnings"] = float(unpaid)

            earn_next = snap.get("estimated_earn_next_block")
            if earn_next is not None:
                result["estimated_earnings_next_block"] = float(earn_next)

            rewards = snap.get("estimated_total_earn_next_block")
            if rewards is not None:
                result["estimated_rewards_in_window"] = float(rewards)

            ts = snap.get("lastest_share_ts") or snap.get("latest_share_ts")
            if ts:
                try:
                    dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("UTC")).astimezone(
                        ZoneInfo(get_timezone())
                    )
                    result["total_last_share"] = dt.strftime("%Y-%m-%d %I:%M %p")
                except (ValueError, TypeError, OSError) as e:
                    _log.debug("Could not parse last share timestamp: %s", e)

            return result
        except Exception as e:
            _log.error("Error parsing statsnap: %s", e)
            return {}

    async def get_pool_stat(self) -> dict[str, Any]:
        """Fetch pool-wide statistics concurrently from two endpoints.

        Calls ``/v1/pool_stat`` and ``/v1/pool_hashrate`` in parallel via
        ``asyncio.gather``.

        Returns:
            Dict with keys: ``workers_hashing`` (pool-wide int), ``difficulty``
            (network difficulty float), ``current_estimated_block_reward``
            (BTC float), ``pool_total_hashrate`` (auto-scaled float), and
            ``pool_total_hashrate_unit`` (e.g. ``"PH/s"``).
        """
        stat_resp, hr_resp = await asyncio.gather(
            self._get(f"{API_BASE}/pool_stat"),
            self._get(f"{API_BASE}/pool_hashrate"),
        )
        result: dict[str, Any] = {}

        if stat_resp is not None:
            try:
                stat = stat_resp.json().get("result", {}) or {}
                wh = stat.get("active_workers") or stat.get("workers")
                if wh is not None:
                    result["workers_hashing"] = int(wh)
                diff = stat.get("network_difficulty")
                if diff is not None:
                    result["difficulty"] = float(diff)
                reward = stat.get("current_estimated_block_reward")
                if reward is not None:
                    result["current_estimated_block_reward"] = float(reward)
            except Exception as e:
                _log.error("Error parsing pool_stat: %s", e)

        if hr_resp is not None:
            try:
                ph = hr_resp.json().get("result", {}) or {}
                raw = ph.get("pool_60s") or ph.get("pool_300s")
                if raw is not None:
                    ths = convert_to_ths(float(raw), "H/s")
                    val, unit = format_hashrate(ths)
                    result["pool_total_hashrate"] = val
                    result["pool_total_hashrate_unit"] = unit
            except Exception as e:
                _log.error("Error parsing pool_hashrate: %s", e)

        return result

    async def get_blocks(self, page: int = 0, page_size: int = 20) -> list[dict]:
        """Fetch a page of recent Ocean pool blocks from ``/v1/blocks``.

        Args:
            page: Zero-based page index.
            page_size: Number of blocks per page (default 20).

        Returns:
            List of raw block dicts from the API, or an empty list on error.
        """
        resp = await self._get(f"{API_BASE}/blocks/{page}/{page_size}/0")
        if resp is None:
            return []
        try:
            data = resp.json()
            blocks = data.get("blocks")
            if blocks is None:
                r = data.get("result")
                if isinstance(r, dict):
                    blocks = r.get("blocks")
                elif isinstance(r, list):
                    blocks = r
            return blocks if isinstance(blocks, list) else []
        except Exception as e:
            _log.error("Error parsing blocks: %s", e)
            return []

    async def get_latest_block_info(self) -> dict[str, Any]:
        """Return the height and relative timestamp of the most recent pool block.

        Returns:
            Dict with ``last_block_height`` (int) and ``last_block_time``
            (human-readable string such as ``"5 mins ago"``).
            Empty dict if no blocks are available.
        """
        blocks = await self.get_blocks(page=0, page_size=1)
        if not blocks:
            return {}
        block = blocks[0]
        result: dict[str, Any] = {}
        height = block.get("height")
        if height is not None:
            result["last_block_height"] = int(height)

        ts = block.get("ts") or block.get("time") or block.get("timestamp")
        if ts:
            try:
                ts_str = str(ts)
                try:
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
                    else:
                        dt = dt.astimezone(ZoneInfo("UTC"))
                except (ValueError, TypeError):
                    dt = datetime.fromtimestamp(float(ts), tz=ZoneInfo("UTC"))
                result["last_block_time"] = _elapsed_str(dt.timestamp())
            except (ValueError, TypeError, OSError) as e:
                _log.debug("Could not parse latest block timestamp %r: %s", ts, e)

        return result

    async def get_payment_history(
        self, days: int = 360, btc_price: Optional[float] = None
    ) -> list[dict]:
        """Fetch confirmed payout history for the wallet.

        Calls ``/v1/earnpay/<wallet>/<start>/<end>`` with a date range derived
        from ``days``.  The earnpay endpoint only reports on-chain payouts, so
        the stats page payout table — which also lists Lightning payouts — is
        scraped as well, and any entries the API did not return are merged in.
        Pagination walks the requested window and stops at the first page with
        no unseen rows. Both sources run concurrently with 6 s budgets, so
        retries cannot outlast the frontend's 10 s request timeout. The scrape
        retains rows already parsed if a later page times out.
        Results are capped at ``MAX_PAYOUT_HISTORY`` entries.

        Args:
            days: Number of historical days to include (default 360).
            btc_price: If provided, each payment dict will include ``rate``
                and ``fiat_value`` fields.

        Returns:
            List of payment dicts with fields: ``date``, ``date_iso``, ``txid``,
            ``lightning_txid``, ``amount_btc``, ``amount_sats``, ``status``,
            and optionally ``rate`` / ``fiat_value``, sorted newest first.
        """
        async def fetch_api() -> list[dict]:
            try:
                async with asyncio.timeout(PAYOUT_API_BUDGET_SECONDS):
                    return await self._get_payment_history_api(days=days, btc_price=btc_price)
            except TimeoutError:
                _log.warning("Payout API timed out; returning available scraped payouts")
                return []

        api_payments, scraped = await asyncio.gather(
            fetch_api(),
            self._get_payment_history_scrape(days=days, btc_price=btc_price),
        )
        # Prefer API records (which include seconds in their timestamps) when
        # the same transaction also appears in the scraped minute-level data.
        merged = []
        seen_ids: set[tuple[str, str]] = set()
        seen_keys: set[tuple[str, int]] = set()
        for payment in api_payments + scraped:
            ids = {(field, payment[field]) for field in ("txid", "lightning_txid") if payment[field]}
            key = (payment["date"], payment["amount_sats"])
            if ids.intersection(seen_ids) or (not ids and key in seen_keys):
                continue
            seen_ids.update(ids)
            seen_keys.add(key)
            merged.append(payment)
        # Local wall-clock strings can go backwards when daylight saving ends.
        def timestamp(payment: dict) -> float:
            try:
                return datetime.fromisoformat(payment["date_iso"]).timestamp()
            except (TypeError, ValueError):
                return float("-inf")

        merged.sort(key=timestamp, reverse=True)
        return merged[:MAX_PAYOUT_HISTORY]

    async def _get_payment_history_api(
        self, days: int, btc_price: Optional[float] = None
    ) -> list[dict]:
        """Fetch payout history from ``/v1/earnpay/<wallet>/<start>/<end>``."""
        tzinfo = _safe_zoneinfo(get_timezone())
        end = datetime.now(ZoneInfo("UTC"))
        start = end - timedelta(days=days)
        url = f"{API_BASE}/earnpay/{self.wallet}/{start.strftime('%Y-%m-%d')}/{end.strftime('%Y-%m-%d')}"

        resp = await self._get(url, timeout=15)
        if resp is None:
            return []
        try:
            data = resp.json().get("result", {})
            payouts = data.get("payouts", [])
            payments = []
            for item in payouts:
                ts = item.get("ts")
                sats = int(item.get("total_satoshis_net_paid", 0) or 0)
                amount_btc = sats / SATS_PER_BTC
                date_str = ""
                date_iso = None
                if ts is not None:
                    try:
                        if isinstance(ts, (int, float)):
                            dt = datetime.fromtimestamp(ts, tz=ZoneInfo("UTC"))
                        else:
                            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=ZoneInfo("UTC"))
                        local_dt = dt.astimezone(tzinfo)
                        date_iso = local_dt.isoformat()
                        date_str = local_dt.strftime("%Y-%m-%d %H:%M")
                    except (ValueError, TypeError, OSError) as e:
                        _log.debug("Could not parse payout timestamp %r: %s", ts, e)

                payment = {
                    "date": date_str,
                    "date_iso": date_iso,
                    "txid": item.get("on_chain_txid") or "",
                    "lightning_txid": item.get("lightning_txid") or "",
                    "amount_btc": amount_btc,
                    "amount_sats": sats,
                    "status": "confirmed",
                }
                if btc_price is not None:
                    payment["rate"] = btc_price
                    payment["fiat_value"] = amount_btc * btc_price
                payments.append(payment)
                if len(payments) >= MAX_PAYOUT_HISTORY:
                    break
            return payments
        except Exception as e:
            _log.error("Error parsing payment history: %s", e)
            return []

    async def _get_payment_history_scrape(
        self,
        days: int,
        btc_price: Optional[float] = None,
    ) -> list[dict]:
        """Scrape payout history from the stats page payout table.

        The earnpay API omits Lightning payouts, but the payouts table on
        ``ocean.xyz/stats/<wallet>`` lists them with links of the form
        ``/info/tx/lightning/<id>`` (on-chain rows link to a regular txid).
        Fetch the same rows as the stats page's pagination widget, newest first,
        until the requested ``days`` window is exhausted. This avoids repeatedly
        downloading the entire stats page for each five-row page.

        Args:
            days: Number of historical days to include.
            btc_price: If provided, adds ``rate`` / ``fiat_value`` per payment.
        """
        tzinfo = _safe_zoneinfo(get_timezone())
        cutoff = datetime.now(ZoneInfo("UTC")) - timedelta(days=days)
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DeepSea/2.0)",
            "Accept": "text/html",
        }

        payments: list[dict] = []
        seen: set[tuple] = set()
        deadline = time.monotonic() + PAYOUT_SCRAPE_BUDGET_SECONDS

        for page in range(MAX_PAYOUT_PAGES):
            url = f"{OCEAN_PAYOUTS_URL}?{urlencode({'user': self.wallet, 'page': page})}"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                # Bound retries and backoff as well as the individual request,
                # including for Lightning-only miners with no API payouts.
                async with asyncio.timeout(remaining):
                    resp = await self._get(url, timeout=min(15, remaining), headers=headers)
            except TimeoutError:
                _log.warning("Payout scrape timed out; returning payouts already collected")
                break
            if resp is None:
                break

            soup = BeautifulSoup(resp.text, "html.parser")
            table = soup.find("tbody", id="payouts-tablerows") or soup.find(
                "tbody", id="payout-tablerows"
            )
            # The pagination endpoint returns bare <tr> fragments. Also accept
            # a complete table for compatibility with cached full-page HTML.
            rows = (table.find_all("tr") if table is not None
                    else soup.find_all("tr", recursive=False))
            if not rows:
                if page == 0:
                    _log.debug("Payout scrape returned no rows for wallet=%s", self.wallet)
                break
            page_progress = 0
            out_of_window = False

            for row in rows:
                cells = row.find_all("td")
                if len(cells) < 3:
                    continue

                date_text = cells[0].get_text(strip=True)
                txid = cells[1].get_text(strip=True)
                lightning_txid = ""
                link = cells[1].find("a")
                if link and link.get("href"):
                    href = link["href"]
                    tx_ref = href.rstrip("/").split("/")[-1]
                    if "lightning" in href:
                        lightning_txid = tx_ref
                        txid = ""
                    else:
                        txid = tx_ref

                amount_clean = (
                    cells[-1].get_text(strip=True).replace("BTC", "").replace(",", "").strip()
                )
                try:
                    amount_btc = float(amount_clean)
                except ValueError:
                    continue
                if not math.isfinite(amount_btc) or amount_btc < 0:
                    continue
                sats = int(round(amount_btc * SATS_PER_BTC))

                date_iso = None
                date_str = date_text
                try:
                    dt = datetime.strptime(date_text, "%Y-%m-%d %H:%M").replace(
                        tzinfo=ZoneInfo("UTC")
                    )
                    if dt < cutoff:
                        out_of_window = True
                        break
                    local_dt = dt.astimezone(tzinfo)
                    date_iso = local_dt.isoformat()
                    date_str = local_dt.strftime("%Y-%m-%d %H:%M")
                except ValueError as e:
                    _log.debug("Could not parse payout date %r: %s", date_text, e)
                    continue  # Unknown dates cannot be checked against the requested window.

                key = (date_text, txid, lightning_txid, sats)
                if key in seen:
                    continue
                seen.add(key)
                page_progress += 1

                payment = {
                    "date": date_str,
                    "date_iso": date_iso,
                    "txid": txid,
                    "lightning_txid": lightning_txid,
                    "amount_btc": amount_btc,
                    "amount_sats": sats,
                    "status": "confirmed",
                }
                if btc_price is not None:
                    payment["rate"] = btc_price
                    payment["fiat_value"] = amount_btc * btc_price
                payments.append(payment)
                if len(payments) >= MAX_PAYOUT_HISTORY:
                    return payments

            # A page with no unseen rows means the end of history (or the
            # server ignoring page); out-of-window rows mean the rest is older.
            if out_of_window or page_progress == 0:
                break

        return payments

    async def get_worker_data(self) -> Optional[dict]:
        """Return enriched worker data, trying the API then the HTML scraper.

        Calls ``_get_worker_data_api()`` first; if that returns ``None`` (e.g.
        the API endpoint is unavailable or has an unknown response), falls back to
        ``_get_worker_data_scrape()`` which parses the Ocean stats page HTML.

        Returns:
            Dict with keys ``workers`` (list), ``total_hashrate``,
            ``hashrate_unit``, ``workers_total``, ``workers_online``,
            ``workers_offline``, ``total_earnings``, and ``timestamp``.
            ``None`` if both sources fail.
        """
        result = await self._get_worker_data_api()
        if result is not None:
            return result
        _log.info("API worker fetch failed, trying scraper")
        return await self._get_worker_data_scrape()

    async def _get_worker_data_api(self) -> Optional[dict]:
        """Parse the complete worker snapshot, including Ocean's one-item arrays.

        Unknown or malformed named entries invalidate the snapshot rather than
        silently reducing the fleet used for power and financial estimates.
        """
        resp = await self._get(f"{API_BASE}/user_hashrate_full/{self.wallet}", timeout=15)
        if resp is None:
            return None
        try:
            data = resp.json()
            if not isinstance(data, dict):
                return None
            workers_obj = None
            for container in (data, data.get("result"), data.get("user_hashrate")):
                if isinstance(container, dict) and "workers" in container:
                    workers_obj = container["workers"]
                    break
            if isinstance(workers_obj, dict):
                entries = list(workers_obj.items())
            elif isinstance(workers_obj, list):
                if any(not isinstance(record, dict) for record in workers_obj):
                    return None
                entries = [(record.get("workername") or record.get("name"), record) for record in workers_obj]
            else:
                return None

            workers = []
            seen = set()
            invalid = {"online", "offline", "status", "worker", "total"}
            rate_keys = (
                "hashrate_10800s", "hashrate_10800", "hashrate_7200s", "hashrate_7200",
                "hashrate_3600s", "hashrate_3600", "hashrate_300s",
            )
            for name, info in entries:
                if name and str(name).lower() in invalid:
                    records = info if isinstance(info, list) else [info]
                    # These labels can also be legitimate worker names. Ignore
                    # metadata values only when they contain no worker fields.
                    if not any(
                        isinstance(record, dict)
                        and any(key in record for key in (*rate_keys, "hashrate_60s"))
                        for record in records
                    ):
                        continue
                if not name or str(name) in seen:
                    return None
                # Current Ocean responses wrap each worker's current record in
                # a one-item list. Multiple records are ambiguous, so use the
                # complete HTML fallback instead of discarding or double-counting.
                if isinstance(info, list):
                    if len(info) != 1:
                        return None
                    info = info[0]
                if not isinstance(info, dict):
                    return None
                hr3_raw = _first_present(info, *rate_keys)
                hr60_raw = info.get("hashrate_60s")
                if hr3_raw is None and hr60_raw is None:
                    return None
                if isinstance(hr3_raw, bool) or isinstance(hr60_raw, bool):
                    return None
                hr3 = convert_to_ths(float(hr3_raw if hr3_raw is not None else 0), "H/s")
                hr60 = convert_to_ths(float(hr60_raw if hr60_raw is not None else 0), "H/s")
                if not all(math.isfinite(rate) and rate >= 0 for rate in (hr3, hr60)):
                    return None
                status = "online" if hr60 or hr3 else "offline"
                workers.append(_worker_record(str(name), hr60, hr3, status))
                seen.add(str(name))

            if not workers and entries:
                return None
            return _worker_summary(workers)
        except (TypeError, ValueError, AttributeError) as error:
            _log.warning("API worker snapshot could not be parsed: %s", error)
            return None

    async def _get_worker_data_scrape(self) -> Optional[dict]:
        """Read every worker page, including inactive workers, or fail as a whole."""
        try:
            async with asyncio.timeout(WORKER_SCRAPE_BUDGET_SECONDS):
                return await self._get_all_worker_pages()
        except TimeoutError:
            _log.warning("Worker pagination timed out; discarding incomplete fleet")
            return None

    async def _get_all_worker_pages(self) -> Optional[dict]:
        base_url = OCEAN_STATS_URL.format(wallet=self.wallet)
        expected_url = urlsplit(base_url)
        headers = {"User-Agent": "Mozilla/5.0 (compatible; DeepSea/2.0)", "Accept": "text/html"}
        workers = []
        seen_names = set()
        invalid = {"online", "offline", "status", "worker", "total"}
        row_count = 0
        expected_rows = None

        for page in range(MAX_WORKER_PAGES):
            # Build the URL from our fixed endpoint, never from an upstream href.
            # Ocean otherwise hides inactive workers by default.
            url = f"{base_url}?{urlencode({'wactive': 'off', 'wpage': page})}"
            resp = await self._get(url, timeout=15, headers=headers)
            if resp is None:
                return None
            soup = BeautifulSoup(resp.text, "html.parser")
            table = soup.find("tbody", id="workers-tablerows") or soup.select_one("table#workers tbody")
            known_worker_table = table is not None
            if table is None:
                table = soup.select_one("tbody")
            if table is None:
                return None
            rows = table.find_all("tr", class_="table-row") or table.find_all("tr")
            counts = soup.select_one("#workers-page-counts")
            if counts is not None:
                match = re.search(r"of\s+([\d,]+)\s+results", counts.get_text(" ", strip=True), re.I)
                if match:
                    reported = int(match.group(1).replace(",", ""))
                    if expected_rows is not None and expected_rows != reported:
                        return None  # Fleet changed during pagination: retry a whole snapshot later.
                    expected_rows = reported
            new_names = set()
            for row in rows:
                cells = row.find_all("td")
                if not cells:
                    continue
                name = cells[0].get_text(strip=True)
                row_count += 1
                if name.lower() in invalid:
                    # The aggregate links to /stats/<wallet>; actual workers
                    # link to /stats/<wallet>.<worker>, even when named Total.
                    link = cells[0].find("a", href=True)
                    target = None
                    if link is not None:
                        try:
                            target = urlsplit(urljoin(base_url, link["href"]))
                        except ValueError:
                            return None
                    worker_link = (
                        target is not None
                        and (target.scheme, target.netloc) == (expected_url.scheme, expected_url.netloc)
                        and target.path.startswith(expected_url.path + ".")
                        and len(target.path) > len(expected_url.path) + 1
                    )
                    if not worker_link:
                        continue
                if not name or len(cells) < 5 or name in seen_names:
                    return None
                try:
                    rates = []
                    for cell in (cells[3], cells[4]):
                        parts = cell.get_text(strip=True).split()
                        if not parts:
                            return None
                        rate = convert_to_ths(float(parts[0].replace(",", "")), parts[1] if len(parts) > 1 else "TH/s")
                        if not math.isfinite(rate) or rate < 0:
                            return None
                        rates.append(rate)
                except (ValueError, TypeError):
                    return None
                status_text = cells[1].get_text(strip=True).lower()
                if "offline" in status_text:
                    status = "offline"
                elif "online" in status_text:
                    status = "online"
                else:
                    return None
                workers.append(_worker_record(name, rates[0], rates[1], status, cells[2].get_text(strip=True)))
                new_names.add(name)
                seen_names.add(name)

            if not workers and (rows or not known_worker_table):
                return None
            if page > 0 and not new_names:
                return None

            scope = soup.select_one("#workers-footer") or soup.select_one("#workers-fulltable") or soup
            later_pages = set()
            for link in scope.find_all("a", href=True):
                try:
                    target = urlsplit(urljoin(base_url, link["href"]))
                except ValueError:
                    continue
                if (target.scheme, target.netloc, target.path) != (
                    expected_url.scheme, expected_url.netloc, expected_url.path
                ):
                    continue
                values = parse_qs(target.query).get("wpage", [])
                if len(values) == 1 and values[0].isdigit() and int(values[0]) > page:
                    later_pages.add(int(values[0]))
            if not later_pages:
                if expected_rows is not None and row_count != expected_rows:
                    return None
                return _worker_summary(workers)
            if page + 1 not in later_pages:
                return None

        _log.warning("Worker page limit reached; discarding incomplete fleet")
        return None

    # ------------------------------------------------------------------
    # Bitcoin Network Stats
    # ------------------------------------------------------------------

    async def get_bitcoin_stats(self) -> dict[str, Any]:
        """Fetch Bitcoin network stats with a two-tier primary/fallback strategy.

        Tries **mempool.guide** first for all three sub-requests (hashrate,
        prices, tip height).  Falls back to **mempool.space** for any that fail.

        Returns:
            Dict with keys: ``btc_price`` (USD float), ``btc_price_<CURR>`` for
            each currency returned by the prices endpoint, ``network_hashrate``
            (raw H/s float), ``difficulty`` (float), and ``block_count`` (int).
        """
        result: dict[str, Any] = {}
        primary_urls = {
            "hashrate": "https://mempool.guide/api/v1/mining/hashrate/3d",
            "prices": "https://mempool.guide/api/v1/prices",
            "height": "https://mempool.guide/api/blocks/tip/height",
        }
        fallback_urls = {
            "hashrate": "https://mempool.space/api/v1/mining/hashrate/3d",
            "prices": "https://mempool.space/api/v1/prices",
            "height": "https://mempool.space/api/blocks/tip/height",
        }

        async def fetch_json(url: str) -> Optional[dict | float | int]:
            resp = await self._get(url, timeout=8)
            if resp is None:
                return None
            try:
                ct = resp.headers.get("content-type", "")
                if "json" in ct:
                    return resp.json()
                text = resp.text.strip()
                try:
                    return int(text)
                except ValueError:
                    return float(text)
            except (ValueError, TypeError) as e:
                _log.debug("Could not decode response from %s: %s", url, e)
                return None

        for key in ["hashrate", "prices", "height"]:
            data = await fetch_json(primary_urls[key])
            if data is None:
                data = await fetch_json(fallback_urls[key])

            if key == "prices" and isinstance(data, dict):
                usd = data.get("USD")
                if usd is not None:
                    result["btc_price"] = float(usd)
                    result["btc_price_USD"] = float(usd)
                for curr, val in data.items():
                    if curr != "time":
                        try:
                            result[f"btc_price_{curr}"] = float(val)
                        except (TypeError, ValueError):
                            pass

            elif key == "hashrate" and isinstance(data, dict):
                nh = data.get("currentHashrate")
                if nh is not None:
                    result["network_hashrate"] = float(nh)
                nd = data.get("currentDifficulty")
                if nd is not None:
                    result["difficulty"] = float(nd)

            elif key == "height" and data is not None:
                try:
                    result["block_count"] = int(data)
                except (TypeError, ValueError):
                    pass

        return result
