"""
Data service module for fetching and processing mining data.

This is the public facade — all external code should import from here.
Internally, functionality is split across:
  - ocean_api_client.py  — HTTP API calls
  - ocean_scraper.py     — BeautifulSoup HTML parsing
  - metrics_calculator.py — earnings/profit math
"""

import gc  # noqa: F401 — kept so tests can patch data_service.gc
import logging
import time  # noqa: F401 — kept so tests can patch data_service.time
from datetime import datetime
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor

import requests  # noqa: F401 — used by connection_pool consumers
from bs4 import BeautifulSoup  # noqa: F401 — kept for backward compat

from models import OceanData, convert_to_ths  # noqa: F401 — kept for backward compat
from connection_pool import create_optimized_session
from config import get_timezone  # noqa: F401 — kept for backward compat
from cache_utils import ttl_cache  # noqa: F401 — kept for backward compat
from miner_specs import parse_worker_name  # noqa: F401 — kept for backward compat
from state_manager import MAX_PAYOUT_HISTORY_ENTRIES  # noqa: F401 — kept for backward compat

# Re-export top-level symbols so existing `from data_service import ...` works
from ocean_api_client import CachedResponse  # noqa: F401
from ocean_scraper import cleanup_soup  # noqa: F401
from metrics_calculator import parse_payment_date  # noqa: F401

# Import mixins
from ocean_api_client import OceanApiClientMixin
from ocean_scraper import OceanScraperMixin
from metrics_calculator import MetricsCalculatorMixin

# ---------------------------------------------------------------------------
# API Field Coverage Map (DS-01)
# ---------------------------------------------------------------------------
# Documents which OceanData fields are populated by the official Ocean.xyz
# REST API vs. HTML scraping.  Used by get_ocean_data() to skip redundant
# scrape work when the API has already filled a field.
#
# Columns:
#   api_endpoint  - Ocean.xyz API endpoint that provides the value (or None)
#   scrape_source - HTML element id or description scraped as fallback / supplement
#   status        - "api-primary"  : API covers it; scrape only fills gaps
#                   "scrape-only"  : no API equivalent; must scrape
#                   "both"         : API + scrape used together (e.g., payout snap)
# ---------------------------------------------------------------------------
API_FIELD_COVERAGE = {
    # ---- Hashrates ----
    "hashrate_60sec": {
        "api_endpoint": "user_hashrate (hashrate_60s)",
        "scrape_source": "hashrates-tablerows",
        "status": "api-primary",
    },
    "hashrate_5min": {
        "api_endpoint": "user_hashrate (hashrate_300s)",
        "scrape_source": "hashrates-tablerows",
        "status": "api-primary",
    },
    "hashrate_10min": {
        "api_endpoint": "user_hashrate (hashrate_600s)",
        "scrape_source": "hashrates-tablerows",
        "status": "api-primary",
    },
    "hashrate_3hr": {
        "api_endpoint": "user_hashrate (hashrate_10800/7200/3600)",
        "scrape_source": "hashrates-tablerows",
        "status": "api-primary",
    },
    "hashrate_24hr": {
        "api_endpoint": "user_hashrate (hashrate_86400s)",
        "scrape_source": "hashrates-tablerows",
        "status": "api-primary",
    },
    # ---- Pool-level stats ----
    "pool_total_hashrate": {
        "api_endpoint": "pool_hashrate (pool_60s)",
        "scrape_source": "pool-status-item",
        "status": "api-primary",
    },
    "workers_hashing": {
        "api_endpoint": "pool_stat (active_workers) + user_hashrate (active_worker_count)",
        "scrape_source": "usersnap-statcards",
        "status": "api-primary",
    },
    "blocks_found": {
        "api_endpoint": None,
        "scrape_source": "blocks-found div",
        "status": "scrape-only",
        "notes": "pool_stat does not expose blocks_found",
    },
    # ---- Last block ----
    "last_block_height": {
        "api_endpoint": "blocks (height)",
        "scrape_source": "pool-status-item (LAST BLOCK span)",
        "status": "api-primary",
    },
    "last_block_time": {
        "api_endpoint": "blocks (time/timestamp)",
        "scrape_source": "pool-status-item (LAST BLOCK span)",
        "status": "api-primary",
    },
    # ---- User / payout stats ----
    "unpaid_earnings": {
        "api_endpoint": "statsnap (unpaid)",
        "scrape_source": "usersnap-statcards",
        "status": "api-primary",
    },
    "estimated_earnings_next_block": {
        "api_endpoint": "statsnap (estimated_earn_next_block)",
        "scrape_source": "payoutsnap-statcards",
        "status": "api-primary",
    },
    "estimated_rewards_in_window": {
        "api_endpoint": "statsnap (shares_in_tides)",
        "scrape_source": "payoutsnap-statcards",
        "status": "api-primary",
    },
    "total_last_share": {
        "api_endpoint": "statsnap (lastest_share_ts)",
        "scrape_source": "workers-tablerows (Total row)",
        "status": "api-primary",
    },
    # ---- Scrape-only (no API equivalent) ----
    "pool_fees_percentage": {
        "api_endpoint": None,
        "scrape_source": "earnings-tablerows (col 3/4 ratio)",
        "status": "scrape-only",
        "note": "Derived from BTC earnings vs pool-fees columns; no API field available.",
    },
    "last_block_earnings": {
        "api_endpoint": None,
        "scrape_source": "earnings-tablerows (col 2 BTC value → sats)",
        "status": "scrape-only",
        "note": "Earnings for the most recent block payout; not exposed by API.",
    },
    "estimated_earnings_per_day": {
        "api_endpoint": None,
        "scrape_source": "lifetimesnap-statcards (earnings/day card)",
        "status": "scrape-only",
        "note": "Pool-displayed estimate; no direct API equivalent.",
    },
    "est_time_to_payout": {
        "api_endpoint": None,
        "scrape_source": "usersnap-statcards (est time until minimum payout)",
        "status": "scrape-only",
        "note": "Human-readable time string only available via HTML.",
    },
}


