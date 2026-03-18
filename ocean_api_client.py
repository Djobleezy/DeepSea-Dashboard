"""
Ocean API client module — handles all HTTP API calls to Ocean.xyz,
mempool.guide, blockchain.info, and exchange rate services.
"""

import logging
import time
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dataclasses import dataclass

from models import convert_to_ths
from config import get_timezone
from cache_utils import ttl_cache, CircuitBreaker, retry_request
from miner_specs import parse_worker_name
from state_manager import MAX_PAYOUT_HISTORY_ENTRIES

# ---------------------------------------------------------------------------
# Module-level circuit breakers — one per external host.
# Each opens after 5 consecutive failures and resets after 60 s.
# ---------------------------------------------------------------------------
_ocean_circuit = CircuitBreaker(name="api.ocean.xyz", max_failures=5, reset_timeout=60)
_mempool_circuit = CircuitBreaker(name="mempool.guide", max_failures=5, reset_timeout=60)
_exchange_circuit = CircuitBreaker(name="exchange-rates", max_failures=5, reset_timeout=60)


@dataclass
class CachedResponse:
    """Simplified response object storing only relevant fields."""

    ok: bool
    status_code: int
    text: str

    def json(self):
        """Parse JSON from the stored text."""
        return json.loads(self.text)


class OceanApiClientMixin:
    """Mixin providing all Ocean.xyz and external API call methods."""

    @ttl_cache(ttl_seconds=30, maxsize=20)
    def fetch_url(self, url: str, timeout: int = 5):
        """Fetch URL content safely without leaking resources."""

        response = None
        try:
            response = self.session.get(url, timeout=timeout)
            text = response.text
            status_code = response.status_code
            ok = response.ok
            return CachedResponse(ok=ok, status_code=status_code, text=text)
        except Exception as e:
            logging.error(f"Error fetching {url}: {e}")
            return None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def _fetch_ocean_api(self, url: str, timeout: int = 10):
        """Fetch an Ocean.xyz API endpoint with circuit-breaker + retry.

        Wraps ``session.get`` with the module-level Ocean circuit breaker and
        up to 2 retries (backoff: 1 s, 2 s).  Returns the raw
        ``requests.Response`` on success, or ``None`` when the circuit is open
        or all retries fail.

        Args:
            url: Full URL to fetch.
            timeout: Per-request connect+read timeout in seconds.

        Returns:
            A ``requests.Response`` instance, or ``None`` on failure.
        """

        def _do_get():
            return _ocean_circuit.call(self.session.get, url, timeout=timeout)

        return retry_request(_do_get, retries=2, backoff=1.0)

    def _fetch_mempool_api(self, url: str, timeout: int = 10):
        """Fetch a mempool.guide endpoint with circuit-breaker + retry.

        Returns a ``requests.Response`` instance, or ``None`` on failure.
        """

        def _do_get():
            return _mempool_circuit.call(self.session.get, url, timeout=timeout)

        return retry_request(_do_get, retries=2, backoff=1.0)

    def _fetch_exchange_api(self, url: str, timeout: int = 10):
        """Fetch an exchange-rate endpoint with circuit-breaker + retry.

        Returns a ``requests.Response`` instance, or ``None`` on failure.
        """

        def _do_get():
            return _exchange_circuit.call(self.session.get, url, timeout=timeout)

        return retry_request(_do_get, retries=2, backoff=1.0)

    @ttl_cache(ttl_seconds=30, maxsize=1)
    def get_ocean_api_data(self):
        """Fetch mining data using the official Ocean.xyz API.

        All five Ocean.xyz endpoints are fetched concurrently to eliminate 
        serial round-trip latency. Uses a separate thread pool when called from
        within the service's main executor to avoid potential deadlocks.
        Results are cached for 30 s via ``@ttl_cache`` so that ``get_ocean_data()`` 
        and ``fetch_metrics()`` calling this in quick succession share the same data.
        """
        import threading
        from concurrent.futures import ThreadPoolExecutor
        
        api_base = self.API_BASE
        result = {}

        # Check if we're running in a worker thread; if so, use a separate pool
        # to prevent deadlock. Otherwise, use the main executor for consistency.
        current_thread = threading.current_thread()
        use_separate_pool = (
            hasattr(current_thread, 'name') and 
            'ThreadPoolExecutor' in current_thread.name
        )
        
        if use_separate_pool:
            # Use a separate thread pool to avoid deadlock when called from within
            # the service's main executor (e.g., from fetch_metrics)
            executor_context = ThreadPoolExecutor(max_workers=5, thread_name_prefix="ocean-api")
            use_executor = executor_context
        else:
            # Use the main service executor for normal operation
            executor_context = None
            use_executor = self.executor

        try:
            if executor_context:
                executor_context.__enter__()
                
            # --- Fire all Ocean.xyz API calls concurrently ---
            futures = {}
            try:
                futures["user_hashrate"] = use_executor.submit(
                    self._fetch_ocean_api, f"{api_base}/user_hashrate/{self.wallet}", 10
                )
                futures["statsnap"] = use_executor.submit(
                    self._fetch_ocean_api, f"{api_base}/statsnap/{self.wallet}", 10
                )
                futures["pool_stat"] = use_executor.submit(
                    self._fetch_ocean_api, f"{api_base}/pool_stat", 10
                )
                futures["pool_hashrate"] = use_executor.submit(
                    self._fetch_ocean_api, f"{api_base}/pool_hashrate", 10
                )
                futures["blocks"] = use_executor.submit(
                    self._fetch_ocean_api, f"{api_base}/blocks/0/1/0", 10
                )
            except Exception as e:
                logging.error(f"Error submitting Ocean API futures: {e}")

            # --- Collect responses (with individual timeouts) ---
            responses = {}
            for key, fut in futures.items():
                try:
                    responses[key] = fut.result(timeout=12)
                except Exception as e:
                    logging.error(f"Error collecting {key} future: {e}")
                    responses[key] = None
        finally:
            if executor_context:
                executor_context.__exit__(None, None, None)

        # --- Parse user_hashrate ---
        hr_data = {}
        try:
            resp = responses.get("user_hashrate")
            if resp is not None and resp.ok:
                hr_data = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
            result["hashrate_60sec"] = hr_data.get("hashrate_60s")
            result["hashrate_5min"] = hr_data.get("hashrate_300s")
            result["hashrate_10min"] = hr_data.get("hashrate_600s")
            result["hashrate_24hr"] = hr_data.get("hashrate_86400s")
            # Try several keys for a ~3hr interval
            result["hashrate_3hr"] = (
                hr_data.get("hashrate_10800s") or hr_data.get("hashrate_7200s") or hr_data.get("hashrate_3600s")
            )
            # API returns raw H/s — convert to TH/s for dashboard display
            for key in ("hashrate_60sec", "hashrate_5min", "hashrate_10min", "hashrate_24hr", "hashrate_3hr"):
                raw = result.get(key)
                if raw is not None:
                    try:
                        result[key] = convert_to_ths(float(raw), "H/s")
                    except (ValueError, TypeError):
                        pass
            result["hashrate_60sec_unit"] = "th/s"
            result["hashrate_5min_unit"] = "th/s"
            result["hashrate_10min_unit"] = "th/s"
            result["hashrate_24hr_unit"] = "th/s"
            result["hashrate_3hr_unit"] = "th/s"
            # active_worker_count lives in user_hashrate response
            if hr_data.get("active_worker_count") is not None:
                result["workers_hashing"] = hr_data["active_worker_count"]
        except Exception as e:
            logging.error(f"Error parsing user_hashrate API: {e}")

        # --- Parse statsnap ---
        try:
            resp = responses.get("statsnap")
            if resp is not None and resp.ok:
                snap = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
                unpaid = snap.get("unpaid")
                result["unpaid_earnings"] = float(unpaid) if unpaid is not None else None
                earn_next = snap.get("estimated_earn_next_block")
                result["estimated_earnings_next_block"] = float(earn_next) if earn_next is not None else None
                rewards = snap.get("estimated_total_earn_next_block")
                result["estimated_rewards_in_window"] = float(rewards) if rewards is not None else None
                ts = snap.get("lastest_share_ts")
                if ts:
                    dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("UTC")).astimezone(ZoneInfo(get_timezone()))
                    result["total_last_share"] = dt.strftime("%Y-%m-%d %I:%M %p")
        except Exception as e:
            logging.error(f"Error parsing statsnap API: {e}")

        # --- Parse pool_stat + pool_hashrate (replaces get_pool_stat_api) ---
        try:
            resp = responses.get("pool_stat")
            if resp is not None and resp.ok:
                stat = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
                result["workers_hashing"] = stat.get("active_workers") or stat.get("workers")
                result["current_estimated_block_reward"] = stat.get("current_estimated_block_reward")
                result["network_difficulty"] = stat.get("network_difficulty")
        except Exception as e:
            logging.error(f"Error parsing pool_stat API: {e}")

        try:
            resp = responses.get("pool_hashrate")
            if resp is not None and resp.ok:
                ph = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
                raw_hashrate = ph.get("pool_60s") or ph.get("pool_300s")
                if raw_hashrate is not None:
                    result["pool_total_hashrate"] = convert_to_ths(float(raw_hashrate), "H/s")
                    result["pool_total_hashrate_unit"] = "th/s"
        except Exception as e:
            logging.error(f"Error parsing pool_hashrate API: {e}")

        # --- Parse blocks ---
        try:
            resp = responses.get("blocks")
            if resp is not None and resp.ok:
                data = resp.json()
                try:
                    resp.close()
                except Exception:
                    pass
                blocks = data.get("blocks")
                if blocks is None:
                    r = data.get("result")
                    if isinstance(r, dict):
                        blocks = r.get("blocks")
                    elif isinstance(r, list):
                        blocks = r
                if isinstance(blocks, list) and blocks:
                    block = blocks[0]
                    result["last_block_height"] = block.get("height")
                    ts = block.get("time") or block.get("timestamp")
                    if ts:
                        dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("UTC")).astimezone(ZoneInfo(get_timezone()))
                        result["last_block_time"] = dt.strftime("%Y-%m-%d %I:%M %p")
        except Exception as e:
            logging.error(f"Error parsing blocks API: {e}")

        return result

    def get_pool_stat_api(self):
        """Fetch overall pool statistics using /pool_stat and /pool_hashrate."""
        api_base = self.API_BASE
        data = {}
        try:
            url = f"{api_base}/pool_stat"
            resp = self._fetch_ocean_api(url, timeout=10)
            if resp is not None and resp.ok:
                stat = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
                # pool_stat uses "active_workers" (not "workers")
                data["workers_hashing"] = stat.get("active_workers") or stat.get("workers")
                data["current_estimated_block_reward"] = stat.get("current_estimated_block_reward")
                data["network_difficulty"] = stat.get("network_difficulty")
                # pool_stat does NOT contain hashrate or blocks_found
        except Exception as e:
            logging.error(f"Error fetching pool_stat API: {e}")

        # Pool hashrate lives in a separate endpoint
        try:
            url = f"{api_base}/pool_hashrate"
            resp = self._fetch_ocean_api(url, timeout=10)
            if resp is not None and resp.ok:
                ph = resp.json().get("result", {}) or {}
                try:
                    resp.close()
                except Exception:
                    pass
                raw_hashrate = ph.get("pool_60s") or ph.get("pool_300s")
                if raw_hashrate is not None:
                    data["pool_total_hashrate"] = convert_to_ths(float(raw_hashrate), "H/s")
                    data["pool_total_hashrate_unit"] = "th/s"
        except Exception as e:
            logging.error(f"Error fetching pool_hashrate API: {e}")
        return data

    def get_blocks_api(self, page=0, page_size=20, include_legacy=0):
        """Fetch recent block data using /blocks."""
        api_base = self.API_BASE
        try:
            url = f"{api_base}/blocks/{page}/{page_size}/{include_legacy}"
            resp = self._fetch_ocean_api(url, timeout=10)
            if resp is not None and resp.ok:
                data = resp.json()
                try:
                    resp.close()
                except Exception:
                    pass
                blocks = data.get("blocks")
                if blocks is None:
                    result = data.get("result")
                    if isinstance(result, dict):
                        blocks = result.get("blocks")
                    elif isinstance(result, list):
                        blocks = result
                if isinstance(blocks, list):
                    return blocks
        except Exception as e:
            logging.error(f"Error fetching blocks API: {e}")
        return []

    def fetch_exchange_rates(self, base_currency="USD"):
        """
        Fetch currency exchange rates from ExchangeRate API using API key.

        Args:
            base_currency (str): Base currency for rates (default: USD)

        Returns:
            dict: Exchange rates for supported currencies
        """
        now = time.time()
        # Return cached rates if they are still fresh
        if self.exchange_rates_cache["rates"] and now - self.exchange_rates_cache["timestamp"] < self.exchange_rate_ttl:
            return self.exchange_rates_cache["rates"]

        # Get the configured currency and API key
        from config import get_currency, get_exchange_rate_api_key

        selected_currency = get_currency()
        api_key = get_exchange_rate_api_key()

        if not api_key:
            logging.error("Exchange rate API key not configured")
            return {}

        try:
            # Use the configured API key with the v6 exchangerate-api endpoint
            url = f"https://v6.exchangerate-api.com/v6/{api_key}/latest/{base_currency}"
            response = self._fetch_exchange_api(url, timeout=5)

            if response is not None and response.ok:
                data = response.json()
                if data.get("result") == "success":
                    logging.info(f"Successfully fetched exchange rates for {selected_currency}")
                    rates = data.get("conversion_rates", {})
                    # Update cache on success
                    self.exchange_rates_cache = {"rates": rates, "timestamp": now}
                    return rates
                else:
                    logging.error(
                        f"Exchange rate API returned unsuccessful result: {data.get('error_type', 'Unknown error')}"
                    )
                    # Clear cache on failure
                    self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
                    return {}
            elif response is not None:
                logging.error(f"Failed to fetch exchange rates: {response.status_code}")
                try:
                    response.close()
                except Exception:
                    pass
                # Clear cache on failure
                self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
                return {}
            else:
                # Circuit open or all retries failed
                self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
                return {}
        except Exception as e:
            logging.error(f"Error fetching exchange rates: {e}")
            self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
            return {}

    def get_payment_history_api(self, days=360, btc_price=None):
        """Fetch payout history using the Ocean.xyz API."""
        api_base = self.API_BASE
        end_date = datetime.now(ZoneInfo("UTC"))
        start_date = end_date - timedelta(days=days)

        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        url = f"{api_base}/earnpay/{self.wallet}/{start_str}/{end_str}"
        payments = []

        try:
            resp = self._fetch_ocean_api(url, timeout=10)
            if resp is None:
                return None
            if not resp.ok:
                logging.error(f"API earnpay request failed: {resp.status_code}")
                return None

            data = resp.json()
            result_obj = data.get("result", {})
            payouts = result_obj.get("payouts", [])

            for item in payouts:
                ts = item.get("ts")
                txid = item.get("on_chain_txid", "")
                lightning_txid = item.get("lightning_txid", "")
                sats = item.get("total_satoshis_net_paid", 0) or 0
                amount_btc = sats / self.sats_per_btc

                date_iso = None
                date_str = ""
                if ts is not None:
                    try:
                        if isinstance(ts, (int, float)):
                            dt = datetime.fromtimestamp(ts, tz=ZoneInfo("UTC"))
                        else:
                            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                        local_dt = dt.astimezone(ZoneInfo(get_timezone()))
                        date_iso = local_dt.isoformat()
                        date_str = local_dt.strftime("%Y-%m-%d %H:%M")
                    except Exception as e:
                        logging.warning(f"Could not parse payout timestamp '{ts}': {e}")

                payment = {
                    "date": date_str,
                    "txid": txid,
                    "lightning_txid": lightning_txid,
                    "amount_btc": amount_btc,
                    "amount_sats": int(sats),
                    "status": "confirmed",
                    "date_iso": date_iso,
                }

                if btc_price is not None:
                    payment["rate"] = btc_price
                    payment["fiat_value"] = amount_btc * btc_price

                payments.append(payment)

                # Trim to avoid unbounded memory growth
                if len(payments) >= MAX_PAYOUT_HISTORY_ENTRIES:
                    break

            # Limit result size to prevent excessive memory usage
            return payments[:MAX_PAYOUT_HISTORY_ENTRIES]

        except Exception as e:
            logging.error(f"Error fetching payment history from API: {e}")
            return None
        finally:
            if resp:
                try:
                    resp.close()
                except Exception:
                    pass

    def get_worker_data_api(self):
        """Fetch worker data using the Ocean.xyz API."""
        api_base = self.API_BASE
        try:
            url = f"{api_base}/user_hashrate_full/{self.wallet}"
            logging.info(f"Fetching worker data from API: {url}")
            resp = self._fetch_ocean_api(url, timeout=10)
            if resp is None:
                return None
            if not resp.ok:
                logging.error(f"API user_hashrate_full request failed: {resp.status_code}")
                return None

            data = resp.json()
            workers_obj = data.get("workers") or data.get("result", {}).get("workers")
            if not workers_obj:
                # Some API responses may store workers inside 'user_hashrate'
                workers_obj = data.get("user_hashrate", {}).get("workers")

            if not workers_obj:
                # If still empty, maybe the response is a list
                if isinstance(data, list):
                    workers_iter = [(w.get("workername") or w.get("name"), w) for w in data]
                else:
                    logging.warning("No worker info returned from API")
                    return None
            else:
                workers_iter = (
                    workers_obj.items()
                    if isinstance(workers_obj, dict)
                    else [(w.get("workername") or w.get("name"), w) for w in workers_obj]
                )

            workers = []
            total_hashrate = 0
            workers_online = 0
            workers_offline = 0
            invalid_names = ["online", "offline", "status", "worker", "total"]

            for name, info in workers_iter:
                if not name or name.lower() in invalid_names:
                    continue

                hr3 = (
                    info.get("hashrate_10800")
                    or info.get("hashrate_7200")
                    or info.get("hashrate_3600")
                    or info.get("hashrate_300s")
                )
                hr60 = info.get("hashrate_60s") or 0

                status = "online" if (hr60 or hr3) else "offline"

                worker = {
                    "name": name,
                    "status": status,
                    "type": "ASIC",
                    "model": "Unknown",
                    "hashrate_60sec": hr60 or 0,
                    "hashrate_60sec_unit": "H/s",
                    "hashrate_3hr": hr3 or 0,
                    "hashrate_3hr_unit": "H/s",
                    "efficiency": 0,
                    "last_share": "N/A",
                    "earnings": 0,
                    "power_consumption": 0,
                    "temperature": 0,
                }

                if status == "online":
                    workers_online += 1
                else:
                    workers_offline += 1

                specs = parse_worker_name(worker["name"])
                if specs:
                    worker["type"] = specs["type"]
                    worker["model"] = specs["model"]
                    worker["efficiency"] = specs["efficiency"]
                    hr_ths = convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                    worker["power_consumption"] = round(hr_ths * specs["efficiency"])

                total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                workers.append(worker)

            if not workers:
                logging.warning("API worker data returned no valid workers")
                return None

            result = {
                "workers": workers,
                "total_hashrate": total_hashrate,
                "hashrate_unit": "TH/s",
                "workers_total": len(workers),
                "workers_online": workers_online,
                "workers_offline": workers_offline,
                "total_earnings": 0,
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            }

            return result
        except Exception as e:
            logging.error(f"Error in API worker data fetch: {e}")
            return None
        finally:
            if resp:
                try:
                    resp.close()
                except Exception:
                    pass

    @ttl_cache(ttl_seconds=60, maxsize=1)
    def get_bitcoin_stats(self):
        """
        Fetch Bitcoin network statistics with improved error handling and caching.

        Uses a **primary-then-fallback** strategy to eliminate redundant
        requests:

        1. Fire the three mempool.guide endpoints concurrently (hashrate,
           prices, block_height).
        2. If any mempool.guide request fails, try mempool.space for that
           specific endpoint.
        3. Only if the mempool tier still has gaps, fire the corresponding
           blockchain.info fallback — and only for the missing data.

        Returns:
            tuple: (difficulty, network_hashrate, btc_price, block_count)
        """
        # Primary mempool.guide URLs
        mempool_urls = {
            "hashrate": "https://mempool.guide/api/v1/mining/hashrate/3d",
            "prices": "https://mempool.guide/api/v1/prices",
            "block_height": "https://mempool.guide/api/blocks/tip/height",
        }

        # Tier-2 fallback: mempool.space (same API format)
        mempool_space_urls = {
            "hashrate": "https://mempool.space/api/v1/mining/hashrate/3d",
            "prices": "https://mempool.space/api/v1/prices",
            "block_height": "https://mempool.space/api/blocks/tip/height",
        }

        # Tier-3 fallback: blockchain.info (different format, used only if
        # both mempool tiers fail for a given data point)
        blockchain_fallbacks = {
            "difficulty": "https://blockchain.info/q/getdifficulty",
            "hashrate": "https://blockchain.info/q/hashrate",
            "ticker": "https://blockchain.info/ticker",
            "blockcount": "https://blockchain.info/q/getblockcount",
        }

        # Use previous cached values as defaults if available
        difficulty = self.cache.get("difficulty")
        network_hashrate = self.cache.get("network_hashrate")
        btc_price = self.cache.get("btc_price")
        block_count = self.cache.get("block_count")

        responses = {}
        bc_responses = {}
        try:
            # ---- Tier 1: mempool.guide (concurrent) ----
            futures = {}
            for key, url in mempool_urls.items():
                futures[f"mempool_{key}"] = self.executor.submit(self.fetch_url, url)

            for fkey, fut in futures.items():
                try:
                    responses[fkey] = fut.result(timeout=5)
                except Exception as e:
                    logging.warning(f"mempool.guide {fkey} timed out: {e}")
                    responses[fkey] = None

            # ---- Tier 2: mempool.space for any failed mempool.guide calls ----
            for key, url in mempool_space_urls.items():
                mempool_key = f"mempool_{key}"
                resp = responses.get(mempool_key)
                if not resp or not resp.ok:
                    logging.warning(f"mempool.guide {key} failed, trying mempool.space")
                    responses[mempool_key] = self.fetch_url(url)

            # ---- Process price data ----
            mempool_price_response = responses.get("mempool_prices")
            if mempool_price_response and mempool_price_response.ok:
                try:
                    price_data = mempool_price_response.json()
                    if "USD" in price_data:
                        btc_price = float(price_data.get("USD"))
                        self.cache["btc_price"] = btc_price
                        self.cache["btc_price_USD"] = btc_price
                        logging.info(f"Fetched USD price from mempool tier: {btc_price}")
                    for curr, value in price_data.items():
                        if curr != "time":
                            self.cache[f"btc_price_{curr}"] = float(value)
                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing mempool price data: {e}")

            # ---- Process block height ----
            block_height_response = responses.get("mempool_block_height")
            if block_height_response and block_height_response.ok:
                try:
                    block_count = int(block_height_response.text)
                    self.cache["block_count"] = block_count
                    logging.info(f"Fetched block height from mempool tier: {block_count}")
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing mempool block height: {e}")

            # ---- Process hashrate + difficulty ----
            mempool_hashrate_response = responses.get("mempool_hashrate")
            if mempool_hashrate_response and mempool_hashrate_response.ok:
                try:
                    hashrate_data = mempool_hashrate_response.json()
                    network_hashrate = hashrate_data.get("currentHashrate")
                    if "currentDifficulty" in hashrate_data:
                        difficulty = hashrate_data.get("currentDifficulty")
                    self.cache["network_hashrate"] = network_hashrate
                    self.cache["difficulty"] = difficulty
                    logging.info(
                        f"Fetched network hashrate from mempool tier: {network_hashrate/1e18:.2f} EH/s"
                    )
                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing mempool hashrate data: {e}")

            # ---- Tier 3: blockchain.info ONLY for gaps ----
            # Only fire requests for data points that both mempool tiers missed.
            bc_futures = {}
            if btc_price is None:
                bc_futures["ticker"] = self.executor.submit(
                    self.fetch_url, blockchain_fallbacks["ticker"]
                )
            if network_hashrate is None:
                bc_futures["hashrate"] = self.executor.submit(
                    self.fetch_url, blockchain_fallbacks["hashrate"]
                )
            if difficulty is None:
                bc_futures["difficulty"] = self.executor.submit(
                    self.fetch_url, blockchain_fallbacks["difficulty"]
                )
            if block_count is None:
                bc_futures["blockcount"] = self.executor.submit(
                    self.fetch_url, blockchain_fallbacks["blockcount"]
                )

            bc_responses = {}
            for bkey, bfut in bc_futures.items():
                try:
                    bc_responses[bkey] = bfut.result(timeout=5)
                except Exception as e:
                    logging.warning(f"blockchain.info {bkey} timed out: {e}")
                    bc_responses[bkey] = None

            if btc_price is None:
                resp = bc_responses.get("ticker")
                if resp and resp.ok:
                    try:
                        ticker_data = resp.json()
                        btc_price = float(ticker_data.get("USD", {}).get("last", 0))
                        self.cache["btc_price"] = btc_price
                        self.cache["btc_price_USD"] = btc_price
                        logging.info(f"Using blockchain.info price: {btc_price}")
                    except (ValueError, TypeError, json.JSONDecodeError) as e:
                        logging.error(f"Error parsing blockchain.info price: {e}")

            if network_hashrate is None:
                resp = bc_responses.get("hashrate")
                if resp and resp.ok:
                    try:
                        network_hashrate = float(resp.text) * 1e9
                        self.cache["network_hashrate"] = network_hashrate
                        logging.info(f"Using blockchain.info hashrate: {network_hashrate/1e18:.2f} EH/s")
                    except (ValueError, TypeError) as e:
                        logging.error(f"Error parsing blockchain.info hashrate: {e}")

            if difficulty is None:
                resp = bc_responses.get("difficulty")
                if resp and resp.ok:
                    try:
                        difficulty = float(resp.text)
                        self.cache["difficulty"] = difficulty
                    except (ValueError, TypeError) as e:
                        logging.error(f"Error parsing blockchain.info difficulty: {e}")

            if block_count is None:
                resp = bc_responses.get("blockcount")
                if resp and resp.ok:
                    try:
                        block_count = int(resp.text)
                        self.cache["block_count"] = block_count
                        logging.info(f"Using blockchain.info block height: {block_count}")
                    except (ValueError, TypeError) as e:
                        logging.error(f"Error parsing blockchain.info block count: {e}")

        except Exception as e:
            logging.error(f"Error fetching Bitcoin stats: {e}")
        finally:
            # Close all response objects to avoid memory leaks
            all_responses = list(responses.values()) + list(bc_responses.values())
            for resp in all_responses:
                if resp:
                    try:
                        resp.close()
                    except Exception:
                        pass

        return difficulty, network_hashrate, btc_price, block_count
