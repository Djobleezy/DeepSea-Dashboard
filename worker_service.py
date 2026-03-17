"""
Worker service module for managing workers data.

Orchestrates worker data retrieval: tries real Ocean.xyz worker data first,
falls back to simulated data when unavailable. Handles caching and
synchronization with the main dashboard metrics.

Simulation/generation logic lives in ``worker_simulator``; hardware model
catalog lives in ``worker_models``.
"""

import logging
import weakref
from datetime import datetime
from zoneinfo import ZoneInfo

from config import get_timezone
from worker_simulator import (
    create_default_worker,
    generate_default_workers_data,
    generate_sequential_workers,
    generate_simulated_workers,
)


class WorkerService:
    """Service for retrieving and managing worker data."""

    def __init__(self):
        """Initialize the worker service."""
        self.worker_data_cache = None
        self.last_worker_data_update = None
        self.WORKER_DATA_CACHE_TIMEOUT = 60  # Cache worker data for 60 seconds
        self._dashboard_service_ref = None  # Weak reference to dashboard service
        self.sats_per_btc = 100_000_000  # Constant for conversion
        # Track whether the last fetch returned real data or simulated fallback
        self.last_fetch_was_real = False

    # ------------------------------------------------------------------
    # Dashboard service link (weak reference to avoid circular refs)
    # ------------------------------------------------------------------

    @property
    def dashboard_service(self):
        """Return the dashboard service instance if still alive."""
        return self._dashboard_service_ref() if self._dashboard_service_ref else None

    @dashboard_service.setter
    def dashboard_service(self, value):
        """Store a weak reference to the dashboard service."""
        self._dashboard_service_ref = weakref.ref(value) if value else None

    def set_dashboard_service(self, dashboard_service):
        """
        Set the dashboard service instance — to be called from App.py.

        Args:
            dashboard_service (MiningDashboardService): The initialized dashboard service.
        """
        self.dashboard_service = dashboard_service
        if hasattr(dashboard_service, "wallet"):
            self.wallet = dashboard_service.wallet
            logging.info(f"Worker service updated with new wallet: {self.wallet}")
        logging.info("Dashboard service connected to worker service")

    def close(self):
        """Release cached data and drop service references."""
        self.worker_data_cache = None
        self.last_worker_data_update = None
        self.dashboard_service = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_workers_data(self, cached_metrics, force_refresh=False):
        """
        Get worker data with caching for better performance.

        Tries real Ocean.xyz worker data first; falls back to simulated
        data if that fails or returns no valid workers.

        Args:
            cached_metrics (dict): Cached metrics from the dashboard.
            force_refresh (bool): Force a cache bypass when ``True``.

        Returns:
            dict: Worker data with standardized hashrates.
        """
        current_time = datetime.now().timestamp()

        if (
            not force_refresh
            and self.worker_data_cache
            and self.last_worker_data_update
            and (current_time - self.last_worker_data_update) < self.WORKER_DATA_CACHE_TIMEOUT
        ):
            if cached_metrics and cached_metrics.get("workers_hashing") is not None:
                self.sync_worker_counts_with_dashboard(self.worker_data_cache, cached_metrics)
            logging.info("Using cached worker data")
            return self.worker_data_cache

        try:
            if self.dashboard_service:
                logging.info("Attempting to fetch real worker data from Ocean.xyz")
                real_worker_data = self.dashboard_service.get_worker_data()

                if real_worker_data and real_worker_data.get("workers") and len(real_worker_data["workers"]) > 0:
                    valid_names = any(
                        w.get("name", "").lower() not in ["online", "offline", "total", "worker", "status"]
                        for w in real_worker_data["workers"]
                    )

                    if valid_names:
                        logging.info(
                            f"Successfully retrieved {len(real_worker_data['workers'])} real workers from Ocean.xyz"
                        )
                        self.last_fetch_was_real = True

                        if (
                            cached_metrics
                            and cached_metrics.get("arrow_history")
                            and cached_metrics["arrow_history"].get("hashrate_3hr")
                        ):
                            real_worker_data["hashrate_history"] = cached_metrics["arrow_history"]["hashrate_3hr"]

                        if cached_metrics:
                            self.sync_worker_counts_with_dashboard(real_worker_data, cached_metrics)

                        self.worker_data_cache = real_worker_data
                        self.last_worker_data_update = current_time
                        return real_worker_data
                    else:
                        logging.warning(
                            "Real worker data had invalid names (like 'online'/'offline'), "
                            "falling back to simulated data"
                        )
                else:
                    logging.warning("Real worker data fetch returned no workers, falling back to simulated data")
            else:
                logging.warning("Dashboard service not available, cannot fetch real worker data")

            logging.info("Generating fallback simulated worker data")
            worker_data = self.generate_fallback_data(cached_metrics)
            self.last_fetch_was_real = False

            if (
                cached_metrics
                and cached_metrics.get("arrow_history")
                and cached_metrics["arrow_history"].get("hashrate_3hr")
            ):
                worker_data["hashrate_history"] = cached_metrics["arrow_history"]["hashrate_3hr"]

            if cached_metrics:
                self.sync_worker_counts_with_dashboard(worker_data, cached_metrics)

            self.worker_data_cache = worker_data
            self.last_worker_data_update = current_time

            logging.info(f"Successfully generated fallback worker data: {worker_data['workers_total']} workers")
            return worker_data

        except Exception as e:
            logging.error(f"Error getting worker data: {e}")
            fallback_data = self.generate_fallback_data(cached_metrics)
            self.last_fetch_was_real = False
            if cached_metrics:
                self.sync_worker_counts_with_dashboard(fallback_data, cached_metrics)
            return fallback_data

    # ------------------------------------------------------------------
    # Synchronization helpers
    # ------------------------------------------------------------------

    def sync_worker_counts_with_dashboard(self, worker_data, dashboard_metrics):
        """
        Synchronize worker counts and key metrics between worker data and dashboard metrics.

        Args:
            worker_data (dict): Worker data to be updated in-place.
            dashboard_metrics (dict): Dashboard metrics with worker count and other data.
        """
        if not worker_data or not dashboard_metrics:
            return

        dashboard_worker_count = dashboard_metrics.get("workers_hashing")
        if dashboard_worker_count is not None:
            current_worker_count = worker_data.get("workers_total", 0)
            target_count = max(current_worker_count, dashboard_worker_count)

            if current_worker_count != target_count:
                logging.info(
                    "Syncing worker count: worker page(%s) → target(%s)",
                    current_worker_count,
                    target_count,
                )
                worker_data["workers_total"] = target_count
                current_online = worker_data.get("workers_online", 0)
                online_ratio = current_online / max(1, current_worker_count)
                new_online_count = round(target_count * online_ratio)
                worker_data["workers_online"] = new_online_count
                worker_data["workers_offline"] = target_count - new_online_count
                logging.info(
                    "Updated worker counts - Total: %s, Online: %s, Offline: %s",
                    target_count,
                    new_online_count,
                    target_count - new_online_count,
                )
                if "workers" in worker_data and isinstance(worker_data["workers"], list):
                    self.adjust_worker_instances(worker_data, target_count)

        if dashboard_metrics.get("hashrate_3hr") is not None:
            worker_data["total_hashrate"] = dashboard_metrics.get("hashrate_3hr")
            worker_data["hashrate_unit"] = dashboard_metrics.get("hashrate_3hr_unit", "TH/s")
            logging.info(
                f"Synced total hashrate from dashboard: {worker_data['total_hashrate']} {worker_data['hashrate_unit']}"
            )

        if dashboard_metrics.get("daily_mined_sats") is not None:
            daily_sats_value = dashboard_metrics.get("daily_mined_sats")
            if daily_sats_value != worker_data.get("daily_sats"):
                worker_data["daily_sats"] = daily_sats_value
                logging.info(f"Synced daily sats: {worker_data['daily_sats']}")

        if dashboard_metrics.get("unpaid_earnings") is not None:
            unpaid_value = dashboard_metrics.get("unpaid_earnings")
            if isinstance(unpaid_value, str):
                try:
                    unpaid_value = float(unpaid_value.split()[0].replace(",", ""))
                except (ValueError, IndexError):
                    pass
            worker_data["total_earnings"] = unpaid_value

    def adjust_worker_instances(self, worker_data, target_count):
        """
        Adjust the number of worker instances to match the target count.

        Adds cloned workers (with a suffix) or trims from the end to reach
        exactly ``target_count``.

        Args:
            worker_data (dict): Worker data dict containing a ``workers`` list (mutated in-place).
            target_count (int): Target number of worker instances.
        """
        import random as _random

        current_workers = worker_data.get("workers", [])
        current_count = len(current_workers)
        next_index = current_count + 1

        if current_count == target_count:
            return

        if current_count < target_count:
            workers_to_add = target_count - current_count
            online_workers = [w for w in current_workers if w["status"] == "online"]
            offline_workers = [w for w in current_workers if w["status"] == "offline"]
            online_ratio = len(online_workers) / max(1, current_count)
            new_online = round(workers_to_add * online_ratio)
            new_offline = workers_to_add - new_online

            if online_workers and new_online > 0:
                for _ in range(new_online):
                    template = _random.choice(online_workers).copy()
                    template["name"] = f"{template['name']}_{next_index}"
                    current_workers.append(template)
                    next_index += 1

            if offline_workers and new_offline > 0:
                for _ in range(new_offline):
                    template = _random.choice(offline_workers).copy()
                    template["name"] = f"{template['name']}_{next_index}"
                    current_workers.append(template)
                    next_index += 1

            if not online_workers and new_online > 0:
                for _ in range(new_online):
                    current_workers.append(create_default_worker(f"Miner_{next_index}", "online"))
                    next_index += 1

            if not offline_workers and new_offline > 0:
                for _ in range(new_offline):
                    current_workers.append(create_default_worker(f"Miner_{next_index}", "offline"))
                    next_index += 1
        else:
            current_workers = current_workers[:target_count]

        worker_data["workers"] = current_workers
        worker_data["workers_total"] = len(current_workers)
        worker_data["workers_online"] = sum(1 for w in current_workers if w.get("status") == "online")
        worker_data["workers_offline"] = worker_data["workers_total"] - worker_data["workers_online"]

    # ------------------------------------------------------------------
    # Fallback data generation
    # ------------------------------------------------------------------

    def generate_fallback_data(self, cached_metrics):
        """
        Generate fallback worker data from cached metrics when real data can't be fetched.

        Preserves real worker names from the cache when available.

        Args:
            cached_metrics (dict): Cached metrics from the dashboard.

        Returns:
            dict: Generated worker data.
        """
        if not cached_metrics:
            logging.warning("No cached metrics available for worker fallback data")
            return generate_default_workers_data()

        workers_count = cached_metrics.get("workers_hashing")
        try:
            workers_count = int(float(workers_count))
        except (TypeError, ValueError):
            workers_count = None

        if workers_count is None:
            logging.warning("No workers_hashing value in cached metrics, defaulting to 1 worker")
            workers_count = 1
        elif workers_count <= 0:
            logging.warning("No workers reported in metrics, forcing 1 worker")
            workers_count = 1

        original_hashrate_3hr = float(cached_metrics.get("hashrate_3hr", 0) or 0)
        hashrate_unit = cached_metrics.get("hashrate_3hr_unit", "TH/s")

        if original_hashrate_3hr <= 0:
            original_hashrate_3hr = 50.0
            logging.warning(f"Hashrate was 0, setting minimum value of {original_hashrate_3hr} {hashrate_unit}")

        # Reuse real worker names from the previous cache cycle if available
        real_worker_names = []
        if self.worker_data_cache and self.worker_data_cache.get("workers"):
            real_worker_names = [
                w["name"]
                for w in self.worker_data_cache["workers"]
                if w.get("name", "").lower() not in ["online", "offline", "total"]
            ]

        unpaid_earnings = cached_metrics.get("unpaid_earnings", 0)
        if isinstance(unpaid_earnings, str):
            try:
                unpaid_earnings = float(unpaid_earnings.split()[0].replace(",", ""))
            except (ValueError, IndexError):
                unpaid_earnings = 0.001
        if unpaid_earnings is None or unpaid_earnings <= 0:
            unpaid_earnings = 0.001

        if real_worker_names:
            logging.info(f"Using {len(real_worker_names)} real worker names from cache")
            workers_data = generate_simulated_workers(
                workers_count,
                original_hashrate_3hr,
                hashrate_unit,
                total_unpaid_earnings=unpaid_earnings,
                real_worker_names=real_worker_names,
            )
        else:
            logging.info("No real worker names available, using sequential names")
            workers_data = generate_sequential_workers(
                workers_count,
                original_hashrate_3hr,
                hashrate_unit,
                total_unpaid_earnings=unpaid_earnings,
            )

        workers_online = len([w for w in workers_data if w["status"] == "online"])

        # Resolve daily sats — prefer direct value, then derive from other metrics
        daily_sats = cached_metrics.get("daily_mined_sats", 0)
        if not daily_sats:
            if cached_metrics.get("daily_btc_net") is not None:
                daily_sats = int(round(cached_metrics["daily_btc_net"] * self.sats_per_btc))
                logging.info(f"Calculated daily_sats from daily_btc_net: {daily_sats}")
            elif cached_metrics.get("estimated_earnings_per_day") is not None:
                daily_sats = int(round(cached_metrics["estimated_earnings_per_day"] * self.sats_per_btc))
                logging.info(f"Calculated daily_sats from estimated_earnings_per_day: {daily_sats}")
            elif cached_metrics.get("estimated_earnings_per_day_sats") is not None:
                daily_sats = cached_metrics["estimated_earnings_per_day_sats"]
                logging.info(f"Using estimated_earnings_per_day_sats as fallback: {daily_sats}")
        logging.info(f"Final daily_sats value: {daily_sats}")

        hashrate_history = []
        if cached_metrics.get("arrow_history") and cached_metrics["arrow_history"].get("hashrate_3hr"):
            hashrate_history = cached_metrics["arrow_history"]["hashrate_3hr"]

        total_power = sum(w.get("power_consumption", 0) for w in workers_data)

        result = {
            "workers": workers_data,
            "workers_total": len(workers_data),
            "workers_online": workers_online,
            "workers_offline": len(workers_data) - workers_online,
            "total_hashrate": original_hashrate_3hr,
            "hashrate_unit": hashrate_unit,
            "total_earnings": unpaid_earnings,
            "daily_sats": daily_sats,
            "total_power": total_power,
            "hashrate_history": hashrate_history,
            "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
        }

        self.worker_data_cache = result
        self.last_worker_data_update = datetime.now().timestamp()

        logging.info(f"Generated fallback data with {len(workers_data)} workers")
        return result

    # ------------------------------------------------------------------
    # Passthrough helpers (kept for backward compatibility with tests)
    # ------------------------------------------------------------------

    def generate_default_workers_data(self):
        """Delegate to the module-level function in worker_simulator."""
        return generate_default_workers_data()

    def create_default_worker(self, name, status):
        """Delegate to the module-level function in worker_simulator."""
        return create_default_worker(name, status)

    def generate_sequential_workers(self, num_workers, total_hashrate, hashrate_unit, total_unpaid_earnings=None):
        """Delegate to the module-level function in worker_simulator."""
        return generate_sequential_workers(num_workers, total_hashrate, hashrate_unit, total_unpaid_earnings)

    def generate_simulated_workers(
        self, num_workers, total_hashrate, hashrate_unit, total_unpaid_earnings=None, real_worker_names=None
    ):
        """Delegate to the module-level function in worker_simulator."""
        return generate_simulated_workers(
            num_workers, total_hashrate, hashrate_unit, total_unpaid_earnings, real_worker_names
        )
