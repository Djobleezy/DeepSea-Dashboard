"""
Main application module for the Bitcoin Mining Dashboard.
"""

import os
import logging
from logging.handlers import RotatingFileHandler
import time
import gc
import psutil
from collections import deque
import signal
import sys
import threading
import json
import requests
from flask import Flask, render_template, jsonify, Response, request, stream_with_context
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask_caching import Cache
from apscheduler.schedulers.background import BackgroundScheduler
from notification_service import NotificationService, NotificationLevel, NotificationCategory

# Import custom modules
from config import load_config, save_config
from data_service import MiningDashboardService
from worker_service import WorkerService
from state_manager import StateManager, MAX_HISTORY_ENTRIES
from config import get_timezone
from error_handlers import register_error_handlers

# Memory management configuration
MEMORY_CONFIG = {
    "MAX_METRICS_LOG_ENTRIES": 180,  # Maximum metrics log entries to keep
    "MAX_ARROW_HISTORY_ENTRIES": 180,  # Maximum arrow history entries per key
    "GC_INTERVAL_SECONDS": 3600,  # How often to force full GC (1 hour)
    "MEMORY_HIGH_WATERMARK": 80.0,  # Memory percentage to trigger emergency cleanup
    "ADAPTIVE_GC_ENABLED": True,  # Whether to use adaptive GC
    "MEMORY_MONITORING_INTERVAL": 300,  # How often to log memory usage (5 minutes)
    "MEMORY_HISTORY_MAX_ENTRIES": 72,  # Keep 6 hours of memory history at 5-min intervals
}

# Memory tracking global variables
memory_usage_history = []
memory_usage_lock = threading.Lock()
last_leak_check_time = 0
object_counts_history = {}

# Initialize Flask app
app = Flask(__name__)
register_error_handlers(app)


@app.context_processor
def inject_request():
    """Inject the current request into the template context."""
    return dict(request=request)


# Set up caching using a simple in-memory cache
cache = Cache(app, config={"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 10})

# Global variables for SSE connections and metrics
MAX_SSE_CONNECTIONS = 50  # Maximum concurrent SSE connections
MAX_SSE_CONNECTION_TIME = 900  # 15 minutes maximum SSE connection time
active_sse_connections = 0
sse_connections_lock = threading.Lock()

# Global variables for metrics and scheduling
cached_metrics = None
last_metrics_update_time = None
scheduler_last_successful_run = None
scheduler_recreate_lock = threading.Lock()

# Track scheduler health
scheduler = None

# Global start time
SERVER_START_TIME = datetime.now(ZoneInfo(get_timezone()))

# Configure logging with rotation
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "dashboard.log")

log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logger = logging.getLogger()
logger.setLevel(getattr(logging, log_level, logging.INFO))

formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5)
file_handler.setFormatter(formatter)

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)

logger.handlers.clear()
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Initialize state manager with Redis URL from environment
redis_url = os.environ.get("REDIS_URL")
state_manager = StateManager(redis_url)

# Initialize notification service after state_manager
notification_service = NotificationService(state_manager)


