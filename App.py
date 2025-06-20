"""
Main application module for the Bitcoin Mining Dashboard.
"""

import os
import logging
import time
import gc  # noqa: F401 - re-exported for tests
import psutil
from collections import deque  # noqa: F401 - re-exported for tests
from json_utils import convert_deques
import signal
import sys
import threading
import requests
import csv
import io
from flask import Flask, Response, jsonify, render_template, request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask_caching import Cache
from notification_service import NotificationLevel, NotificationCategory
from urllib.parse import urlparse
from data_service import MiningDashboardService  # noqa: F401 - used in tests
from apscheduler.schedulers.background import BackgroundScheduler  # noqa: F401 - used in tests

# Import custom modules
from config import load_config, save_config  # noqa: F401 - used in tests
from config import get_timezone
from error_handlers import register_error_handlers
from app_setup import (
    configure_logging,
    init_state_manager,
    init_services,
    build_scheduler,  # noqa: F401 - used in tests
)

from memory_manager import (
    memory_usage_history,  # noqa: F401 - re-exported for tests
    memory_usage_lock,  # noqa: F401 - re-exported for tests
    last_leak_check_time,  # noqa: F401 - re-exported for tests
    object_counts_history,  # noqa: F401 - re-exported for tests
    leak_growth_tracker,  # noqa: F401 - re-exported for tests
    log_memory_usage,  # noqa: F401 - re-exported for tests
    adaptive_gc,  # noqa: F401 - re-exported for tests
    check_for_memory_leaks,  # noqa: F401 - re-exported for tests
    record_memory_metrics,  # noqa: F401 - used in tests via re-export
    memory_watchdog,  # noqa: F401 - re-exported for tests
    MEMORY_CONFIG,  # noqa: F401 - re-exported for tests
    init_memory_manager,
)

import sse_service
import notification_routes
import scheduler_service
import config_routes
import memory_routes

# Initialize Flask app
app = Flask(__name__)
register_error_handlers(app)

sse_service.init_sse_service(lambda: cached_metrics)
app.register_blueprint(sse_service.sse_bp)


@app.context_processor
def inject_request():
    """Inject the current request into the template context."""
    return dict(request=request)


