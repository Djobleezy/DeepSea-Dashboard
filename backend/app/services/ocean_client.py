"""Ocean.xyz API client — async port of the existing client + scraper logic."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

from app.config import get_timezone
from app.models import convert_to_ths, format_hashrate

API_BASE = "https://api.ocean.xyz/v1"
OCEAN_STATS_URL = "https://ocean.xyz/stats/{wallet}"
SATS_PER_BTC = 100_000_000
MAX_PAYOUT_HISTORY = 500

_log = logging.getLogger(__name__)


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
    """Async Ocean.xyz API + scraper client."""

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

    async def _get(self, url: str, timeout: int | None = None) -> Optional[httpx.Response]:
        client = await self._get_client()
        try:
            resp = await client.get(url, timeout=timeout or self.timeout)
            resp.raise_for_status()
            return resp
        except Exception as e:
            _log.warning("GET %s failed: %s", url, e)
            return None

    # ------------------------------------------------------------------
    # Core API Methods
    # ------------------------------------------------------------------

    async def get_user_hashrate(self) -> dict[str, Any]:
        resp = await self._get(f"{API_BASE}/user_hashrate/{self.wallet}")
        if resp is None:
            return {}
        try:
            data = resp.json().get("result", {}) or {}
            result: dict[str, Any] = {}

            raw_60 = data.get("hashrate_60s")
            raw_10m = data.get("hashrate_600s")
            raw_3h = data.get("hashrate_10800s") or data.get("hashrate_7200s") or data.get("hashrate_3600s")
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

            ts = snap.get("lastest_share_ts")
            if ts:
                try:
                    dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("UTC")).astimezone(
                        ZoneInfo(get_timezone())
                    )
                    result["total_last_share"] = dt.strftime("%Y-%m-%d %I:%M %p")
                except Exception:
                    pass

            return result
        except Exception as e:
            _log.error("Error parsing statsnap: %s", e)
            return {}

    async def get_pool_stat(self) -> dict[str, Any]:
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
            except Exception:
                pass

        return result

    async def get_payment_history(
        self, days: int = 360, btc_price: Optional[float] = None
    ) -> list[dict]:
        tz = get_timezone()
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
                        local_dt = dt.astimezone(ZoneInfo(tz))
                        date_iso = local_dt.isoformat()
                        date_str = local_dt.strftime("%Y-%m-%d %H:%M")
                    except Exception:
                        pass

                payment = {
                    "date": date_str,
                    "date_iso": date_iso,
                    "txid": item.get("on_chain_txid", ""),
                    "lightning_txid": item.get("lightning_txid", ""),
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

    async def get_worker_data(self) -> Optional[dict]:
        """Try API first, fall back to scraper."""
        result = await self._get_worker_data_api()
        if result:
            return result
        _log.info("API worker fetch failed, trying scraper")
        return await self._get_worker_data_scrape()

    async def _get_worker_data_api(self) -> Optional[dict]:
        resp = await self._get(f"{API_BASE}/user_hashrate_full/{self.wallet}", timeout=15)
        if resp is None:
            return None
        try:
            data = resp.json()
            workers_obj = (
                data.get("workers")
                or data.get("result", {}).get("workers")
                or data.get("user_hashrate", {}).get("workers")
            )
            if not workers_obj:
                return None

            if isinstance(workers_obj, dict):
                workers_iter = workers_obj.items()
            else:
                workers_iter = [(w.get("workername") or w.get("name"), w) for w in workers_obj]

            workers = []
            total_hashrate = 0.0
            workers_online = 0
            workers_offline = 0
            invalid = {"online", "offline", "status", "worker", "total"}

            for name, info in workers_iter:
                if not name or str(name).lower() in invalid:
                    continue
                hr3_raw = (
                    info.get("hashrate_10800")
                    or info.get("hashrate_7200")
                    or info.get("hashrate_3600")
                    or info.get("hashrate_300s")
                )
                hr60_raw = info.get("hashrate_60s") or 0
                hr3 = convert_to_ths(float(hr3_raw or 0), "H/s")
                hr60 = convert_to_ths(float(hr60_raw or 0), "H/s")
                status = "online" if (hr60 or hr3) else "offline"
                if status == "online":
                    workers_online += 1
                else:
                    workers_offline += 1
                total_hashrate += hr3
                workers.append({
                    "name": str(name),
                    "status": status,
                    "type": "ASIC",
                    "model": "Unknown",
                    "hashrate_60sec": hr60,
                    "hashrate_60sec_unit": "TH/s",
                    "hashrate_3hr": hr3,
                    "hashrate_3hr_unit": "TH/s",
                    "efficiency": 0.0,
                    "last_share": "N/A",
                    "earnings": 0.0,
                    "power_consumption": 0.0,
                    "acceptance_rate": 100.0,
                })

            if not workers:
                return None

            return {
                "workers": workers,
                "total_hashrate": total_hashrate,
                "hashrate_unit": "TH/s",
                "workers_total": len(workers),
                "workers_online": workers_online,
                "workers_offline": workers_offline,
                "total_earnings": 0.0,
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            _log.error("API worker parse error: %s", e)
            return None

    async def _get_worker_data_scrape(self) -> Optional[dict]:
        """Scrape worker data from ocean.xyz/stats/<wallet>."""
        url = f"https://ocean.xyz/stats/{self.wallet}"
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DeepSea/2.0)",
            "Accept": "text/html",
        }
        client = await self._get_client()
        try:
            resp = await client.get(url, headers=headers, timeout=15)
            if not resp.is_success:
                return None
        except Exception as e:
            _log.error("Scrape request failed: %s", e)
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        workers = []
        total_hashrate = 0.0
        workers_online = 0
        workers_offline = 0
        invalid = {"online", "offline", "status", "worker", "total"}

        table = soup.find("tbody", id="workers-tablerows")
        if not table:
            return None

        for row in table.find_all("tr", class_="table-row"):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            name = cells[0].get_text(strip=True)
            if not name or name.lower() in invalid:
                continue
            status_text = cells[1].get_text(strip=True).lower() if len(cells) > 1 else ""
            status = "online" if "online" in status_text else "offline"
            if status == "online":
                workers_online += 1
            else:
                workers_offline += 1

            hr60 = 0.0
            hr60_unit = "TH/s"
            hr3 = 0.0
            hr3_unit = "TH/s"

            if len(cells) > 3:
                parts = cells[3].get_text(strip=True).split()
                if parts:
                    try:
                        hr60 = float(parts[0])
                        hr60_unit = parts[1] if len(parts) > 1 else "TH/s"
                        hr60 = convert_to_ths(hr60, hr60_unit)
                        hr60_unit = "TH/s"
                    except ValueError:
                        pass

            if len(cells) > 4:
                parts = cells[4].get_text(strip=True).split()
                if parts:
                    try:
                        hr3 = float(parts[0])
                        hr3_unit = parts[1] if len(parts) > 1 else "TH/s"
                        hr3 = convert_to_ths(hr3, hr3_unit)
                        hr3_unit = "TH/s"
                    except ValueError:
                        pass

            total_hashrate += hr3
            workers.append({
                "name": name,
                "status": status,
                "type": "ASIC",
                "model": "Unknown",
                "hashrate_60sec": hr60,
                "hashrate_60sec_unit": "TH/s",
                "hashrate_3hr": hr3,
                "hashrate_3hr_unit": "TH/s",
                "efficiency": 0.0,
                "last_share": cells[2].get_text(strip=True) if len(cells) > 2 else "N/A",
                "earnings": 0.0,
                "power_consumption": 0.0,
                "acceptance_rate": 100.0,
            })

        if not workers:
            return None

        return {
            "workers": workers,
            "total_hashrate": total_hashrate,
            "hashrate_unit": "TH/s",
            "workers_total": len(workers),
            "workers_online": workers_online,
            "workers_offline": workers_offline,
            "total_earnings": 0.0,
            "timestamp": datetime.utcnow().isoformat(),
        }

    # ------------------------------------------------------------------
    # Bitcoin Network Stats
    # ------------------------------------------------------------------

    async def get_bitcoin_stats(self) -> dict[str, Any]:
        """Fetch network stats from mempool.guide with mempool.space fallback."""
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
            except Exception:
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