# --- Disable Client Caching for All Responses ---
@app.after_request
def add_header(response):
    """Disable browser caching for all responses."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# --- Memory usage monitoring ---
def log_memory_usage():
    """Log current memory usage."""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        logging.info(f"Memory usage: {mem_info.rss / 1024 / 1024:.2f} MB (RSS)")

        # Log the size of key data structures
        arrow_entries = sum(len(v) for v in state_manager.get_history().values() if isinstance(v, (list, deque)))
        logging.info(f"Arrow history entries: {arrow_entries}")
        logging.info(f"Metrics log entries: {len(state_manager.get_metrics_log())}")
        logging.info(f"Active SSE connections: {active_sse_connections}")
    except Exception as e:
        logging.error(f"Error logging memory usage: {e}")


def adaptive_gc(force_level=None):
    """
    Run garbage collection adaptively based on memory pressure.

    Args:
        force_level (int, optional): Force collection of this generation. If None,
                                    determine based on memory pressure.

    Returns:
        bool: Whether garbage collection was performed
    """
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()

        # Log current memory usage
        logging.info(f"Memory usage before GC: {mem_percent:.1f}%")

        # Define thresholds for different GC actions
        if force_level is not None:
            # Force collection at specified level
            gc.collect(generation=force_level)
            logging.info(f"Forced garbage collection at generation {force_level}")
            gc_performed = True
        elif mem_percent > 80:  # Critical memory pressure
            logging.warning(f"Critical memory pressure detected: {mem_percent:.1f}% - Running full collection")
            gc.collect(generation=2)  # Full collection
            gc_performed = True
        elif mem_percent > 60:  # High memory pressure
            logging.info(f"High memory pressure detected: {mem_percent:.1f}% - Running generation 1 collection")
            gc.collect(generation=1)  # Intermediate collection
            gc_performed = True
        elif mem_percent > 40:  # Moderate memory pressure
            logging.info(f"Moderate memory pressure detected: {mem_percent:.1f}% - Running generation 0 collection")
            gc.collect(generation=0)  # Young generation only
            gc_performed = True
        else:
            # No collection needed
            return False

        # Log memory after collection
        new_mem_percent = process.memory_percent()
        memory_freed = mem_percent - new_mem_percent
        if memory_freed > 0:
            logging.info(f"Memory after GC: {new_mem_percent:.1f}% (freed {memory_freed:.1f}%)")
        else:
            logging.info(f"Memory after GC: {new_mem_percent:.1f}% (no memory freed)")

        return gc_performed
    except Exception as e:
        logging.error(f"Error in adaptive GC: {e}")
        return False


def check_for_memory_leaks():
    """Monitor object counts over time to identify potential memory leaks."""
    global object_counts_history, last_leak_check_time

    current_time = time.time()
    if current_time - last_leak_check_time < 3600:  # Check once per hour
        return

    last_leak_check_time = current_time

    try:
        # Get current counts
        type_counts = {}
        for obj in gc.get_objects():
            obj_type = type(obj).__name__
            if obj_type not in type_counts:
                type_counts[obj_type] = 0
            type_counts[obj_type] += 1

        # Compare with previous counts
        if object_counts_history:
            potential_leaks = []
            for obj_type, count in type_counts.items():
                prev_count = object_counts_history.get(obj_type, 0)

                # Only consider types with significant count
                if prev_count > 100:
                    growth = count - prev_count
                    # Alert on significant growth
                    if growth > 0 and (growth / prev_count) > 0.5:
                        potential_leaks.append(
                            {
                                "type": obj_type,
                                "previous": prev_count,
                                "current": count,
                                "growth": f"{growth} (+{(growth/prev_count)*100:.1f}%)",
                            }
                        )

            if potential_leaks:
                logging.warning(f"Potential memory leaks detected: {potential_leaks}")
                # Generate notification
                notification_service.add_notification(
                    "Potential memory leaks detected",
                    f"Unusual growth in {len(potential_leaks)} object types. Check logs for details.",
                    NotificationLevel.WARNING,
                    NotificationCategory.SYSTEM,
                )

        # Store current counts for next comparison
        object_counts_history = type_counts

    except Exception as e:
        logging.error(f"Error checking for memory leaks: {e}")


def record_memory_metrics():
    """Record memory usage metrics for trend analysis."""
    global memory_usage_history

    try:
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()

        # Record key metrics
        entry = {
            "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            "rss_mb": memory_info.rss / 1024 / 1024,
            "vms_mb": memory_info.vms / 1024 / 1024,
            "percent": process.memory_percent(),
            "arrow_history_entries": sum(
                len(v) for v in state_manager.get_history().values() if isinstance(v, (list, deque))
            ),
            "metrics_log_entries": len(state_manager.get_metrics_log()),
            "sse_connections": active_sse_connections,
        }

        with memory_usage_lock:
            memory_usage_history.append(entry)

            # Prune old entries
            if len(memory_usage_history) > MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"]:
                memory_usage_history = memory_usage_history[-MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"] :]

    except Exception as e:
        logging.error(f"Error recording memory metrics: {e}")


def memory_watchdog():
    """Monitor memory usage and take action if it gets too high."""
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()

        # Record memory metrics each time the watchdog runs
        record_memory_metrics()

        # Log memory usage periodically
        logging.info(f"Memory watchdog: Current usage: {mem_percent:.1f}%")

        # If memory usage exceeds the high watermark, take emergency action
        if mem_percent > MEMORY_CONFIG["MEMORY_HIGH_WATERMARK"]:
            logging.warning(f"Memory usage critical ({mem_percent:.1f}%) - performing emergency cleanup")

            # Emergency actions:
            # 1. Force garbage collection
            gc.collect(generation=2)

            # 2. Aggressively prune history data (pass aggressive=True)
            try:
                state_manager.prune_old_data(aggressive=True)
                logging.info("Aggressively pruned history data")
            except Exception as e:
                logging.error(f"Error pruning history data: {e}")

            # 3. Clear any non-critical caches
            ds = globals().get("dashboard_service")
            if ds and hasattr(ds, "cache"):
                ds.cache.clear()
                logging.info("Cleared dashboard service cache")

            # 4. Notify about the memory issue
            notification_service.add_notification(
                "High memory usage detected",
                f"Memory usage reached {mem_percent:.1f}%. Emergency cleanup performed.",
                NotificationLevel.WARNING,
                NotificationCategory.SYSTEM,
            )

            # Log memory after cleanup
            new_mem_percent = process.memory_percent()
            reduction = mem_percent - new_mem_percent
            logging.info(f"Memory after emergency cleanup: {new_mem_percent:.1f}% (reduced by {reduction:.1f}%)")

    except Exception as e:
        logging.error(f"Error in memory watchdog: {e}")


# --- Modified update_metrics_job function ---
def update_metrics_job(force=False):
    """
    Background job to update metrics.

    Args:
        force (bool): Whether to force update regardless of timing
    """
    global cached_metrics, last_metrics_update_time, scheduler, scheduler_last_successful_run

    logging.info("Starting update_metrics_job")

    try:
        # Check scheduler health - enhanced logic to detect failed executors
        if not scheduler or not hasattr(scheduler, "running"):
            logging.error("Scheduler object is invalid, attempting to recreate")
            with scheduler_recreate_lock:
                create_scheduler()
            return

        if not scheduler.running:
            logging.warning("Scheduler stopped unexpectedly, attempting to restart")
            try:
                scheduler.start()
                logging.info("Scheduler restarted successfully")
            except Exception as e:
                logging.error(f"Failed to restart scheduler: {e}")
                # More aggressive recovery - recreate scheduler entirely
                with scheduler_recreate_lock:
                    create_scheduler()
                return

        # Test the scheduler's executor by checking its state
        try:
            # Check if any jobs exist and are scheduled
            jobs = scheduler.get_jobs()
            if not jobs:
                logging.error("No jobs found in scheduler - recreating")
                with scheduler_recreate_lock:
                    create_scheduler()
                return

            # Check if the next run time is set for any job
            next_runs = [job.next_run_time for job in jobs]
            if not any(next_runs):
                logging.error("No jobs with next_run_time found - recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except RuntimeError as e:
            # Properly handle the "cannot schedule new futures after shutdown" error
            if "cannot schedule new futures after shutdown" in str(e):
                logging.error("Detected dead executor, recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except Exception as e:
            logging.error(f"Error checking scheduler state: {e}")

        # Skip update if the last one was too recent (prevents overlapping runs)
        # Unless force=True is specified
        current_time = time.time()
        if not force and last_metrics_update_time and (current_time - last_metrics_update_time < 30):
            logging.info("Skipping metrics update - previous update too recent")
            return

        # Set last update time to now
        last_metrics_update_time = current_time
        logging.info(f"Updated last_metrics_update_time: {last_metrics_update_time}")

        # Add timeout handling with a timer
        job_timeout = 45  # seconds
        job_successful = False

        def timeout_handler():
            """Log an error if the metrics update exceeds the timeout."""
            if not job_successful:
                logging.error("Background job timed out after 45 seconds")

        # Set timeout timer
        timer = threading.Timer(job_timeout, timeout_handler)
        timer.daemon = True
        timer.start()

        try:
            # Use the dashboard service to fetch metrics
            metrics = dashboard_service.fetch_metrics()
            if metrics:
                logging.info("Fetched metrics successfully")

                # Add config_reset flag to metrics from the config
                config = load_config()
                metrics["config_reset"] = config.get("config_reset", False)
                logging.info(f"Added config_reset flag to metrics: {metrics.get('config_reset')}")

                # First check for notifications by comparing new metrics with old cached metrics
                notification_service.check_and_generate_notifications(metrics, cached_metrics)

                # Then update cached metrics after comparison
                cached_metrics = metrics

                # Clear the config_reset flag after it's been used
                if metrics.get("config_reset"):
                    config = load_config()
                    if "config_reset" in config:
                        del config["config_reset"]
                        save_config(config)
                        logging.info("Cleared config_reset flag from configuration after use")

                # Update state history (only once)
                state_manager.update_metrics_history(metrics)

                logging.info("Background job: Metrics updated successfully")
                job_successful = True

                # Mark successful run time for watchdog
                scheduler_last_successful_run = time.time()
                logging.info(f"Updated scheduler_last_successful_run: {scheduler_last_successful_run}")

                # Persist critical state
                state_manager.persist_critical_state(
                    cached_metrics,
                    scheduler_last_successful_run,
                    last_metrics_update_time,
                )

                # Periodically check and prune data to prevent memory growth
                if current_time % 300 < 60:  # Every ~5 minutes
                    logging.info("Pruning old data")
                    state_manager.prune_old_data()

                # Only save state to Redis on a similar schedule, not every update
                if current_time % 300 < 60:  # Every ~5 minutes
                    logging.info("Saving graph state")
                    state_manager.save_graph_state()

                # Adaptive memory cleanup
                if MEMORY_CONFIG["ADAPTIVE_GC_ENABLED"]:
                    # Check memory usage every 10 minutes or on cache update
                    if current_time % 600 < 60 or force:
                        if adaptive_gc():
                            log_memory_usage()  # Log memory usage after GC
                else:
                    # Fixed interval full garbage collection
                    if current_time % MEMORY_CONFIG["GC_INTERVAL_SECONDS"] < 60:
                        interval = MEMORY_CONFIG["GC_INTERVAL_SECONDS"] // 60
                        logging.info(f"Scheduled full memory cleanup (every {interval} minutes)")
                        gc.collect(generation=2)  # Force full collection
                        log_memory_usage()
            else:
                logging.error("Background job: Metrics update returned None")
        except Exception as e:
            logging.error(f"Background job: Unexpected error: {e}")
            import traceback

            logging.error(traceback.format_exc())
            log_memory_usage()
        finally:
            # Cancel timer in finally block to ensure it's always canceled
            timer.cancel()
    except Exception as e:
        logging.error(f"Background job: Unhandled exception: {e}")
        import traceback

        logging.error(traceback.format_exc())
    logging.info("Completed update_metrics_job")


# --- SchedulerWatchdog to monitor and recover ---
def scheduler_watchdog():
    """Periodically check if the scheduler is running and healthy."""
    global scheduler, scheduler_last_successful_run

    try:
        # If no successful run in past 2 minutes, consider the scheduler dead
        if scheduler_last_successful_run is None or time.time() - scheduler_last_successful_run > 120:
            logging.warning("Scheduler watchdog: No successful runs detected in last 2 minutes")

            # Check if actual scheduler exists and is reported as running
            if not scheduler or not getattr(scheduler, "running", False):
                logging.error("Scheduler watchdog: Scheduler appears to be dead, recreating")

                # Use the lock to avoid multiple threads recreating simultaneously
                with scheduler_recreate_lock:
                    create_scheduler()
    except Exception as e:
        logging.error(f"Error in scheduler watchdog: {e}")


# --- Create Scheduler ---
def create_scheduler():
    """Create and configure a new scheduler instance with proper error handling."""
    try:
        # Stop existing scheduler if it exists
        global scheduler
        if "scheduler" in globals() and scheduler:
            try:
                # Check if scheduler is running before attempting to shut it down
                if hasattr(scheduler, "running") and scheduler.running:
                    logging.info("Shutting down existing scheduler before creating a new one")
                    scheduler.shutdown(wait=False)
            except Exception as e:
                logging.error(f"Error shutting down existing scheduler: {e}")

        # Create a new scheduler with more robust configuration
        new_scheduler = BackgroundScheduler(
            job_defaults={
                "coalesce": True,  # Combine multiple missed runs into a single one
                "max_instances": 1,  # Prevent job overlaps
                "misfire_grace_time": 30,  # Allow misfires up to 30 seconds
            }
        )

        # Add the update job
        new_scheduler.add_job(
            func=update_metrics_job, trigger="interval", seconds=60, id="update_metrics_job", replace_existing=True
        )

        # Add watchdog job - runs every 30 seconds to check scheduler health
        new_scheduler.add_job(
            func=scheduler_watchdog, trigger="interval", seconds=30, id="scheduler_watchdog", replace_existing=True
        )

        # Add memory watchdog job - runs every 5 minutes
        new_scheduler.add_job(
            func=memory_watchdog, trigger="interval", minutes=5, id="memory_watchdog", replace_existing=True
        )

        # Add memory leak check job - runs every hour
        new_scheduler.add_job(
            func=check_for_memory_leaks, trigger="interval", hours=1, id="memory_leak_check", replace_existing=True
        )

        # Start the scheduler
        new_scheduler.start()
        logging.info("Scheduler created and started successfully")
        scheduler = new_scheduler
        return new_scheduler
    except Exception as e:
        logging.error(f"Error creating scheduler: {e}")
        return None


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


# --- Fixed SSE Endpoint with proper request context handling ---
@app.route("/stream")
def stream():
    """SSE endpoint for real-time updates."""
    # Capture request information that will be needed inside the generator.
    try:
        start_event_id = int(request.headers.get("Last-Event-ID", 0))
    except ValueError:
        start_event_id = 0

    # The server now always streams the full history (MAX_HISTORY_ENTRIES)
    num_points = MAX_HISTORY_ENTRIES

    def event_stream(start_event_id, num_points):
        """Yield Server-Sent Events for dashboard updates."""
        global active_sse_connections, cached_metrics
        client_id = None

        try:
            # Check if we're at the connection limit
            with sse_connections_lock:
                if active_sse_connections >= MAX_SSE_CONNECTIONS:
                    logging.warning(f"Connection limit reached ({MAX_SSE_CONNECTIONS}), refusing new SSE connection")
                    yield 'data: {"error": "Too many connections, please try again later", "retry": 5000}\n\n'
                    return

                active_sse_connections += 1
                client_id = f"client-{int(time.time() * 1000) % 10000}"
                logging.info(f"SSE {client_id}: Connection established (total: {active_sse_connections})")

            # Set a maximum connection time - increased to 15 minutes for better user experience
            end_time = time.time() + MAX_SSE_CONNECTION_TIME
            last_timestamp = None
            last_ping_time = time.time()

            logging.info(f"SSE {client_id}: Streaming {num_points} history points")

            # Send initial data immediately to prevent delay in dashboard updates
            if cached_metrics:
                yield f"data: {json.dumps(cached_metrics)}\n\n"
                last_timestamp = cached_metrics.get("server_timestamp")
            else:
                # Send ping if no data available yet
                yield f'data: {{"type": "ping", "client_id": "{client_id}"}}\n\n'

            # Main event loop with improved error handling
            while time.time() < end_time:
                try:
                    # Send data only if it's changed
                    if cached_metrics and cached_metrics.get("server_timestamp") != last_timestamp:
                        # Create a slimmer version with essential fields for SSE updates
                        sse_metrics = {k: v for k, v in cached_metrics.items()}

                        # Trim history if necessary

                        # If arrow_history is very large, only send the configured number of points
                        if "arrow_history" in sse_metrics:
                            for key, values in sse_metrics["arrow_history"].items():
                                if len(values) > num_points:
                                    sse_metrics["arrow_history"][key] = values[-num_points:]

                        # Serialize data only once
                        data = json.dumps(sse_metrics)
                        last_timestamp = cached_metrics.get("server_timestamp")
                        yield f"data: {data}\n\n"

                    # Send regular pings about every 30 seconds to keep connection alive
                    if time.time() - last_ping_time >= 30:
                        last_ping_time = time.time()
                        yield (
                            f'data: {{"type": "ping", "time": {int(last_ping_time)}, '
                            f'"connections": {active_sse_connections}}}\n\n'
                        )

                    # Sleep to reduce CPU usage
                    time.sleep(1)

                    # Warn client 60 seconds before timeout so client can prepare to reconnect
                    remaining_time = end_time - time.time()
                    if remaining_time < 60 and int(remaining_time) % 15 == 0:  # Every 15 sec in last minute
                        yield f'data: {{"type": "timeout_warning", "remaining": {int(remaining_time)}}}\n\n'

                except Exception as e:
                    logging.error(f"SSE {client_id}: Error in stream: {e}")
                    time.sleep(2)  # Prevent tight error loops

            # Connection timeout reached - send a reconnect instruction to client
            logging.info(f"SSE {client_id}: Connection timeout reached ({MAX_SSE_CONNECTION_TIME}s)")
            yield 'data: {"type": "timeout", "message": "Connection timeout reached", "reconnect": true}\n\n'

        except GeneratorExit:
            # This is how we detect client disconnection
            logging.info(f"SSE {client_id}: Client disconnected (GeneratorExit)")
            # Don't yield here - just let the generator exit normally

        finally:
            # Always decrement the connection counter when done
            with sse_connections_lock:
                active_sse_connections = max(0, active_sse_connections - 1)
                logging.info(f"SSE {client_id}: Connection closed (remaining: {active_sse_connections})")

    # Configure response with improved error handling
    try:
        response = Response(stream_with_context(event_stream(start_event_id, num_points)), mimetype="text/event-stream")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"  # Disable nginx buffering
        response.headers["Access-Control-Allow-Origin"] = "*"  # Allow CORS
        return response
    except Exception as e:
        logging.error(f"Error creating SSE response: {e}")
        return jsonify({"error": "Internal server error"}), 500


# Duplicate stream endpoint for the dashboard path
@app.route("/dashboard/stream")
def dashboard_stream():
    """Duplicate of the stream endpoint for the dashboard route."""
    return stream()


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
    return jsonify(cached_metrics)


@app.route("/api/batch", methods=["POST"])
def batch_requests():
    """Process a list of API requests in one call."""
    try:
        requests_json = request.get_json(silent=True) or {}
        reqs = requests_json.get("requests", [])
        responses = []
        with app.test_client() as client:
            for item in reqs:
                path = item.get("path")
                method = item.get("method", "GET").upper()
                params = item.get("params")
                body = item.get("body")
                allowed_methods = {"GET", "POST", "PUT", "DELETE"}
                if (
                    not path
                    or not str(path).startswith("/api/")
                    or str(path) == "/api/batch"
                    or method not in allowed_methods
                ):
                    responses.append({"status": 400, "body": {"error": "invalid request"}})
                    continue

                resp = client.open(path, method=method, json=body, query_string=params)
                try:
                    body_data = resp.get_json()
                except Exception:
                    body_data = resp.data.decode("utf-8")
                responses.append({"status": resp.status_code, "body": body_data})
        return jsonify({"responses": responses})
    except Exception as e:
        logging.error(f"Error in batch handler: {e}")
        return jsonify({"error": str(e)}), 500


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


# --- New Config Endpoints ---
@app.route("/api/config", methods=["GET"])
def get_config():
    """API endpoint to get current configuration."""
    try:
        config = load_config()
        return jsonify(config)
    except Exception as e:
        logging.error(f"Error getting configuration: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/config", methods=["POST"])
def update_config():
    """API endpoint to update configuration."""
    global dashboard_service, worker_service

    try:
        # Get the request data
        new_config = request.json
        logging.info(f"Received config update request: {new_config}")

        # Validate the configuration data
        if not isinstance(new_config, dict):
            logging.error("Invalid configuration format")
            return jsonify({"error": "Invalid configuration format"}), 400

        # Get current config to check if currency is changing
        current_config = load_config()
        currency_changed = "currency" in new_config and new_config.get("currency") != current_config.get(
            "currency", "USD"
        )

        # Required fields and default values
        defaults = {
            "wallet": "yourwallethere",
            "power_cost": 0.0,
            "power_usage": 0.0,
            "currency": "USD",  # Add default currency
        }

        # Merge new config with defaults for any missing fields
        for key, value in defaults.items():
            if key not in new_config or new_config[key] is None:
                new_config[key] = value

        # Save the configuration
        logging.info(f"Saving configuration: {new_config}")
        if save_config(new_config):
            # Important: Reinitialize the dashboard service with the new configuration
            if dashboard_service:
                try:
                    dashboard_service.close()
                except Exception as e:
                    logging.error(f"Error closing old dashboard service: {e}")

            dashboard_service = MiningDashboardService(
                new_config.get("power_cost", 0.0),
                new_config.get("power_usage", 0.0),
                new_config.get("wallet"),
                network_fee=new_config.get("network_fee", 0.0),
                worker_service=worker_service,
            )
            logging.info(f"Dashboard service reinitialized with new wallet: {new_config.get('wallet')}")

            # Update worker service to use the new dashboard service (with the updated wallet)
            worker_service.set_dashboard_service(dashboard_service)
            if hasattr(dashboard_service, "set_worker_service"):
                dashboard_service.set_worker_service(worker_service)
            notification_service.dashboard_service = dashboard_service
            logging.info("Worker service updated with the new dashboard service")

            # If currency changed, update notifications to use the new currency
            if currency_changed:
                try:
                    old_currency = current_config.get("currency", "USD")
                    logging.info(f"Currency changed from {old_currency} to {new_config['currency']}")
                    updated_count = notification_service.update_notification_currency(new_config["currency"])
                    logging.info(f"Updated {updated_count} notifications to use {new_config['currency']} currency")
                except Exception as e:
                    logging.error(f"Error updating notification currency: {e}")

            # Force a metrics update to reflect the new configuration
            update_metrics_job(force=True)
            logging.info("Forced metrics update after configuration change")

            # Return success response with the saved configuration
            return jsonify({"status": "success", "message": "Configuration saved successfully", "config": new_config})
        else:
            logging.error("Failed to save configuration")
            return jsonify({"error": "Failed to save configuration"}), 500
    except Exception as e:
        logging.error(f"Error updating configuration: {e}")
        return jsonify({"error": str(e)}), 500


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
        "connections": active_sse_connections,
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
        return jsonify({"error": str(e)}), 500


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
        return jsonify({"status": "error", "message": str(e)}), 500


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
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/memory-profile")
def memory_profile():
    """API endpoint for detailed memory profiling."""
    try:
        process = psutil.Process(os.getpid())

        # Get detailed memory info
        mem_info = process.memory_info()

        # Count objects by type
        type_counts = {}
        for obj in gc.get_objects():
            obj_type = type(obj).__name__
            if obj_type not in type_counts:
                type_counts[obj_type] = 0
            type_counts[obj_type] += 1

        # Sort types by count
        most_common = sorted([(k, v) for k, v in type_counts.items()], key=lambda x: x[1], reverse=True)[:15]

        # Get memory usage history stats
        memory_trend = {}
        if memory_usage_history:
            recent = memory_usage_history[-1]
            oldest = memory_usage_history[0] if len(memory_usage_history) > 1 else recent
            memory_trend = {
                "oldest_timestamp": oldest.get("timestamp"),
                "recent_timestamp": recent.get("timestamp"),
                "growth_mb": recent.get("rss_mb", 0) - oldest.get("rss_mb", 0),
                "growth_percent": recent.get("percent", 0) - oldest.get("percent", 0),
            }

        # Return comprehensive memory profile
        return jsonify(
            {
                "memory": {
                    "rss_mb": mem_info.rss / 1024 / 1024,
                    "vms_mb": mem_info.vms / 1024 / 1024,
                    "percent": process.memory_percent(),
                    "data_structures": {
                        "arrow_history": {
                            "entries": sum(
                                len(v) for v in state_manager.get_history().values() if isinstance(v, (list, deque))
                            ),
                            "keys": list(state_manager.get_history().keys()),
                        },
                        "metrics_log": {"entries": len(state_manager.get_metrics_log())},
                        "memory_usage_history": {"entries": len(memory_usage_history)},
                        "sse_connections": active_sse_connections,
                    },
                    "most_common_objects": dict(most_common),
                    "trend": memory_trend,
                },
                "gc": {
                    "garbage": len(gc.garbage),
                    "counts": gc.get_count(),
                    "threshold": gc.get_threshold(),
                    "enabled": gc.isenabled(),
                },
                "system": {
                    "uptime_seconds": (datetime.now(ZoneInfo(get_timezone())) - SERVER_START_TIME).total_seconds(),
                    "python_version": sys.version,
                },
            }
        )
    except Exception as e:
        logging.error(f"Error in memory profiling: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/memory-history")
def memory_history():
    """API endpoint for memory usage history."""
    with memory_usage_lock:
        history_copy = list(memory_usage_history)
    return jsonify(
        {
            "history": history_copy,
            "current": {
                "rss_mb": psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024,
                "percent": psutil.Process(os.getpid()).memory_percent(),
            },
        }
    )


@app.route("/api/force-gc", methods=["POST"])
def force_gc():
    """API endpoint to force garbage collection."""
    try:
        generation = request.json.get("generation", 2) if request.is_json else 2

        # Validate generation parameter
        if generation not in [0, 1, 2]:
            generation = 2

        # Run GC and time it
        start_time = time.time()
        objects_before = len(gc.get_objects())

        # Perform collection
        collected = gc.collect(generation)

        # Get stats
        duration = time.time() - start_time
        objects_after = len(gc.get_objects())

        # Log memory usage after collection
        log_memory_usage()

        return jsonify(
            {
                "status": "success",
                "collected": collected,
                "duration_seconds": duration,
                "objects_removed": objects_before - objects_after,
                "generation": generation,
            }
        )
    except Exception as e:
        logging.error(f"Error during forced GC: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/notifications")
def api_notifications():
    """API endpoint for notification data."""
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    unread_only = request.args.get("unread_only", "false").lower() == "true"
    category = request.args.get("category")
    level = request.args.get("level")

    notifications = notification_service.get_notifications(
        limit=limit, offset=offset, unread_only=unread_only, category=category, level=level
    )

    unread_count = notification_service.get_unread_count()

    return jsonify(
        {
            "notifications": notifications,
            "unread_count": unread_count,
            "total": len(notifications),
            "limit": limit,
            "offset": offset,
        }
    )


@app.route("/api/notifications/unread_count")
def api_unread_count():
    """API endpoint for unread notification count."""
    return jsonify({"unread_count": notification_service.get_unread_count()})


@app.route("/api/notifications/mark_read", methods=["POST"])
def api_mark_read():
    """API endpoint to mark notifications as read."""
    notification_id = request.json.get("notification_id")

    success = notification_service.mark_as_read(notification_id)

    return jsonify({"success": success, "unread_count": notification_service.get_unread_count()})


@app.route("/api/notifications/delete", methods=["POST"])
def api_delete_notification():
    """API endpoint to delete a notification."""
    notification_id = request.json.get("notification_id")

    if not notification_id:
        return jsonify({"error": "notification_id is required"}), 400

    success = notification_service.delete_notification(notification_id)

    return jsonify({"success": success, "unread_count": notification_service.get_unread_count()})


@app.route("/api/notifications/clear", methods=["POST"])
def api_clear_notifications():
    """API endpoint to clear notifications."""
    category = request.json.get("category")
    older_than_days = request.json.get("older_than_days")
    read_only = request.json.get("read_only", False)  # Get the read_only parameter with default False

    cleared_count = notification_service.clear_notifications(
        category=category,
        older_than_days=older_than_days,
        read_only=read_only,  # Pass the parameter to the method
    )

    return jsonify(
        {"success": True, "cleared_count": cleared_count, "unread_count": notification_service.get_unread_count()}
    )


# Add notifications page route
@app.route("/notifications")
def notifications_page():
    """Serve the notifications page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
    return render_template("notifications.html", current_time=current_time)




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
        hashrate_keys = ["hashrate_60sec", "hashrate_3hr", "hashrate_10min", "hashrate_24hr"]
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
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/payout-history", methods=["GET", "POST", "DELETE"])
def payout_history():
    """API endpoint to manage payout history."""
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
        return jsonify({"error": str(e)}), 500


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
        return jsonify({"error": str(e)}), 500


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
                "Data fetch timeout",
                "Unable to fetch payment history data from Ocean.xyz. Showing limited earnings data.",
                NotificationLevel.WARNING,
                NotificationCategory.DATA,
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
                "Error fetching earnings data", f"Error: {str(e)}", NotificationLevel.ERROR, NotificationCategory.DATA
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
        return render_template("error.html", message="Failed to load earnings data. Please try again later."), 500