# Set up caching using a simple in-memory cache
cache = Cache(app, config={"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 10})

# SSE connection tracking moved to ``sse_service``

# Allowed paths and limits for the batch API
MAX_BATCH_REQUESTS = 10
ALLOWED_BATCH_PATHS = {
    "/api/health",
    "/api/metrics",
    "/api/time",
    "/api/timezone",
    "/api/available_timezones",
    "/api/workers",
    "/api/block-events",
    "/api/config",
    "/api/payout-history",
    "/api/earnings",
    "/api/notifications",
    "/api/notifications/unread_count",
    "/api/notifications/mark_read",
    "/api/notifications/delete",
    "/api/notifications/clear",
    "/api/reset-chart-data",
    "/api/force-refresh",
}

# Global variables for metrics and scheduling
cached_metrics = None
last_metrics_update_time = None
scheduler_last_successful_run = None
scheduler_recreate_lock = threading.Lock()

# Track scheduler health
_previous_scheduler = globals().get("scheduler")
_previous_dashboard_service = globals().get("dashboard_service")
_previous_state_manager = globals().get("state_manager")
_previous_notification_service = globals().get("notification_service")
scheduler = None

# Global start time
SERVER_START_TIME = datetime.now(ZoneInfo(get_timezone()))

# Configure logging with rotation
logger = configure_logging()

# Initialize state manager and services
state_manager = init_state_manager()

# Close any previous state manager instance to prevent resource leaks
if _previous_state_manager:
    try:
        _previous_state_manager.close()
    except Exception as e:
        logging.error(f"Error closing previous state manager: {e}")
    finally:
        _previous_state_manager = None

dashboard_service, worker_service, notification_service = init_services(state_manager)

# Close any previous notification service instance to prevent leaks
if _previous_notification_service:
    try:
        if hasattr(_previous_notification_service, "close"):
            _previous_notification_service.close()
    except Exception as e:
        logging.error(f"Error closing previous notification service: {e}")
    finally:
        _previous_notification_service = None
notification_routes.init_notification_routes(notification_service)
app.register_blueprint(notification_routes.notifications_bp)

# Configure scheduler service with this module's globals
scheduler_service.configure(sys.modules[__name__])
update_metrics_job = scheduler_service.update_metrics_job
scheduler_watchdog = scheduler_service.scheduler_watchdog
create_scheduler = scheduler_service.create_scheduler
config_routes.init_config_routes(
    dashboard_service,
    worker_service,
    notification_service,
    update_metrics_job,
)
app.register_blueprint(config_routes.config_bp)
app.register_blueprint(memory_routes.memory_bp)

# Initialize memory manager with required dependencies
init_memory_manager(
    state_manager,
    notification_service,
    lambda: dashboard_service,
    lambda: sse_service.active_sse_connections,
)


# --- Disable Client Caching for All Responses ---
@app.after_request
def add_header(response):
    """Disable browser caching for all responses."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response




# Scheduler management utilities are provided by ``scheduler_service``.


# --- Custom Template Filter ---
@app.template_filter("commafy")
def commafy(value):
    """Add commas to numbers for better readability."""
    try:
        # Check if the value is already a string with decimal places
        if isinstance(value, str) and "." in value:
            # Split by decimal point
            integer_part, decimal_part = value.split(".")
            # Format integer part with commas and rejoin with decimal part
            return "{:,}.{}".format(int(integer_part), decimal_part)
        elif isinstance(value, (int, float)):
            # If it's a float, preserve decimal places
            if isinstance(value, float):
                return "{:,.2f}".format(value)
            # If it's an integer, format without decimal places
            return "{:,}".format(value)
        return value
    except Exception:
        return value


# SSE routes are provided by ``sse_service`` and registered below


# --- Routes ---
@app.route("/")
def boot():
    """Serve the boot sequence page."""
    return render_template("boot.html", base_url=request.host_url.rstrip("/"))


# --- Updated Dashboard Route ---
@app.route("/dashboard")
def dashboard():
    """Serve the main dashboard page."""
    global cached_metrics, last_metrics_update_time

    # Make sure we have metrics data before rendering the template
    if cached_metrics is None:
        # Force an immediate metrics fetch regardless of the time since last update
        logging.info("Dashboard accessed with no cached metrics - forcing immediate fetch")
        try:
            # Force update with the force parameter
            update_metrics_job(force=True)
        except Exception as e:
            logging.error(f"Error during forced metrics fetch: {e}")

        # If still None after our attempt, create default metrics
        if cached_metrics is None:
            default_metrics = {
                "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
                "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo(get_timezone())).isoformat(),
                "hashrate_24hr": None,
                "hashrate_24hr_unit": "TH/s",
                "hashrate_3hr": None,
                "hashrate_3hr_unit": "TH/s",
                "hashrate_10min": None,
                "hashrate_10min_unit": "TH/s",
                "hashrate_60sec": None,
                "hashrate_60sec_unit": "TH/s",
                "pool_total_hashrate": None,
                "pool_total_hashrate_unit": "TH/s",
                "workers_hashing": 0,
                "total_last_share": None,
                "block_number": None,
                "btc_price": 0,
                "network_hashrate": 0,
                "difficulty": 0,
                "daily_revenue": 0,
                "daily_power_cost": 0,
                "daily_profit_usd": 0,
                "monthly_profit_usd": 0,
                "break_even_electricity_price": None,
                "power_usage_estimated": True,
                "daily_mined_sats": 0,
                "monthly_mined_sats": 0,
                "unpaid_earnings": "0",
                "est_time_to_payout": None,
                "last_block_height": None,
                "last_block_time": None,
                "last_block_earnings": None,
                "blocks_found": "0",
                "estimated_earnings_per_day_sats": 0,
                "estimated_earnings_next_block_sats": 0,
                "estimated_rewards_in_window_sats": 0,
                "arrow_history": {},
            }
            logging.warning("Rendering dashboard with default metrics - no data available yet")
            current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
            return render_template("dashboard.html", metrics=default_metrics, current_time=current_time)

    # If we have metrics, use them
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
    return render_template("dashboard.html", metrics=cached_metrics, current_time=current_time)


@app.route("/api/metrics")
def api_metrics():
    """API endpoint for metrics data."""
    if cached_metrics is None:
        update_metrics_job()
    return jsonify(convert_deques(cached_metrics))


@app.route("/api/batch", methods=["POST"])
def batch_requests():
    """Process a list of API requests in one call."""
    try:
        requests_json = request.get_json(silent=True) or {}
        reqs = requests_json.get("requests", [])
        if not isinstance(reqs, list):
            return jsonify({"error": "invalid format"}), 400
        if len(reqs) > MAX_BATCH_REQUESTS:
            return jsonify({"error": "too many requests"}), 400

        responses = []
        with app.test_client() as client:
            for item in reqs:
                path = item.get("path")
                method = item.get("method", "GET").upper()
                params = item.get("params")
                body = item.get("body")
                allowed_methods = {"GET", "POST", "DELETE"}

                if not path or method not in allowed_methods:
                    responses.append({"status": 400, "body": {"error": "invalid request"}})
                    continue

                parsed = urlparse(str(path))
                clean_path = parsed.path
                query = parsed.query

                if (
                    not clean_path.startswith("/api/")
                    or clean_path == "/api/batch"
                    or clean_path not in ALLOWED_BATCH_PATHS
                ):
                    responses.append({"status": 400, "body": {"error": "invalid request"}})
                    continue

                resp = client.open(
                    clean_path,
                    method=method,
                    json=body,
                    query_string=params or query,
                )
                try:
                    body_data = resp.get_json()
                except Exception:
                    body_data = resp.data.decode("utf-8")
                finally:
                    try:
                        resp.close()
                    except Exception:
                        pass
                responses.append({"status": resp.status_code, "body": body_data})
        return jsonify({"responses": responses})
    except Exception as e:
        logging.error(f"Error in batch handler: {e}")
        return jsonify({"error": "internal server error"}), 500


@app.route("/api/available_timezones")
def available_timezones():
    """Return a list of available timezones."""
    from zoneinfo import available_timezones

    return jsonify({"timezones": sorted(available_timezones())})


@app.route("/api/timezone", methods=["GET"])
def get_timezone_config():
    """Return the timezone configured for the application."""
    from flask import jsonify
    from config import get_timezone

    return jsonify({"timezone": get_timezone()})


# Add this new route to App.py
@app.route("/blocks")
def blocks_page():
    """Serve the blocks overview page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
    return render_template("blocks.html", current_time=current_time)


# --- Workers Dashboard Route and API ---
@app.route("/workers")
def workers_dashboard():
    """Serve the workers overview dashboard page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %I:%M:%S %p")

    # Only get minimal worker stats for initial page load
    # Client-side JS will fetch the full data via API
    workers_data = worker_service.get_workers_data(cached_metrics)

    return render_template(
        "workers.html",
        current_time=current_time,
        workers_total=workers_data.get("workers_total", 0),
        workers_online=workers_data.get("workers_online", 0),
        workers_offline=workers_data.get("workers_offline", 0),
        total_hashrate=workers_data.get("total_hashrate", 0),
        hashrate_unit=workers_data.get("hashrate_unit", "TH/s"),
        total_earnings=workers_data.get("total_earnings", 0),
        daily_sats=workers_data.get("daily_sats", 0),
        avg_acceptance_rate=workers_data.get("avg_acceptance_rate", 0),
    )


@app.route("/api/workers")
def api_workers():
    """API endpoint for worker data."""
    # Get the force_refresh parameter from the query string (default: False)
    force_refresh = request.args.get("force", "false").lower() == "true"
    return jsonify(worker_service.get_workers_data(cached_metrics, force_refresh=force_refresh))


# --- New Time Endpoint for Fine Syncing ---
@app.route("/api/time")
def api_time():
    """API endpoint for server time."""
    return jsonify(
        {  # correct time
            "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo(get_timezone())).isoformat(),
        }
    )




# Health check endpoint with detailed diagnostics
@app.route("/api/health")
def health_check():
    """Health check endpoint with enhanced system diagnostics."""
    # Calculate uptime
    uptime_seconds = (datetime.now(ZoneInfo(get_timezone())) - SERVER_START_TIME).total_seconds()

    # Get process memory usage
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        memory_usage_mb = mem_info.rss / 1024 / 1024
        memory_percent = process.memory_percent()
        memory_total_mb = psutil.virtual_memory().total / 1024 / 1024
    except Exception as e:
        logging.error(f"Error getting memory usage: {e}")
        memory_usage_mb = 0
        memory_percent = 0
        memory_total_mb = 0

    # Check data freshness
    data_age = 0
    if cached_metrics and cached_metrics.get("server_timestamp"):
        try:
            last_update = datetime.fromisoformat(cached_metrics["server_timestamp"])
            data_age = (datetime.now(ZoneInfo(get_timezone())) - last_update).total_seconds()
        except Exception as e:
            logging.error(f"Error calculating data age: {e}")

    # Determine health status
    health_status = "healthy"
    if data_age > 300:  # Data older than 5 minutes
        health_status = "degraded"
    if not cached_metrics:
        health_status = "unhealthy"

    # Build response with detailed diagnostics
    status = {
        "status": health_status,
        "uptime": uptime_seconds,
        "uptime_formatted": (
            f"{int(uptime_seconds // 3600)}h " f"{int((uptime_seconds % 3600) // 60)}m " f"{int(uptime_seconds % 60)}s"
        ),
        "connections": sse_service.active_sse_connections,
        "memory": {
            "usage_mb": round(memory_usage_mb, 2),
            "percent": round(memory_percent, 2),
            "total_mb": round(memory_total_mb, 2),
        },
        "data": {
            "last_update": cached_metrics.get("server_timestamp") if cached_metrics else None,
            "age_seconds": int(data_age),
            "available": cached_metrics is not None,
        },
        "scheduler": {
            "running": scheduler.running if hasattr(scheduler, "running") else False,
            "last_successful_run": scheduler_last_successful_run,
        },
        "redis": {"connected": state_manager.redis_client is not None},
        "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
    }

    # Log health check if status is not healthy
    if health_status != "healthy":
        logging.warning(f"Health check returning {health_status} status: {status}")

    return jsonify(status)


# Add enhanced scheduler health check endpoint
@app.route("/api/scheduler-health")
def scheduler_health():
    """API endpoint for scheduler health information."""
    try:
        scheduler_status = {
            "running": scheduler.running if hasattr(scheduler, "running") else False,
            "job_count": len(scheduler.get_jobs()) if hasattr(scheduler, "get_jobs") else 0,
            "next_run": (
                str(scheduler.get_jobs()[0].next_run_time)
                if hasattr(scheduler, "get_jobs") and scheduler.get_jobs()
                else None
            ),
            "last_update": last_metrics_update_time,
            "time_since_update": (time.time() - last_metrics_update_time if last_metrics_update_time else None),
            "last_successful_run": scheduler_last_successful_run,
            "time_since_successful": (
                time.time() - scheduler_last_successful_run if scheduler_last_successful_run else None
            ),
        }
        return jsonify(scheduler_status)
    except Exception as e:
        logging.error(f"Scheduler status error: {e}")
        return jsonify({"error": "internal server error"}), 500


# Add a health check route that can attempt to fix the scheduler if needed
@app.route("/api/fix-scheduler", methods=["POST"])
def fix_scheduler():
    """API endpoint to recreate the scheduler."""
    try:
        with scheduler_recreate_lock:
            new_scheduler = create_scheduler()
            if new_scheduler:
                global scheduler
                scheduler = new_scheduler
                return jsonify({"status": "success", "message": "Scheduler recreated successfully"})
            else:
                return jsonify({"status": "error", "message": "Failed to recreate scheduler"}), 500
    except Exception as e:
        logging.error(f"Scheduler recreation error: {e}")
        return jsonify({"status": "error", "message": "internal server error"}), 500


@app.route("/api/force-refresh", methods=["POST"])
def force_refresh():
    """Emergency endpoint to force metrics refresh."""
    logging.warning("Emergency force-refresh requested")
    try:
        # Force fetch new metrics
        metrics = dashboard_service.fetch_metrics()
        if metrics:
            global cached_metrics, scheduler_last_successful_run
            cached_metrics = metrics
            scheduler_last_successful_run = time.time()
            timestamp = metrics["server_timestamp"]
            logging.info(f"Force refresh successful, new timestamp: {timestamp}")
            return jsonify(
                {
                    "status": "success",
                    "message": "Metrics refreshed",
                    "timestamp": timestamp,
                }
            )
        else:
            return jsonify({"status": "error", "message": "Failed to fetch metrics"}), 500
    except Exception as e:
        logging.error(f"Force refresh error: {e}")
        return jsonify({"status": "error", "message": "internal server error"}), 500






# Service worker route
@app.route('/service-worker.js')
def service_worker_file():
    """Serve the service worker JavaScript file."""
    return app.send_static_file('js/service-worker.js')




class RobustMiddleware:
    """WSGI middleware for enhanced error handling."""

    def __init__(self, app):
        """Store the wrapped WSGI application."""
        self.app = app

    def __call__(self, environ, start_response):
        """Invoke the wrapped application and catch errors."""
        try:
            return self.app(environ, start_response)
        except Exception:
            logging.exception("Unhandled exception in WSGI app")
            start_response("500 Internal Server Error", [("Content-Type", "text/html")])
            return [b"<h1>Internal Server Error</h1>"]


@app.route("/api/reset-chart-data", methods=["POST"])
def reset_chart_data():
    """API endpoint to reset chart data history."""
    try:
        clear_all = request.args.get("full") == "1"
        if clear_all:
            state_manager.clear_arrow_history()
        else:
            hashrate_keys = [
                "hashrate_60sec",
                "hashrate_3hr",
                "hashrate_10min",
                "hashrate_24hr",
            ]
            state_manager.clear_arrow_history(hashrate_keys)

        # Force an immediate save to Redis if available
        if state_manager and hasattr(state_manager, "redis_client") and state_manager.redis_client:
            # Force save by overriding the time check
            state_manager.last_save_time = 0
            state_manager.save_graph_state()
            logging.info("Chart data reset saved to Redis immediately")

        return jsonify({"status": "success", "message": "Chart data reset successfully"})
    except Exception as e:
        logging.error(f"Error resetting chart data: {e}")
        return jsonify({"status": "error", "message": "internal server error"}), 500


@app.route("/api/payout-history", methods=["GET", "POST", "DELETE"])
def payout_history():
    """Manage payout history through a simple REST style interface.

    * ``GET`` returns the currently stored payout history.
    * ``POST`` accepts either a full ``history`` list or a single ``record``
      dictionary to prepend to the history.
    * ``DELETE`` clears all stored payout data.
    """
    try:
        if request.method == "GET":
            history = state_manager.get_payout_history()
            return jsonify({"payout_history": history})

        if request.method == "POST":
            data = request.get_json() or {}
            if "history" in data:
                if not isinstance(data["history"], list):
                    return jsonify({"error": "history must be a list"}), 400
                state_manager.save_payout_history(data["history"])
                return jsonify({"status": "success"})

            if "record" in data:
                if not isinstance(data["record"], dict):
                    return jsonify({"error": "record must be an object"}), 400
                history = state_manager.get_payout_history()
                history.insert(0, data["record"])
                if len(history) > 30:
                    history = history[:30]
                state_manager.save_payout_history(history)
                return jsonify({"status": "success"})

            return jsonify({"error": "invalid data"}), 400

        # DELETE
        state_manager.clear_payout_history()
        return jsonify({"status": "success"})
    except Exception as e:
        logging.error(f"Error handling payout history: {e}")
        return jsonify({"error": "internal server error"}), 500


# New endpoint to fetch recent block events for chart annotations
@app.route("/api/block-events")
def block_events():
    """Return recent block notifications for chart annotations."""
    try:
        limit = request.args.get("limit", 20, type=int)
        minutes = request.args.get("minutes", 180, type=int)

        # Grab a single larger batch to avoid multiple fetches
        notifications = notification_service.get_notifications(
            limit=limit * 5,
            category=NotificationCategory.BLOCK.value,
        )

        cutoff = notification_service._get_current_time() - timedelta(minutes=minutes)
        events = []

        for n in notifications:
            ts = n.get("timestamp")
            data = n.get("data") or {}
            height = data.get("block_height")
            if ts and height:
                when = notification_service._parse_timestamp(ts)
                if when >= cutoff:
                    events.append({"timestamp": ts, "height": height})
                    if len(events) >= limit:
                        break

        # Ensure newest events first
        events.sort(key=lambda e: e["timestamp"], reverse=True)

        return jsonify({"events": events})
    except Exception as e:
        logging.error(f"Error fetching block events: {e}")
        return jsonify({"error": "internal server error"}), 500


# First, register the template filter outside of any route function
# Add this near the top of your file with other template filters
@app.template_filter("format_datetime")
def format_datetime(value, timezone=None):
    """Format a datetime string according to the specified timezone using AM/PM format."""
    if not value:
        return "None"

    import datetime
    import pytz

    if timezone is None:
        # Use default timezone if none provided
        timezone = get_timezone()

    try:
        if isinstance(value, str):
            # Parse the string to a datetime object
            dt = datetime.datetime.strptime(value, "%Y-%m-%d %H:%M")
        else:
            dt = value

        # Make datetime timezone aware
        if dt.tzinfo is None:
            dt = pytz.UTC.localize(dt)

        # Convert to user's timezone
        user_tz = pytz.timezone(timezone)
        dt = dt.astimezone(user_tz)

        # Format according to user preference with AM/PM format
        return dt.strftime("%b %d, %Y %I:%M %p")
    except ValueError:
        return value


# Then update your earnings route
@app.route("/earnings")
def earnings():
    """Serve the earnings page with user's currency and timezone preferences."""
    try:
        # Get user's currency and timezone preferences
        from config import get_currency, get_timezone

        user_currency = get_currency()
        user_timezone = get_timezone()

        # Define currency symbols for common currencies
        currency_symbols = {
            "USD": "$",
            "EUR": "€",
            "GBP": "£",
            "JPY": "¥",
            "CAD": "C$",
            "AUD": "A$",
            "CNY": "¥",
            "KRW": "₩",
            "BRL": "R$",
            "CHF": "Fr",
        }

        error_message = None

        # Add graceful error handling for earnings data
        try:
            # Get earnings data with a longer timeout
            earnings_data = dashboard_service.get_earnings_data()
            state_manager.save_last_earnings(earnings_data)
        except requests.exceptions.ReadTimeout:
            logging.warning("Timeout fetching earnings data from ocean.xyz - using cached or fallback data")
            error_message = "Timeout fetching earnings data. Showing cached information."
            earnings_data = state_manager.get_last_earnings() or {}
            if not earnings_data:
                if cached_metrics and "unpaid_earnings" in cached_metrics:
                    earnings_data = {
                        "payments": [],
                        "total_payments": 0,
                        "total_paid_btc": 0,
                        "total_paid_sats": 0,
                        "total_paid_usd": 0,
                        "unpaid_earnings": cached_metrics.get("unpaid_earnings", 0),
                        "unpaid_earnings_sats": int(float(cached_metrics.get("unpaid_earnings", 0)) * 100000000),
                        "est_time_to_payout": cached_metrics.get("est_time_to_payout", "Unknown"),
                        "monthly_summaries": [],
                        "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
                    }
                else:
                    earnings_data = {
                        "payments": [],
                        "total_payments": 0,
                        "total_paid_btc": 0,
                        "total_paid_sats": 0,
                        "total_paid_usd": 0,
                        "unpaid_earnings": 0,
                        "unpaid_earnings_sats": 0,
                        "est_time_to_payout": "Unknown",
                        "monthly_summaries": [],
                        "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
                    }

            notification_service.add_notification(
                "Data fetch timeout: Unable to fetch payment history data from Ocean.xyz. Showing limited earnings data.",
                level=NotificationLevel.WARNING,
                category=NotificationCategory.DATA,
            )
        except Exception as e:
            logging.error(f"Error fetching earnings data: {e}")
            error_message = f"Error fetching earnings data: {e}"
            earnings_data = state_manager.get_last_earnings() or {
                "payments": [],
                "total_payments": 0,
                "total_paid_btc": 0,
                "total_paid_sats": 0,
                "total_paid_usd": 0,
                "unpaid_earnings": 0,
                "unpaid_earnings_sats": 0,
                "est_time_to_payout": "Unknown",
                "monthly_summaries": [],
                "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
            }

            notification_service.add_notification(
                f"Error fetching earnings data: {str(e)}",
                level=NotificationLevel.ERROR,
                category=NotificationCategory.DATA,
            )

        # Convert USD values to user's preferred currency if needed
        if user_currency != "USD" and earnings_data:
            # Get exchange rate
            try:
                exchange_rates = dashboard_service.fetch_exchange_rates()
                exchange_rate = exchange_rates.get(user_currency, 1.0)

                # Total paid conversion
                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"] * exchange_rate

                # Monthly summaries conversion
                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month["total_usd"] * exchange_rate
            except Exception as e:
                logging.error(f"Error converting currency: {e}")
                # Set fiat values equal to USD as fallback
                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]

                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month["total_usd"]
        else:
            # If currency is USD, just copy USD values
            if earnings_data:
                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]

                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month["total_usd"]

        return render_template(
            "earnings.html",
            earnings=earnings_data,
            error_message=error_message,
            user_currency=user_currency,
            user_timezone=user_timezone,
            currency_symbols=currency_symbols,
            current_time=datetime.now(ZoneInfo(user_timezone)).strftime("%b %d, %Y %I:%M:%S %p"),
        )
    except Exception as e:
        logging.error(f"Error rendering earnings page: {e}")
        import traceback

        logging.error(traceback.format_exc())
        return render_template(
            "error.html",
            message="Failed to load earnings data. Please try again later.",
        ), 500