class MiningDashboardService(OceanApiClientMixin, OceanScraperMixin, MetricsCalculatorMixin):
    """Service for fetching and processing mining dashboard data."""

    def __init__(self, power_cost, power_usage, wallet, network_fee=0.0, worker_service=None):
        """
        Initialize the mining dashboard service.

        Args:
            power_cost (float): Cost of power in $ per kWh
            power_usage (float): Power usage in watts
            wallet (str): Bitcoin wallet address for Ocean.xyz
            network_fee (float): Additional network fee percentage
        """
        self.API_BASE = "https://api.ocean.xyz/v1"
        self.power_cost = power_cost
        self.power_usage = power_usage
        self.wallet = wallet
        self.network_fee = network_fee
        self.worker_service = worker_service
        self.cache = {}
        self.sats_per_btc = 100_000_000
        self.previous_values = {}
        self.cached_metrics = None
        # Use optimized session with connection pooling
        self.session = create_optimized_session()
        # Persistent executor for concurrent tasks
        self.executor = ThreadPoolExecutor(max_workers=6)
        # Cache for storing fetched currency exchange rates
        self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
        # Time-to-live (TTL) for exchange rate cache in seconds (~2 hours)
        self.exchange_rate_ttl = 7200
        # Record the service start time to report consistent uptime
        self.server_start_time = datetime.now(ZoneInfo(get_timezone()))
        # Track whether the service has been closed
        self._closed = False

    def set_worker_service(self, worker_service):
        """Associate a WorkerService instance for power estimation."""
        self.worker_service = worker_service

    def get_connection_pool_stats(self):
        """Get statistics about HTTP connection pools."""
        from connection_pool import get_pool_stats
        return get_pool_stats(self.session)

    def purge_caches(self):
        """Purge or clear ttl_cache caches to free memory."""
        for attr_name in dir(self):
            attr = getattr(self, attr_name)
            if hasattr(attr, "cache_purge"):
                try:
                    attr.cache_purge()
                except Exception:
                    pass
            if hasattr(attr, "cache_clear"):
                try:
                    attr.cache_clear()
                except Exception:
                    pass

    def close(self):
        """Close any open network resources."""
        if getattr(self, "_closed", False):
            root_logger = logging.getLogger()
            try:
                # Only log if at least one handler has an open stream
                if any(
                    getattr(h, "stream", None) and not getattr(h.stream, "closed", False)
                    for h in root_logger.handlers
                ):
                    logging.warning("Service already closed")
            except Exception:
                pass
            return

        self._closed = True
        try:
            # Clear any ttl_cache caches on the instance
            for attr_name in dir(self):
                attr = getattr(self, attr_name)
                if hasattr(attr, "cache_clear"):
                    try:
                        attr.cache_clear()
                    except Exception:
                        pass

            # Close associated worker service to prevent memory leaks
            if self.worker_service and hasattr(self.worker_service, "close"):
                try:
                    self.worker_service.close()
                except Exception:
                    pass
            self.worker_service = None

            # Cancel any pending futures and shutdown executor
            try:
                from inspect import signature

                shutdown_params = signature(self.executor.shutdown).parameters
                if "cancel_futures" in shutdown_params:
                    self.executor.shutdown(wait=True, cancel_futures=True)
                else:
                    self.executor.shutdown(wait=True)
            except Exception:
                # Fall back if we cannot introspect the signature
                try:
                    self.executor.shutdown(wait=True)
                except Exception:
                    pass

            # Release the executor reference to free threads
            self.executor = None

            # Close session and underlying adapters
            try:
                self.session.close()
            finally:
                if hasattr(self.session, "adapters"):
                    for adapter in self.session.adapters.values():
                        try:
                            adapter.close()
                        except Exception:
                            pass
                # Drop the session reference to free connection pools
                self.session = None
        except Exception as e:
            logging.error(f"Error closing session: {e}")

    def __del__(self):
        """Ensure resources are released when the service is garbage collected."""
        try:
            if not getattr(self, "_closed", False):
                self.close()
        except Exception:
            pass
