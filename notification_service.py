# notification_service.py
import logging
import uuid
import weakref
import pytz
import re
from datetime import datetime, timedelta, timezone, tzinfo
from enum import Enum
from typing import List, Dict, Any, Optional
from config import get_timezone, load_config

from data_service import MiningDashboardService

# Constants to replace magic values
ONE_DAY_SECONDS = 86400
DEFAULT_TARGET_HOUR = 12
SIGNIFICANT_HASHRATE_CHANGE_PERCENT = 25
NOTIFICATION_WINDOW_MINUTES = 5


class NotificationLevel(Enum):
    """Severity levels for dashboard notifications."""

    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class NotificationCategory(Enum):
    """Categories for grouping notifications."""

    HASHRATE = "hashrate"
    BLOCK = "block"
    WORKER = "worker"
    EARNINGS = "earnings"
    SYSTEM = "system"


# Currency utility functions
def get_currency_symbol(currency):
    """Return symbol for the specified currency"""
    symbols = {
        "USD": "$",
        "EUR": "€",
        "GBP": "£",
        "JPY": "¥",
        "CAD": "CA$",
        "AUD": "A$",
        "CNY": "¥",
        "KRW": "₩",
        "BRL": "R$",
        "CHF": "Fr",
    }
    return symbols.get(currency, "$")


def format_currency_value(value, currency, exchange_rates):
    """Format a USD value in the selected currency"""
    if value is None or value == "N/A":
        return "N/A"

    # Get exchange rate (default to 1.0 if not found)
    exchange_rate = exchange_rates.get(currency, 1.0)
    converted_value = value * exchange_rate

    # Get currency symbol
    symbol = get_currency_symbol(currency)

    # Format with or without decimals based on currency
    if currency in ["JPY", "KRW"]:
        return f"{symbol}{int(converted_value):,}"
    else:
        return f"{symbol}{converted_value:.2f}"


def get_exchange_rates(dashboard_service: MiningDashboardService = None):
    """Get exchange rates with caching.

    If no service is provided, a temporary one is created and closed after use.
    """
    temp_service = None
    try:
        if dashboard_service is None:
            temp_service = MiningDashboardService(0, 0, "", 0)
            dashboard_service = temp_service

        exchange_rates = dashboard_service.fetch_exchange_rates()
        return exchange_rates
    except Exception as e:
        logging.error(f"Error fetching exchange rates for notifications: {e}")
        return {}  # Return empty dict if failed
    finally:
        if temp_service is not None:
            try:
                temp_service.close()
            except Exception as e:
                logging.error(f"Error closing temporary service: {e}")