def payments_to_csv(payments):
    """Convert a list of payment dictionaries to a CSV string."""
    with io.StringIO() as output:
        writer = csv.writer(output)
        writer.writerow(
            ["date", "txid", "lightning_txid", "amount_btc", "amount_sats", "status"]
        )
        for pay in payments:
            writer.writerow(
                [
                    pay.get("date", ""),
                    pay.get("txid", ""),
                    pay.get("lightning_txid", ""),
                    pay.get("amount_btc", 0),
                    pay.get("amount_sats", 0),
                    pay.get("status", ""),
                ]
            )
        return output.getvalue()


@app.route("/api/earnings")
def api_earnings():
    """API endpoint for earnings data."""
    try:
        # Get the earnings data with a reasonable timeout
        earnings_data = dashboard_service.get_earnings_data()
        if not isinstance(earnings_data, dict) or earnings_data.get("error"):
            if isinstance(earnings_data, dict):
                logging.error("Earnings data error: %s", earnings_data.get("error"))
            else:
                logging.error("Earnings data unavailable")
            return jsonify({"error": "internal server error"}), 500
        state_manager.save_last_earnings(earnings_data)
        fmt = request.args.get("format", "json").lower()
        if fmt == "csv":
            csv_data = payments_to_csv(earnings_data.get("payments", []))
            headers = {"Content-Disposition": "attachment; filename=earnings.csv"}
            return Response(csv_data, mimetype="text/csv", headers=headers)
        return jsonify(earnings_data)
    except Exception:
        logging.exception("Error in earnings API endpoint")
        return jsonify({"error": "internal server error"}), 500