@app.route("/api/earnings")
def api_earnings():
    """API endpoint for earnings data."""
    try:
        # Get the earnings data with a reasonable timeout
        earnings_data = dashboard_service.get_earnings_data()
        state_manager.save_last_earnings(earnings_data)
        return jsonify(earnings_data)
    except Exception as e:
        logging.error(f"Error in earnings API endpoint: {e}")
        return jsonify({"error": str(e)}), 500


# Add the middleware
app.wsgi_app = RobustMiddleware(app.wsgi_app)

# Update this section in App.py to properly initialize services

# Initialize the dashboard service with network fee parameter
config = load_config()
dashboard_service = MiningDashboardService(
    config.get("power_cost", 0.0),
    config.get("power_usage", 0.0),
    config.get("wallet"),
    network_fee=config.get("network_fee", 0.0),
    worker_service=None,
)
worker_service = WorkerService()
# Connect the services
if hasattr(dashboard_service, "set_worker_service"):
    dashboard_service.set_worker_service(worker_service)
worker_service.set_dashboard_service(dashboard_service)
notification_service.dashboard_service = dashboard_service

# Restore critical state if available
last_run, last_update = state_manager.load_critical_state()
if last_run:
    scheduler_last_successful_run = last_run
if last_update:
    last_metrics_update_time = last_update

# Initialize the scheduler
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

    # Log connection info before exit
    logging.info(f"Active SSE connections at shutdown: {active_sse_connections}")

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
