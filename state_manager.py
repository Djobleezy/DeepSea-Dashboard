"""State manager module for handling persistent state and history.

The manager maintains short lived history for metrics such as hashrate and
profitability. Each collection is limited to ``MAX_HISTORY_ENTRIES`` (180 by
default) which corresponds to roughly three hours of data at one entry per
minute. Older entries are pruned on every save to keep memory usage predictable.
"""

import logging
import json
import time
import gc
import threading
import gzip
import redis
from cache_utils import ttl_cache
from collections import deque
from datetime import datetime
from config import get_timezone

# Historical data structures are now managed by the StateManager instance
# rather than as module level globals.

# Limits for data collections to prevent memory growth
MAX_HISTORY_ENTRIES = 180  # 3 hours worth at 1 min intervals
# Separate history for short-term variance calculations (3 hours)
MAX_VARIANCE_HISTORY_ENTRIES = 180  # 3 hours at 1 min intervals
# Maximum number of minutes to autofill when variance data is missing
MAX_FILL_GAP_MINUTES = 3
# Limit for stored payout records to prevent memory leaks
MAX_PAYOUT_HISTORY_ENTRIES = 100

# Lock for thread safety
state_lock = threading.Lock()


class StateManager:
    """Manager for persistent state and history data."""

    def __init__(self, redis_url=None):
        """
        Initialize the state manager.

        Args:
            redis_url (str, optional): Redis URL for persistent storage
        """
        self.redis_client = self._connect_to_redis(redis_url) if redis_url else None
        self.STATE_KEY = "graph_state"
        self.last_save_time = 0
        self.last_prune_time = 0

        # Initialize in-memory structures for historical data
        self.arrow_history = {}  # Stored per second
        self.hashrate_history = deque(maxlen=MAX_HISTORY_ENTRIES)
        self.metrics_log = deque(maxlen=MAX_HISTORY_ENTRIES)
        self.payout_history = []
        # Maintain short-term history for 3hr variance calculations
        self.variance_history = {}

        # Cache for last successful earnings fetch
        self.last_earnings = {}

        # Load state if available
        self.load_graph_state()
        self.load_payout_history()
        self.load_last_earnings()

    def close(self):
        """Close Redis connection and release resources."""
        if self.redis_client:
            try:
                self.redis_client.close()
            except Exception as e:
                logging.error(f"Error closing Redis connection: {e}")
            finally:
                self.redis_client = None

    def __del__(self):
        """Ensure Redis connection is closed on garbage collection."""
        self.close()

    def _connect_to_redis(self, redis_url):
        """
        Connect to Redis with retry logic.

        Args:
            redis_url (str): Redis URL

        Returns:
            redis.Redis: Redis client or None if connection failed
        """
        if not redis_url:
            logging.info("Redis URL not configured, using in-memory state only.")
            return None

        retry_count = 0
        max_retries = 3

        while retry_count < max_retries:
            try:
                client = redis.Redis.from_url(redis_url)
                client.ping()  # Test the connection
                logging.info(f"Connected to Redis at {redis_url}")
                return client
            except Exception as e:
                retry_count += 1
                if retry_count < max_retries:
                    logging.warning(f"Redis connection attempt {retry_count} failed: {e}. Retrying...")
                    time.sleep(1)  # Wait before retrying
                else:
                    logging.error(f"Could not connect to Redis after {max_retries} attempts: {e}")
                    return None

    @ttl_cache(ttl_seconds=60)
    def load_graph_state(self):
        """Load graph state from Redis with support for the optimized format."""

        if not self.redis_client:
            logging.info("Redis not available, using in-memory state.")
            return

        try:
            # Check version to handle format changes. ``DummyRedis`` used in
            # tests stores plain strings, so handle both ``bytes`` and ``str``
            # gracefully.
            version = self.redis_client.get(f"{self.STATE_KEY}_version")
            if isinstance(version, bytes):
                version = version.decode("utf-8")
            elif not version:
                version = "1.0"
            else:
                version = str(version)

            state_json = self.redis_client.get(self.STATE_KEY)
            if state_json:
                try:
                    if isinstance(state_json, (bytes, bytearray)):
                        try:
                            state_json = gzip.decompress(state_json).decode("utf-8")
                        except OSError:
                            state_json = state_json.decode("utf-8")
                    else:
                        # Stored as plain JSON string
                        state_json = str(state_json)
                except Exception as e:
                    logging.error(f"Error decompressing graph state: {e}")
                    state_json = (
                        state_json.decode("utf-8") if isinstance(state_json, (bytes, bytearray)) else str(state_json)
                    )

                state = json.loads(state_json)

                # Handle different versions of the data format
                if version in ["2.0", "2.1"]:  # Optimized format
                    # Restore arrow_history
                    compact_arrow_history = state.get("arrow_history", {})
                    for key, values in compact_arrow_history.items():
                        self.arrow_history[key] = deque(
                            [
                                {
                                    "time": entry.get("t", ""),
                                    "value": entry.get("v", 0),
                                    "arrow": entry.get("a", ""),
                                    "unit": entry.get("u", "th/s"),
                                }
                                for entry in values
                            ],
                            maxlen=MAX_HISTORY_ENTRIES,
                        )

                    # Restore hashrate_history
                    self.hashrate_history = deque(
                        state.get("hashrate_history", []), maxlen=MAX_HISTORY_ENTRIES
                    )

                    # Restore variance_history if present
                    compact_variance = state.get("variance_history", {})
                    for key, values in compact_variance.items():
                        self.variance_history[key] = deque(
                            [
                                {
                                    "time": datetime.fromisoformat(entry.get("t")),
                                    "value": entry.get("v", 0),
                                }
                                for entry in values
                            ],
                            maxlen=MAX_VARIANCE_HISTORY_ENTRIES,
                        )

                    # Restore metrics_log
                    compact_metrics_log = state.get("metrics_log", [])
                    self.metrics_log = deque(maxlen=MAX_HISTORY_ENTRIES)
                    for entry in compact_metrics_log:
                        metrics = entry.get("m", {})
                        # Convert optimized ``{"value": x}`` entries back to
                        # plain numeric values for backward compatibility.
                        for key, val in list(metrics.items()):
                            if isinstance(val, dict) and "value" in val:
                                metrics[key] = val["value"]
                        self.metrics_log.append({"timestamp": entry.get("ts", ""), "metrics": metrics})
                else:  # Original format
                    raw_history = state.get("arrow_history", {})
                    self.arrow_history = {
                        key: deque(values, maxlen=MAX_HISTORY_ENTRIES) for key, values in raw_history.items()
                    }
                    self.hashrate_history = deque(
                        state.get("hashrate_history", []), maxlen=MAX_HISTORY_ENTRIES
                    )
                    self.metrics_log = deque(state.get("metrics_log", []), maxlen=MAX_HISTORY_ENTRIES)

                logging.info(f"Loaded graph state from Redis (format version {version}).")
            else:
                logging.info("No previous graph state found in Redis.")
        except Exception as e:
            logging.error(f"Error loading graph state from Redis: {e}")

    @ttl_cache(ttl_seconds=60)
    def load_payout_history(self):
        """Load payout history list from Redis."""
        if not self.redis_client:
            return
        try:
            data = self.redis_client.get("payout_history")
            if data:
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                self.payout_history = json.loads(data)
        except Exception as e:
            logging.error(f"Error loading payout history from Redis: {e}")

    def save_graph_state(self):
        """Save graph state to Redis with optimized frequency, pruning, and data reduction."""
        if not self.redis_client:
            logging.info("Redis not available, skipping state save.")
            return

        current_time = time.time()
        if hasattr(self, "last_save_time") and current_time - self.last_save_time < 300:  # 5 minutes
            logging.debug("Skipping Redis save - last save was less than 5 minutes ago")
            return

        self.prune_old_data()

        try:
            # Compact arrow_history with unit preservation
            compact_arrow_history = {}
            for key, values in self.arrow_history.items():
                values_list = list(values)
                if values_list:
                    recent_values = values_list[-180:] if len(values_list) > 180 else values_list
                    compact_arrow_history[key] = [
                        {"t": entry["time"], "v": entry["value"], "a": entry["arrow"], "u": entry.get("unit", "th/s")}
                        for entry in recent_values
                    ]

            # Compact hashrate_history
            compact_hashrate_history = (
                list(self.hashrate_history)[-60:] if len(self.hashrate_history) > 60 else list(self.hashrate_history)
            )

            # Compact metrics_log with unit preservation
            compact_metrics_log = []
            if self.metrics_log:
                recent_logs = list(self.metrics_log)[-30:]
                for entry in recent_logs:
                    metrics_copy = {}
                    original_metrics = entry["metrics"]
                    essential_keys = [
                        "hashrate_60sec",
                        "hashrate_24hr",
                        "btc_price",
                        "workers_hashing",
                        "unpaid_earnings",
                        "difficulty",
                        "network_hashrate",
                        "daily_profit_usd",
                    ]
                    for key in essential_keys:
                        if key in original_metrics:
                            metrics_copy[key] = {
                                "value": original_metrics[key],
                                "unit": original_metrics.get(f"{key}_unit", "th/s"),
                            }
                    compact_metrics_log.append({"ts": entry["timestamp"], "m": metrics_copy})

            # Compact variance_history
            compact_variance_history = {}
            for key, values in self.variance_history.items():
                if values:
                    compact_variance_history[key] = [
                        {"t": entry["time"].isoformat(), "v": entry["value"]}
                        for entry in list(values)[-MAX_VARIANCE_HISTORY_ENTRIES:]
                    ]

            state = {
                "arrow_history": compact_arrow_history,
                "hashrate_history": compact_hashrate_history,
                "metrics_log": compact_metrics_log,
                "variance_history": compact_variance_history,
            }

            state_json = json.dumps(state)
            compressed_state = gzip.compress(state_json.encode())
            data_size_kb = len(compressed_state) / 1024
            logging.info(f"Saving graph state to Redis: {data_size_kb:.2f} KB (optimized format, gzipped)")

            self.redis_client.set(f"{self.STATE_KEY}_version", "2.1")
            self.redis_client.set(self.STATE_KEY, compressed_state)
            logging.info(f"Successfully saved graph state to Redis ({data_size_kb:.2f} KB)")
            # Update timestamp after successful save
            self.last_save_time = current_time
        except Exception as e:
            logging.error(f"Error saving graph state to Redis: {e}")

    def prune_old_data(self, aggressive=False):
        """
        Remove old data to prevent memory growth with optimized strategy.

        Args:
            aggressive (bool): If True, be more aggressive with pruning
        """
        current_time = time.time()
        if hasattr(self, "last_prune_time") and current_time - self.last_prune_time < 300:
            logging.debug("Skipping prune - last prune was less than 5 minutes ago")
            return

        with state_lock:
            # Set thresholds based on aggressiveness
            max_history = MAX_HISTORY_ENTRIES // 2 if aggressive else MAX_HISTORY_ENTRIES

            # Prune arrow_history with more sophisticated approach
            for key in self.arrow_history:
                history_list = list(self.arrow_history[key])
                if len(history_list) > max_history:
                    # For most recent data (last hour) - keep every point
                    recent_data = history_list[-60:]

                    # For older data, reduce resolution by keeping fewer points when aggressive
                    older_data = history_list[:-60]
                    if len(older_data) > 0:
                        step = 3 if aggressive else 2
                        sparse_older_data = [older_data[i] for i in range(0, len(older_data), step)]
                        history_list = sparse_older_data + recent_data
                    else:
                        history_list = recent_data

                    self.arrow_history[key] = deque(history_list, maxlen=MAX_HISTORY_ENTRIES)
                    logging.info(f"Pruned {key} history from original state to {len(self.arrow_history[key])} entries")

            # Prune metrics_log more aggressively
            if len(self.metrics_log) > max_history:
                # Keep most recent entries at full resolution
                recent_logs = list(self.metrics_log)[-60:]

                # Reduce resolution of older entries
                older_logs = list(self.metrics_log)[:-60]
                if len(older_logs) > 0:
                    step = 4 if aggressive else 3  # More aggressive step
                    sparse_older_logs = [older_logs[i] for i in range(0, len(older_logs), step)]
                    new_logs = sparse_older_logs + recent_logs
                    self.metrics_log = deque(new_logs, maxlen=MAX_HISTORY_ENTRIES)
                    logging.info(f"Pruned metrics log to {len(self.metrics_log)} entries")

            # Free memory more aggressively
            gc.collect()

        # Update timestamp after a successful prune
        self.last_prune_time = current_time

    def persist_critical_state(self, cached_metrics, scheduler_last_successful_run, last_metrics_update_time):
        """
        Store critical state in Redis for recovery after worker restarts.

        Args:
            cached_metrics (dict): Current metrics
            scheduler_last_successful_run (float): Timestamp of last successful scheduler run
            last_metrics_update_time (float): Timestamp of last metrics update
        """
        if not self.redis_client:
            return

        try:
            # Only persist if we have valid data
            if cached_metrics and cached_metrics.get("server_timestamp"):
                state = {
                    "cached_metrics_timestamp": cached_metrics.get("server_timestamp"),
                    "last_successful_run": scheduler_last_successful_run,
                    "last_update_time": last_metrics_update_time,
                }
                self.redis_client.set("critical_state", json.dumps(state))
                logging.info(f"Persisted critical state to Redis, timestamp: {cached_metrics.get('server_timestamp')}")
        except Exception as e:
            logging.error(f"Error persisting critical state: {e}")

    def load_critical_state(self):
        """
        Recover critical state variables after a worker restart.

        Returns:
            tuple: (last_successful_run, last_update_time)
        """
        if not self.redis_client:
            return None, None

        try:
            state_json = self.redis_client.get("critical_state")
            if state_json:
                if isinstance(state_json, bytes):
                    state_json = state_json.decode("utf-8")
                else:
                    state_json = str(state_json)
                state = json.loads(state_json)
                last_successful_run = state.get("last_successful_run")
                last_update_time = state.get("last_update_time")

                logging.info(f"Loaded critical state from Redis, last run: {last_successful_run}")

                # We don't restore cached_metrics itself, as we'll fetch fresh data
                # Just note that we have state to recover from
                logging.info(f"Last metrics timestamp from Redis: {state.get('cached_metrics_timestamp')}")

                return last_successful_run, last_update_time
        except Exception as e:
            logging.error(f"Error loading critical state: {e}")

        return None, None

    def update_metrics_history(self, metrics):
        """
        Update history collections with new metrics data.

        Args:
            metrics (dict): New metrics data
        """
        # Skip if metrics is None
        if not metrics:
            return

        arrow_keys = [
            "pool_total_hashrate",
            "hashrate_24hr",
            "hashrate_3hr",
            "hashrate_10min",
            "hashrate_60sec",
            "block_number",
            "btc_price",
            "network_hashrate",
            "difficulty",
            "daily_revenue",
            "daily_power_cost",
            "daily_profit_usd",
            "monthly_profit_usd",
            "daily_mined_sats",
            "monthly_mined_sats",
            "unpaid_earnings",
            "estimated_earnings_per_day_sats",
            "estimated_earnings_next_block_sats",
            "estimated_rewards_in_window_sats",
            "workers_hashing",
        ]

        # --- Bucket by second (Los Angeles Time) with thread safety ---
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from datetime import timedelta

        current_second = datetime.now(ZoneInfo(get_timezone())).strftime("%H:%M:%S")

        with state_lock:
            for key in arrow_keys:
                if metrics.get(key) is not None:
                    current_val = metrics[key]
                    arrow = ""

                    # Get the corresponding unit key if available
                    unit_key = f"{key}_unit"
                    current_unit = metrics.get(unit_key, "")

                    if key in self.arrow_history and self.arrow_history[key]:
                        try:
                            previous_val = self.arrow_history[key][-1]["value"]
                            previous_unit = self.arrow_history[key][-1].get("unit", "")
                            previous_arrow = self.arrow_history[key][-1].get("arrow", "")  # Get previous arrow

                            # Use the convert_to_ths function to normalize both values before comparison
                            if key.startswith("hashrate") and current_unit:
                                from models import convert_to_ths

                                norm_curr_val = convert_to_ths(float(current_val), current_unit)
                                norm_prev_val = convert_to_ths(
                                    float(previous_val), previous_unit if previous_unit else "th/s"
                                )

                                # Lower the threshold to 0.05% for more sensitivity
                                if norm_curr_val > norm_prev_val * 1.0001:
                                    arrow = "↑"
                                elif norm_curr_val < norm_prev_val * 0.9999:
                                    arrow = "↓"
                                else:
                                    arrow = previous_arrow  # Preserve previous arrow if change is insignificant
                            else:
                                # For non-hashrate values or when units are missing
                                # Try to convert to float for comparison
                                try:
                                    curr_float = float(current_val)
                                    prev_float = float(previous_val)

                                    # Lower the threshold to 0.05% for more sensitivity
                                    if curr_float > prev_float * 1.0001:
                                        arrow = "↑"
                                    elif curr_float < prev_float * 0.9999:
                                        arrow = "↓"
                                    else:
                                        arrow = previous_arrow  # Preserve previous arrow
                                except (ValueError, TypeError):
                                    # If values can't be converted to float, compare directly
                                    if current_val != previous_val:
                                        arrow = "↑" if current_val > previous_val else "↓"
                                    else:
                                        arrow = previous_arrow  # Preserve previous arrow
                        except Exception as e:
                            logging.error(f"Error calculating arrow for {key}: {e}")
                            # Keep previous arrow on error instead of empty string
                            if self.arrow_history[key] and self.arrow_history[key][-1].get("arrow"):
                                arrow = self.arrow_history[key][-1]["arrow"]

                    if key not in self.arrow_history:
                        self.arrow_history[key] = deque(maxlen=MAX_HISTORY_ENTRIES)

                    if not self.arrow_history[key] or self.arrow_history[key][-1]["time"] != current_second:
                        # Create new entry
                        entry = {
                            "time": current_second,
                            "value": current_val,
                            "arrow": arrow,
                        }
                        # Add unit information if available
                        if current_unit:
                            entry["unit"] = current_unit

                        self.arrow_history[key].append(entry)
                    else:
                        # Update existing entry
                        self.arrow_history[key][-1]["value"] = current_val
                        # Only update arrow if it's not empty - this preserves arrows between changes
                        if arrow:
                            self.arrow_history[key][-1]["arrow"] = arrow
                        # Update unit if available
                        if current_unit:
                            self.arrow_history[key][-1]["unit"] = current_unit

            # --- Update history for variance calculations ---
            variance_keys = [
                "estimated_earnings_per_day_sats",
                "estimated_earnings_next_block_sats",
                "estimated_rewards_in_window_sats",
                "network_hashrate",
            ]
            now = datetime.now(ZoneInfo(get_timezone()))
            window_start = now - timedelta(hours=3)

            for key in variance_keys:
                if metrics.get(key) is None:
                    continue

                if key not in self.variance_history:
                    self.variance_history[key] = deque(maxlen=MAX_VARIANCE_HISTORY_ENTRIES)

                history = self.variance_history[key]
                # Remove entries older than 3 hours
                while history and history[0]["time"] < window_start:
                    history.popleft()

                # Autofill small gaps with the last known value
                if history:
                    last_time = history[-1]["time"]
                    gap_minutes = int((now - last_time).total_seconds() // 60) - 1
                    if 0 < gap_minutes <= MAX_FILL_GAP_MINUTES:
                        last_value = history[-1]["value"]
                        for _ in range(gap_minutes):
                            last_time += timedelta(minutes=1)
                            history.append({"time": last_time, "value": last_value})

                history.append({"time": now, "value": metrics[key]})

                if history:
                    earliest_time = history[0]["time"]
                    elapsed_minutes = int((now - earliest_time).total_seconds() // 60) + 1
                    progress = max(len(history), elapsed_minutes) / MAX_VARIANCE_HISTORY_ENTRIES * 100
                else:
                    progress = 0
                metrics[f"{key}_variance_progress"] = round(progress)

                # Find the earliest non-zero value to use as baseline
                baseline_entry = next((h for h in history if h["value"] != 0), None)

                if baseline_entry and progress >= 100:
                    baseline = baseline_entry["value"]
                    metrics[f"{key}_variance_3hr"] = metrics[key] - baseline
                else:
                    metrics[f"{key}_variance_3hr"] = None

            # --- Aggregate arrow_history by minute for the graph ---
            aggregated_history = {}
            for key, entries in self.arrow_history.items():
                minute_groups = {}
                for entry in entries:
                    minute = entry["time"][:5]  # extract HH:MM
                    minute_groups[minute] = entry  # take last entry for that minute

                # Sort by time to ensure chronological order
                aggregated_history[key] = sorted(list(minute_groups.values()), key=lambda x: x["time"])

                # Only keep the most recent 60 data points for the graph display
                aggregated_history[key] = (
                    aggregated_history[key][-MAX_HISTORY_ENTRIES:]
                    if len(aggregated_history[key]) > MAX_HISTORY_ENTRIES
                    else aggregated_history[key]
                )

            metrics["arrow_history"] = aggregated_history
            metrics["history"] = list(self.hashrate_history)

            # Store a lightweight snapshot in metrics_log to avoid memory growth
            snapshot = metrics.copy()
            snapshot.pop("arrow_history", None)
            snapshot.pop("history", None)

            entry = {"timestamp": datetime.now().isoformat(), "metrics": snapshot}
            self.metrics_log.append(entry)

    def save_notifications(self, notifications):
        """Save notifications to persistent storage."""
        try:
            # If we have Redis, use it
            if self.redis_client:
                notifications_json = json.dumps(notifications)
                self.redis_client.set("dashboard_notifications", notifications_json)
                return True
            else:
                # Otherwise just keep in memory
                return True
        except Exception as e:
            logging.error(f"Error saving notifications: {e}")
            return False

    def get_notifications(self):
        """Retrieve notifications from persistent storage."""
        try:
            # If we have Redis, use it
            if self.redis_client:
                notifications_json = self.redis_client.get("dashboard_notifications")
                if notifications_json:
                    return json.loads(notifications_json)

            # Return empty list if not found or no Redis
            return []
        except Exception as e:
            logging.error(f"Error retrieving notifications: {e}")
            return []

    # ------------------------------------------------------------------
    # Accessors for historical data structures
    # ------------------------------------------------------------------
    def get_history(self):
        """Return the in-memory arrow history."""
        return self.arrow_history

    def get_metrics_log(self):
        """Return the metrics log list."""
        return self.metrics_log

    def get_hashrate_history(self):
        """Return the legacy hashrate history list."""
        return self.hashrate_history

    def clear_arrow_history(self, keys=None):
        """Clear arrow history for specified keys or all."""
        with state_lock:
            if keys is None:
                self.arrow_history.clear()
            else:
                for key in keys:
                    if key in self.arrow_history:
                        self.arrow_history[key] = deque(maxlen=MAX_HISTORY_ENTRIES)

    # ------------------------------------------------------------------
    # Payout history management
    # ------------------------------------------------------------------
    def get_payout_history(self):
        """Return the payout history list."""
        return self.payout_history

    def save_payout_history(self, history):
        """Save payout history to Redis and memory, keeping the newest entries."""
        try:
            # Trim to the most recent MAX_PAYOUT_HISTORY_ENTRIES records
            if len(history) > MAX_PAYOUT_HISTORY_ENTRIES:
                history = history[-MAX_PAYOUT_HISTORY_ENTRIES:]

            self.payout_history = history
            if self.redis_client:
                self.redis_client.set("payout_history", json.dumps(history))
            return True
        except Exception as e:
            logging.error(f"Error saving payout history: {e}")
            return False

    def clear_payout_history(self):
        """Clear payout history from memory and Redis."""
        self.payout_history = []
        try:
            if self.redis_client:
                self.redis_client.delete("payout_history")
        except Exception as e:
            logging.error(f"Error clearing payout history from Redis: {e}")

    # ------------------------------------------------------------------
    # Last earnings caching
    # ------------------------------------------------------------------
    @ttl_cache(ttl_seconds=60)
    def load_last_earnings(self):
        """Load last successful earnings data from Redis."""
        if not self.redis_client:
            return
        try:
            data = self.redis_client.get("last_earnings")
            if data:
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                self.last_earnings = json.loads(data)
        except Exception as e:
            logging.error(f"Error loading last earnings from Redis: {e}")

    def save_last_earnings(self, earnings):
        """Save earnings data to Redis and memory."""
        try:
            self.last_earnings = earnings
            if self.redis_client:
                self.redis_client.set("last_earnings", json.dumps(earnings))
            return True
        except Exception as e:
            logging.error(f"Error saving last earnings: {e}")
            return False

    def get_last_earnings(self):
        """Return the last cached earnings data."""
        return self.last_earnings