# Add the middleware
app.wsgi_app = RobustMiddleware(app.wsgi_app)

# Services initialized earlier by init_services()
if _previous_dashboard_service:
    try:
        _previous_dashboard_service.close()
    except Exception as e:
        logging.error(f"Error closing previous dashboard service: {e}")
    finally:
        _previous_dashboard_service = None

# Restore critical state if available
last_run, last_update = state_manager.load_critical_state()
if last_run:
    scheduler_last_successful_run = last_run
if last_update:
    last_metrics_update_time = last_update

# Initialize the scheduler, shutting down any previous instance first
if _previous_scheduler:
    try:
        # Wait for any running jobs to finish to prevent thread leaks
        _previous_scheduler.shutdown(wait=True)
    except Exception as e:
        logging.error(f"Error shutting down previous scheduler: {e}")
    finally:
        # Clear reference so old scheduler can be garbage collected
        _previous_scheduler = None

scheduler = create_scheduler()


# Graceful shutdown handler for clean termination
def graceful_shutdown(signum, frame):
    """Handle shutdown signals gracefully."""
    logging.info(f"Received shutdown signal {signum}, shutting down gracefully")

    # Save state before shutting down
    state_manager.save_graph_state()

    # Stop the scheduler
    if scheduler:
        try:
            scheduler.shutdown(wait=True)  # wait for running jobs to complete
            logging.info("Scheduler shutdown complete")
        except Exception as e:
            logging.error(f"Error shutting down scheduler: {e}")

    # Close dashboard service session
    if dashboard_service:
        try:
            dashboard_service.close()
        except Exception as e:
            logging.error(f"Error closing dashboard service: {e}")

    # Close worker service
    if worker_service:
        try:
            worker_service.close()
        except Exception as e:
            logging.error(f"Error closing worker service: {e}")

    # Close notification service
    if notification_service:
        try:
            if hasattr(notification_service, "close"):
                notification_service.close()
        except Exception as e:
            logging.error(f"Error closing notification service: {e}")

    # Close state manager resources
    if state_manager:
        try:
            state_manager.close()
        except Exception as e:
            logging.error(f"Error closing state manager: {e}")

    # Close all logging handlers to avoid file descriptor leaks
    for handler in logging.getLogger().handlers:
        try:
            handler.close()
        except Exception as e:
            logging.error(f"Error closing log handler: {e}")

    # Log connection info before exit
    logging.info(
        "Active SSE connections at shutdown: %s",
        sse_service.active_sse_connections,
    )

    # Exit with success code
    sys.exit(0)


# Register signal handlers
signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT, graceful_shutdown)

# Run once at startup to initialize data
update_metrics_job(force=True)

if __name__ == "__main__":
    # When deploying with Gunicorn in Docker, run with --workers=1 --threads=16 to ensure global state is shared.
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