class NotificationService:
    """Service for managing mining dashboard notifications."""

    def __init__(self, state_manager, dashboard_service=None):
        """Initialize with state manager for persistence."""
        self.state_manager = state_manager
        if dashboard_service is not None:
            try:
                self._dashboard_service_ref = weakref.ref(dashboard_service)
            except TypeError:
                self._dashboard_service_ref = None
        else:
            self._dashboard_service_ref = None
        self.notifications = []
        self.daily_stats_time = "00:00:00"  # When to post daily stats (midnight)
        self.last_daily_stats = None
        self.max_notifications = 100  # Maximum number to store
        self.last_block_height = None  # Track the last seen block height
        self.last_payout_notification_time = None  # Track the last payout notification time
        self.last_estimated_payout_time = None  # Track the last estimated payout time

        # Load existing notifications from state
        self._load_notifications()

        # Ensure stored notifications use the current currency
        try:
            self.update_notification_currency()
        except Exception as e:
            logging.error(f"[NotificationService] Failed to sync notification currency on init: {e}")

        # Load last block height from state
        self._load_last_block_height()

    @property
    def dashboard_service(self):
        """Return the dashboard service if it is still alive."""
        return self._dashboard_service_ref() if self._dashboard_service_ref else None

    @dashboard_service.setter
    def dashboard_service(self, value):
        """Set the dashboard service using a weak reference."""
        if value is not None:
            try:
                self._dashboard_service_ref = weakref.ref(value)
            except TypeError:
                self._dashboard_service_ref = None
        else:
            self._dashboard_service_ref = None

    def _get_current_time(self) -> datetime:
        """Get current datetime with the configured timezone."""
        try:
            tz = pytz.timezone(get_timezone())
            if not isinstance(tz, tzinfo):
                raise TypeError("Timezone object must derive from tzinfo")
        except Exception as e:
            logging.error(f"[NotificationService] Error getting timezone: {e}")
            tz = getattr(pytz, "utc", timezone.utc)
        return datetime.now(tz)

    def _parse_timestamp(self, timestamp_str: str) -> datetime:
        """Parse an ISO timestamp string into a timezone-aware datetime."""
        try:
            # Support timestamps that end with 'Z' for UTC designator
            ts = timestamp_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts)

            # If it's already timezone-aware, return it
            if dt.tzinfo is not None:
                return dt

            # Otherwise, localize to configured timezone
            tz = pytz.timezone(get_timezone())
            return tz.localize(dt)
        except Exception as e:
            logging.error(f"[NotificationService] Error parsing timestamp: {e}")
            return self._get_current_time()

    def _get_redis_value(self, key: str, default: Any = None) -> Any:
        """Generic method to retrieve values from Redis."""
        try:
            if hasattr(self.state_manager, "redis_client") and self.state_manager.redis_client:
                value = self.state_manager.redis_client.get(key)
                if value:
                    return value.decode("utf-8")
            return default
        except Exception as e:
            logging.error(f"[NotificationService] Error retrieving {key} from Redis: {e}")
            return default

    def _set_redis_value(self, key: str, value: Any) -> bool:
        """Generic method to set values in Redis."""
        try:
            if hasattr(self.state_manager, "redis_client") and self.state_manager.redis_client:
                self.state_manager.redis_client.set(key, str(value))
                logging.info(f"[NotificationService] Saved {key} to Redis: {value}")
                return True
            return False
        except Exception as e:
            logging.error(f"[NotificationService] Error saving {key} to Redis: {e}")
            return False

    def _load_notifications(self) -> None:
        """Load notifications with enhanced error handling."""
        try:
            stored_notifications = self.state_manager.get_notifications()
            if stored_notifications:
                self.notifications = stored_notifications
                logging.info(f"[NotificationService] Loaded {len(self.notifications)} notifications from storage")
            else:
                self.notifications = []
                logging.info("[NotificationService] No notifications found in storage, starting with empty list")
        except Exception as e:
            logging.error(f"[NotificationService] Error loading notifications: {e}")
            self.notifications = []  # Ensure we have a valid list

    def _load_last_block_height(self) -> None:
        """Load last block height from persistent storage."""
        try:
            self.last_block_height = self._get_redis_value("last_block_height")
            if self.last_block_height:
                logging.info(f"[NotificationService] Loaded last block height from storage: {self.last_block_height}")
            else:
                logging.info("[NotificationService] No last block height found, starting with None")
        except Exception as e:
            logging.error(f"[NotificationService] Error loading last block height: {e}")

    def _save_last_block_height(self) -> None:
        """Save last block height to persistent storage."""
        if self.last_block_height:
            self._set_redis_value("last_block_height", self.last_block_height)

    def _save_notifications(self) -> None:
        """Save notifications with improved pruning."""
        try:
            # Sort by timestamp before pruning to ensure we keep the most recent
            if len(self.notifications) > self.max_notifications:
                self.notifications.sort(key=lambda n: n.get("timestamp", ""), reverse=True)
                self.notifications = self.notifications[: self.max_notifications]

            self.state_manager.save_notifications(self.notifications)
            logging.info(f"[NotificationService] Saved {len(self.notifications)} notifications")
        except Exception as e:
            logging.error(f"[NotificationService] Error saving notifications: {e}")

    def add_notification(
        self,
        message: str,
        level: NotificationLevel = NotificationLevel.INFO,
        category: NotificationCategory = NotificationCategory.SYSTEM,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Add a new notification.

        Args:
            message (str): Notification message text
            level (NotificationLevel): Severity level
            category (NotificationCategory): Classification category
            data (dict, optional): Additional data for the notification

        Returns:
            dict: The created notification
        """
        notification = {
            "id": str(uuid.uuid4()),
            "timestamp": self._get_current_time().isoformat(),
            "message": message,
            "level": level.value,
            "category": category.value,
            "read": False,
        }

        if data:
            notification["data"] = data

        self.notifications.append(notification)
        self._save_notifications()

        logging.info(f"[NotificationService] Added notification: {message}")
        return notification

    def get_notifications(
        self,
        limit: int = 50,
        offset: int = 0,
        unread_only: bool = False,
        category: Optional[str] = None,
        level: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get filtered notifications with optimized filtering.

        Args:
            limit (int): Maximum number to return
            offset (int): Starting offset for pagination
            unread_only (bool): Only return unread notifications
            category (str): Filter by category
            level (str): Filter by level

        Returns:
            list: Filtered notifications
        """
        # Apply all filters in a single pass
        filtered = [
            n
            for n in self.notifications
            if (not unread_only or not n.get("read", False))
            and (not category or n.get("category") == category)
            and (not level or n.get("level") == level)
        ]

        # Sort by timestamp (newest first)
        filtered = sorted(filtered, key=lambda n: n.get("timestamp", ""), reverse=True)

        # Apply pagination
        return filtered[offset : offset + limit]

    def get_unread_count(self) -> int:
        """Get count of unread notifications."""
        return sum(1 for n in self.notifications if not n.get("read", False))

    def mark_as_read(self, notification_id: Optional[str] = None) -> bool:
        """
        Mark notification(s) as read.

        Args:
            notification_id (str, optional): ID of specific notification to mark read,
                                            or None to mark all as read

        Returns:
            bool: True if successful
        """
        if notification_id:
            # Mark specific notification as read
            for n in self.notifications:
                if n.get("id") == notification_id:
                    n["read"] = True
                    logging.info(f"[NotificationService] Marked notification {notification_id} as read")
                    break
        else:
            # Mark all as read
            for n in self.notifications:
                n["read"] = True
            logging.info(f"[NotificationService] Marked all {len(self.notifications)} notifications as read")

        self._save_notifications()
        return True

    def delete_notification(self, notification_id: str) -> bool:
        """
        Delete a specific notification.

        Args:
            notification_id (str): ID of notification to delete

        Returns:
            bool: True if successful
        """
        for notif in self.notifications:
            if notif.get("id") == notification_id:
                if notif.get("category") == NotificationCategory.BLOCK.value:
                    logging.info(
                        f"[NotificationService] Block notification {notification_id} cannot be deleted"
                    )
                    return False
                self.notifications.remove(notif)
                logging.info(f"[NotificationService] Deleted notification {notification_id}")
                self._save_notifications()
                return True

        return False

    def clear_notifications(
        self, category: Optional[str] = None, older_than_days: Optional[int] = None, read_only: bool = False
    ) -> int:
        """
        Clear notifications with optimized filtering.

        Args:
            category (str, optional): Only clear specific category
            older_than_days (int, optional): Only clear notifications older than this
            read_only (bool, optional): Only clear notifications that have been read

        Returns:
            int: Number of notifications cleared
        """
        original_count = len(self.notifications)

        cutoff_date = None
        if older_than_days:
            cutoff_date = self._get_current_time() - timedelta(days=older_than_days)

        # Apply filters to KEEP notifications that should NOT be cleared
        self.notifications = [
            n
            for n in self.notifications
            if (
                n.get("category") == NotificationCategory.BLOCK.value
            )  # Never delete block found notifications
            or (
                category and n.get("category") != category
            )  # Keep if we're filtering by category and this isn't that category
            or (
                cutoff_date
                and self._parse_timestamp(n.get("timestamp", self._get_current_time().isoformat())) >= cutoff_date
            )  # Keep if newer than cutoff
            or (
                read_only and not n.get("read", False)
            )  # Keep if we're only clearing read notifications and this is unread
        ]

        cleared_count = original_count - len(self.notifications)
        if cleared_count > 0:
            logging.info(f"[NotificationService] Cleared {cleared_count} notifications")
            self._save_notifications()

        return cleared_count

    def check_and_generate_notifications(
        self, current_metrics: Dict[str, Any], previous_metrics: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Check metrics and generate notifications for significant events.

        Args:
            current_metrics: Current system metrics
            previous_metrics: Previous system metrics for comparison

        Returns:
            list: Newly created notifications
        """
        new_notifications = []

        try:
            # Skip if no metrics
            if not current_metrics:
                logging.warning("[NotificationService] No current metrics available, skipping notification checks")
                return new_notifications

            # Skip notification generation after configuration reset
            if current_metrics.get("wallet") == "yourwallethere" or current_metrics.get("config_reset", False):
                logging.info("[NotificationService] Configuration reset detected, skipping all notifications")
                return new_notifications

            # Check for block updates (using persistent storage)
            last_block_height = current_metrics.get("last_block_height")
            if last_block_height and last_block_height != "N/A":
                if self.last_block_height is not None and self.last_block_height != last_block_height:
                    logging.info(
                        f"[NotificationService] Block change detected: {self.last_block_height} -> {last_block_height}"
                    )
                    block_notification = self._generate_block_notification(current_metrics)
                    if block_notification:
                        new_notifications.append(block_notification)

                # Always update the stored last block height when it changes
                if self.last_block_height != last_block_height:
                    self.last_block_height = last_block_height
                    self._save_last_block_height()

            # Regular comparison with previous metrics
            if previous_metrics:
                # Check for daily stats
                if self._should_post_daily_stats():
                    stats_notification = self._generate_daily_stats(current_metrics)
                    if stats_notification:
                        new_notifications.append(stats_notification)

                # Check for significant hashrate drop
                hashrate_notification = self._check_hashrate_change(current_metrics, previous_metrics)
                if hashrate_notification:
                    new_notifications.append(hashrate_notification)

                # Check for earnings and payout progress
                earnings_notification = self._check_earnings_progress(current_metrics, previous_metrics)
                if earnings_notification:
                    new_notifications.append(earnings_notification)

            return new_notifications

        except Exception as e:
            logging.error(f"[NotificationService] Error generating notifications: {e}")
            error_notification = self.add_notification(
                f"Error generating notifications: {str(e)}",
                level=NotificationLevel.ERROR,
                category=NotificationCategory.SYSTEM,
            )
            return [error_notification]

    def _should_post_daily_stats(self) -> bool:
        """Check if it's time to post daily stats with improved clarity."""
        now = self._get_current_time()

        # Only proceed if we're in the target hour and within first 5 minutes
        if now.hour != DEFAULT_TARGET_HOUR or now.minute >= NOTIFICATION_WINDOW_MINUTES:
            return False

        # If we have a last_daily_stats timestamp, check if it's a different day
        if self.last_daily_stats and now.date() <= self.last_daily_stats.date():
            return False

        # All conditions met, update timestamp and return True
        logging.info(f"[NotificationService] Posting daily stats at {now.hour}:{now.minute}")
        self.last_daily_stats = now
        return True

    def _generate_daily_stats(self, metrics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Generate daily stats notification."""
        try:
            if not metrics:
                logging.warning("[NotificationService] No metrics available for daily stats")
                return None

            # Format hashrate with appropriate unit
            hashrate_24hr = metrics.get("hashrate_24hr", 0)
            hashrate_unit = metrics.get("hashrate_24hr_unit", "TH/s")

            # Format daily earnings with user's currency
            daily_mined_sats = metrics.get("daily_mined_sats", 0)
            daily_profit_usd = metrics.get("daily_profit_usd", 0)

            # Get user's currency preference
            config = load_config()
            user_currency = config.get("currency", "USD")

            # Get exchange rates using the shared dashboard service when
            # available. Test patches typically ignore the argument.
            exchange_rates = get_exchange_rates(self.dashboard_service)

            # Format with the user's currency
            formatted_profit = format_currency_value(daily_profit_usd, user_currency, exchange_rates)

            # Build message
            message = (
                f"Daily Mining Summary: {hashrate_24hr} {hashrate_unit} average hashrate, "
                f"{daily_mined_sats} SATS mined ({formatted_profit})"
            )

            # Add notification
            logging.info(f"[NotificationService] Generating daily stats notification: {message}")
            return self.add_notification(
                message,
                level=NotificationLevel.INFO,
                category=NotificationCategory.HASHRATE,
                data={
                    "hashrate": hashrate_24hr,
                    "unit": hashrate_unit,
                    "daily_sats": daily_mined_sats,
                    "daily_profit": daily_profit_usd,
                    "daily_profit_usd": daily_profit_usd,
                    "currency": user_currency,
                },
            )
        except Exception as e:
            logging.error(f"[NotificationService] Error generating daily stats notification: {e}")
            return None

    def _generate_block_notification(self, metrics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Generate notification for a new block found."""
        try:
            last_block_height = metrics.get("last_block_height", "Unknown")
            last_block_earnings = metrics.get("last_block_earnings", "0")

            log_msg = (
                "[NotificationService] Generating block notification: "
                f"height={last_block_height}, earnings={last_block_earnings}"
            )
            logging.info(log_msg)

            message = f"New block found by the pool! Block #{last_block_height}, earnings: {last_block_earnings} SATS"

            return self.add_notification(
                message,
                level=NotificationLevel.SUCCESS,
                category=NotificationCategory.BLOCK,
                data={"block_height": last_block_height, "earnings": last_block_earnings},
            )
        except Exception as e:
            logging.error(f"[NotificationService] Error generating block notification: {e}")
            return None

    def _parse_numeric_value(self, value_str: Any) -> float:
        """Parse numeric values from strings that may include units or commas."""
        if isinstance(value_str, (int, float)):
            return float(value_str)

        if isinstance(value_str, str):
            # Remove commas and search for the first numeric portion to handle
            # values like "Hashrate: 1,234.5TH/s" or "1,234.5TH/s".
            cleaned = value_str.replace(",", "")
            # Remove spaces between a sign and the digits (e.g. "- 1.2" -> "-1.2")
            cleaned = re.sub(r"([+-])\s+(?=\d)", r"\1", cleaned).strip()
            match = re.search(r"[-+]?\d*\.?\d+", cleaned)
            if match:
                try:
                    return float(match.group(0))
                except ValueError:
                    pass

        return 0.0

    def _check_hashrate_change(self, current: Dict[str, Any], previous: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Check for significant hashrate changes using appropriate time window based on mode."""
        try:
            # Check if we're in low hashrate mode
            # A simple threshold approach: if hashrate_3hr is below 3 TH/s
            # (or the configured low hashrate threshold) consider it low
            # hashrate mode
            is_low_hashrate_mode = False

            if "hashrate_3hr" in current:
                current_3hr = self._parse_numeric_value(current.get("hashrate_3hr", 0))
                current_3hr_unit = current.get("hashrate_3hr_unit", "TH/s").lower()

                # Normalize to TH/s for comparison
                if "ph/s" in current_3hr_unit:
                    current_3hr *= 1000
                elif "gh/s" in current_3hr_unit:
                    current_3hr /= 1000
                elif "mh/s" in current_3hr_unit:
                    current_3hr /= 1000000

                cfg = load_config()
                threshold = cfg.get("low_hashrate_threshold_ths", 3.0)
                is_low_hashrate_mode = current_3hr < threshold

            logging.debug(f"[NotificationService] Low hashrate mode: {is_low_hashrate_mode}")

            # Choose the appropriate hashrate metric based on mode
            if is_low_hashrate_mode:
                # In low hashrate mode, use 3hr averages for more stability
                current_hashrate_key = "hashrate_3hr"
                previous_hashrate_key = "hashrate_3hr"
                timeframe = "3hr"
            else:
                # In normal mode, use 10min averages for faster response
                current_hashrate_key = "hashrate_10min"
                previous_hashrate_key = "hashrate_10min"
                timeframe = "10min"

            # Get hashrate values
            current_hashrate = current.get(current_hashrate_key, 0)
            previous_hashrate = previous.get(previous_hashrate_key, 0)

            # Log what we're comparing
            log_msg = (
                f"[NotificationService] Comparing {timeframe} hashrates - "
                f"current: {current_hashrate}, previous: {previous_hashrate}"
            )
            logging.debug(log_msg)

            # Skip if values are missing
            if not current_hashrate or not previous_hashrate:
                logging.debug(f"[NotificationService] Skipping hashrate check - missing {timeframe} values")
                return None

            # Parse values consistently
            current_value = self._parse_numeric_value(current_hashrate)
            previous_value = self._parse_numeric_value(previous_hashrate)

            conv_msg = (
                f"[NotificationService] Converted {timeframe} hashrates - "
                f"current: {current_value}, previous: {previous_value}"
            )
            logging.debug(conv_msg)

            # Skip if previous was zero (prevents division by zero)
            if previous_value == 0:
                logging.debug(f"[NotificationService] Skipping hashrate check - previous {timeframe} was zero")
                return None

            # Calculate percentage change
            percent_change = ((current_value - previous_value) / previous_value) * 100
            logging.debug(f"[NotificationService] {timeframe} hashrate change: {percent_change:.1f}%")

            # Significant decrease
            if percent_change <= -SIGNIFICANT_HASHRATE_CHANGE_PERCENT:
                message = f"Significant {timeframe} hashrate drop detected: {abs(percent_change):.1f}% decrease"
                logging.info(f"[NotificationService] Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_value,
                        "current": current_value,
                        "change": percent_change,
                        "timeframe": timeframe,
                        "is_low_hashrate_mode": is_low_hashrate_mode,
                    },
                )

            # Significant increase
            elif percent_change >= SIGNIFICANT_HASHRATE_CHANGE_PERCENT:
                message = f"{timeframe} hashrate increase detected: {percent_change:.1f}% increase"
                logging.info(f"[NotificationService] Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.SUCCESS,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_value,
                        "current": current_value,
                        "change": percent_change,
                        "timeframe": timeframe,
                        "is_low_hashrate_mode": is_low_hashrate_mode,
                    },
                )

            return None
        except Exception as e:
            logging.error(f"[NotificationService] Error checking hashrate change: {e}")
            return None

    def _check_earnings_progress(self, current: Dict[str, Any], previous: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Check for significant earnings progress or payout approach."""
        try:
            # First check for configuration reset via Alt+W (this is a more robust check)
            # This specifically looks for the default "yourwallethere" wallet which indicates Alt+W was used
            current_wallet = str(current.get("wallet", ""))
            if current_wallet == "yourwallethere":
                logging.info(
                    "[NotificationService] Detected wallet reset to default "
                    "(likely Alt+W) - skipping payout notification"
                )
                return None

            # Check if ANY config value changed that might affect balance
            if self._is_configuration_change_affecting_balance(current, previous):
                logging.info("[NotificationService] Configuration change detected - skipping payout notification")
                return None

            current_unpaid = self._parse_numeric_value(current.get("unpaid_earnings", "0"))

            # Check if approaching payout
            if current.get("est_time_to_payout"):
                est_time = current.get("est_time_to_payout")

                # If estimated time is a number of days
                if est_time.isdigit() or (est_time[0] == "-" and est_time[1:].isdigit()):
                    days = int(est_time)
                    if 0 < days <= 1:
                        if self._should_send_payout_notification():
                            message = "Payout approaching! Estimated within 1 day"
                            self.last_payout_notification_time = self._get_current_time()
                            return self.add_notification(
                                message,
                                level=NotificationLevel.SUCCESS,
                                category=NotificationCategory.EARNINGS,
                                data={"days_to_payout": days},
                            )
                # If it says "next block"
                elif "next block" in est_time.lower():
                    if self._should_send_payout_notification():
                        message = "Payout expected with next block!"
                        self.last_payout_notification_time = self._get_current_time()
                        return self.add_notification(
                            message,
                            level=NotificationLevel.SUCCESS,
                            category=NotificationCategory.EARNINGS,
                            data={"payout_imminent": True},
                        )

            # Check for payout (unpaid balance reset)
            if previous.get("unpaid_earnings"):
                previous_unpaid = self._parse_numeric_value(previous.get("unpaid_earnings", "0"))

                # If balance significantly decreased, likely a payout occurred
                if previous_unpaid > 0 and current_unpaid < previous_unpaid * 0.5:
                    message = f"Payout received! Unpaid balance reset from {previous_unpaid} to {current_unpaid} BTC"
                    return self.add_notification(
                        message,
                        level=NotificationLevel.SUCCESS,
                        category=NotificationCategory.EARNINGS,
                        data={
                            "previous_balance": previous_unpaid,
                            "current_balance": current_unpaid,
                            "payout_amount": previous_unpaid - current_unpaid,
                        },
                    )

            return None
        except Exception as e:
            logging.error(f"[NotificationService] Error checking earnings progress: {e}")
            return None

    def _is_configuration_change_affecting_balance(self, current: Dict[str, Any], previous: Dict[str, Any]) -> bool:
        """Check if any configuration changed that would affect balance calculations."""
        # Check wallet
        if "wallet" in current and "wallet" in previous:
            if current.get("wallet") != previous.get("wallet"):
                return True

        # Check currency
        if "currency" in current and "currency" in previous:
            if current.get("currency") != previous.get("currency"):
                return True

        # Check for emergency reset flag
        if current.get("config_reset", False):
            return True

        return False

    def _should_send_payout_notification(self) -> bool:
        """Check if enough time has passed since the last payout notification."""
        if self.last_payout_notification_time is None:
            return True
        time_since_last_notification = self._get_current_time() - self.last_payout_notification_time
        return time_since_last_notification.total_seconds() > ONE_DAY_SECONDS

    def update_notification_currency(self, new_currency: Optional[str] = None) -> int:
        """Update stored notifications to reflect the selected currency.

        Args:
            new_currency: Currency code to convert values to. If ``None`` the
                value will be loaded from the configuration.

        Returns:
            int: Number of notifications that were updated.
        """
        try:
            if not new_currency:
                config = load_config()
                new_currency = config.get("currency", "USD")

            # Use the shared dashboard service for exchange rates when
            # available. Test patches commonly ignore the argument.
            exchange_rates = get_exchange_rates(self.dashboard_service)
            if new_currency not in exchange_rates:
                logging.warning(
                    f"[NotificationService] Missing exchange rate for {new_currency}, skipping update"
                )
                return 0

            updated = 0
            for notif in self.notifications:
                data = notif.get("data", {})
                if isinstance(data, dict) and "daily_profit" in data:
                    # Prefer stored USD value if available
                    profit_value = data.get("daily_profit")
                    old_currency = data.get("currency", "USD")

                    if profit_value is None:
                        continue

                    try:
                        profit_value = float(profit_value)
                    except (ValueError, TypeError):
                        continue

                    if "daily_profit_usd" in data:
                        try:
                            profit_usd = float(data.get("daily_profit_usd"))
                        except (ValueError, TypeError):
                            profit_usd = profit_value
                    else:
                        old_rate = exchange_rates.get(old_currency, 1.0)
                        try:
                            profit_usd = profit_value / old_rate
                        except Exception:
                            profit_usd = profit_value
                        # Store USD value for future conversions
                        data["daily_profit_usd"] = profit_usd

                    converted_value = profit_usd * exchange_rates.get(new_currency, 1.0)
                    data["daily_profit"] = converted_value
                    data["currency"] = new_currency

                    # Update message if it contains a formatted profit value
                    if notif.get("message") and "(" in notif["message"] and ")" in notif["message"]:
                        formatted = format_currency_value(profit_usd, new_currency, exchange_rates)
                        notif["message"] = re.sub(r"\([^\)]*\)", f"({formatted})", notif["message"])

                    updated += 1

            if updated:
                self._save_notifications()

            return updated
        except Exception as e:
            logging.error(f"[NotificationService] Error updating notification currency: {e}")
            return 0
