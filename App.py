"""
Main application module for the Bitcoin Mining Dashboard.
"""
import os
import logging
from logging.handlers import RotatingFileHandler
import time
import psutil
import signal
import sys
import threading
import json
import requests
from flask import Flask, render_template, jsonify, Response, request, stream_with_context
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask_caching import Cache
from notification_service import NotificationService, NotificationLevel, NotificationCategory

# Import custom modules
from config import load_config, save_config
from data_service import MiningDashboardService
from worker_service import WorkerService
from state_manager import StateManager, MAX_HISTORY_ENTRIES
from config import get_timezone
from scheduler_utils import update_metrics_job, create_scheduler
from routes.memory_routes import register_memory_routes
from routes.notification_routes import register_notification_routes


# Initialize Flask app
app = Flask(__name__)

@app.context_processor
def inject_request():
    """Inject the current request into the template context."""
    return dict(request=request)

# Set up caching using a simple in-memory cache
cache = Cache(app, config={'CACHE_TYPE': 'SimpleCache', 'CACHE_DEFAULT_TIMEOUT': 10})

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

formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

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



# --- Custom Template Filter ---
@app.template_filter('commafy')
def commafy(value):
    """Add commas to numbers for better readability."""
    try:
        # Check if the value is already a string with decimal places
        if isinstance(value, str) and '.' in value:
            # Split by decimal point
            integer_part, decimal_part = value.split('.')
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
@app.route('/stream')
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
                    yield "data: {\"error\": \"Too many connections, please try again later\", \"retry\": 5000}\n\n"
                    return
                
                active_sse_connections += 1
                client_id = f"client-{int(time.time() * 1000) % 10000}"
                logging.info(f"SSE {client_id}: Connection established (total: {active_sse_connections})")
            
            # Set a maximum connection time - increased to 15 minutes for better user experience
            end_time = time.time() + MAX_SSE_CONNECTION_TIME
            last_timestamp = None

            logging.info(f"SSE {client_id}: Streaming {num_points} history points")

            # Send initial data immediately to prevent delay in dashboard updates
            if cached_metrics:
                yield f"data: {json.dumps(cached_metrics)}\n\n"
                last_timestamp = cached_metrics.get("server_timestamp")
            else:
                # Send ping if no data available yet
                yield f"data: {{\"type\": \"ping\", \"client_id\": \"{client_id}\"}}\n\n"
            
            # Main event loop with improved error handling
            while time.time() < end_time:
                try:
                    # Send data only if it's changed
                    if cached_metrics and cached_metrics.get("server_timestamp") != last_timestamp:
                        # Create a slimmer version with essential fields for SSE updates
                        sse_metrics = {k: v for k, v in cached_metrics.items()}
    
                        # Trim history if necessary

                        # If arrow_history is very large, only send the configured number of points
                        if 'arrow_history' in sse_metrics:
                            for key, values in sse_metrics['arrow_history'].items():
                                if len(values) > num_points:
                                    sse_metrics['arrow_history'][key] = values[-num_points:]
    
                        # Serialize data only once
                        data = json.dumps(sse_metrics)
                        last_timestamp = cached_metrics.get("server_timestamp")
                        yield f"data: {data}\n\n"
                    
                    # Send regular pings about every 30 seconds to keep connection alive
                    if int(time.time()) % 30 == 0:
                        yield f"data: {{\"type\": \"ping\", \"time\": {int(time.time())}, \"connections\": {active_sse_connections}}}\n\n"
                    
                    # Sleep to reduce CPU usage
                    time.sleep(1)
                    
                    # Warn client 60 seconds before timeout so client can prepare to reconnect
                    remaining_time = end_time - time.time()
                    if remaining_time < 60 and int(remaining_time) % 15 == 0:  # Every 15 sec in last minute
                        yield f"data: {{\"type\": \"timeout_warning\", \"remaining\": {int(remaining_time)}}}\n\n"
                    
                except Exception as e:
                    logging.error(f"SSE {client_id}: Error in stream: {e}")
                    time.sleep(2)  # Prevent tight error loops
            
            # Connection timeout reached - send a reconnect instruction to client
            logging.info(f"SSE {client_id}: Connection timeout reached ({MAX_SSE_CONNECTION_TIME}s)")
            yield "data: {\"type\": \"timeout\", \"message\": \"Connection timeout reached\", \"reconnect\": true}\n\n"
            
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
        response = Response(stream_with_context(event_stream(start_event_id, num_points)),
                            mimetype="text/event-stream")
        response.headers['Cache-Control'] = 'no-cache'
        response.headers['X-Accel-Buffering'] = 'no'  # Disable nginx buffering
        response.headers['Access-Control-Allow-Origin'] = '*'  # Allow CORS
        return response
    except Exception as e:
        logging.error(f"Error creating SSE response: {e}")
        return jsonify({"error": "Internal server error"}), 500

# Duplicate stream endpoint for the dashboard path
@app.route('/dashboard/stream')
def dashboard_stream():
    """Duplicate of the stream endpoint for the dashboard route."""
    return stream()

# --- Routes ---
@app.route("/")
def boot():
    """Serve the boot sequence page."""
    return render_template("boot.html", base_url=request.host_url.rstrip('/'))

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
                "arrow_history": {}
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

@app.route("/api/available_timezones")
def available_timezones():
    """Return a list of available timezones."""
    from zoneinfo import available_timezones
    return jsonify({"timezones": sorted(available_timezones())})

@app.route('/api/timezone', methods=['GET'])
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
    
    return render_template("workers.html", 
                           current_time=current_time,
                           workers_total=workers_data.get('workers_total', 0),
                           workers_online=workers_data.get('workers_online', 0),
                           workers_offline=workers_data.get('workers_offline', 0),
                           total_hashrate=workers_data.get('total_hashrate', 0),
                           hashrate_unit=workers_data.get('hashrate_unit', 'TH/s'),
                           total_earnings=workers_data.get('total_earnings', 0),
                           daily_sats=workers_data.get('daily_sats', 0),
                           avg_acceptance_rate=workers_data.get('avg_acceptance_rate', 0))

@app.route("/api/workers")
def api_workers():
    """API endpoint for worker data."""
    # Get the force_refresh parameter from the query string (default: False)
    force_refresh = request.args.get('force', 'false').lower() == 'true'
    return jsonify(worker_service.get_workers_data(cached_metrics, force_refresh=force_refresh))

# --- New Time Endpoint for Fine Syncing ---
@app.route("/api/time")
def api_time():
    """API endpoint for server time."""
    return jsonify({ # correct time
        "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
        "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo(get_timezone())).isoformat()
    })

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
        currency_changed = (
            "currency" in new_config and 
            new_config.get("currency") != current_config.get("currency", "USD")
        )
        
        # Required fields and default values
        defaults = {
            "wallet": "yourwallethere",
            "power_cost": 0.0,
            "power_usage": 0.0,
            "currency": "USD"  # Add default currency
        }
        
        # Merge new config with defaults for any missing fields
        for key, value in defaults.items():
            if key not in new_config or new_config[key] is None:
                new_config[key] = value
                
        # Save the configuration
        logging.info(f"Saving configuration: {new_config}")
        if save_config(new_config):
            # Important: Reinitialize the dashboard service with the new configuration
            dashboard_service = MiningDashboardService(
                new_config.get("power_cost", 0.0),
                new_config.get("power_usage", 0.0),
                new_config.get("wallet"),
                network_fee=new_config.get("network_fee", 0.0),
                worker_service=worker_service
            )
            logging.info(f"Dashboard service reinitialized with new wallet: {new_config.get('wallet')}")

            # Update worker service to use the new dashboard service (with the updated wallet)
            worker_service.set_dashboard_service(dashboard_service)
            if hasattr(dashboard_service, 'set_worker_service'):
                dashboard_service.set_worker_service(worker_service)
            notification_service.dashboard_service = dashboard_service
            logging.info("Worker service updated with the new dashboard service")
            
            # If currency changed, update notifications to use the new currency
            if currency_changed:
                try:
                    logging.info(f"Currency changed from {current_config.get('currency', 'USD')} to {new_config['currency']}")
                    updated_count = notification_service.update_notification_currency(new_config["currency"])
                    logging.info(f"Updated {updated_count} notifications to use {new_config['currency']} currency")
                except Exception as e:
                    logging.error(f"Error updating notification currency: {e}")
            
            # Force a metrics update to reflect the new configuration
            update_metrics_job(force=True)
            logging.info("Forced metrics update after configuration change")
            
            # Return success response with the saved configuration
            return jsonify({
                "status": "success",
                "message": "Configuration saved successfully",
                "config": new_config
            })
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
        "uptime_formatted": f"{int(uptime_seconds // 3600)}h {int((uptime_seconds % 3600) // 60)}m {int(uptime_seconds % 60)}s",
        "connections": active_sse_connections,
        "memory": {
            "usage_mb": round(memory_usage_mb, 2),
            "percent": round(memory_percent, 2),
            "total_mb": round(memory_total_mb, 2)
        },
        "data": {
            "last_update": cached_metrics.get("server_timestamp") if cached_metrics else None,
            "age_seconds": int(data_age),
            "available": cached_metrics is not None
        },
        "scheduler": {
            "running": scheduler.running if hasattr(scheduler, "running") else False,
            "last_successful_run": scheduler_last_successful_run
        },
        "redis": {
            "connected": state_manager.redis_client is not None
        },
        "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat()
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
            "next_run": str(scheduler.get_jobs()[0].next_run_time) if hasattr(scheduler, "get_jobs") and scheduler.get_jobs() else None,
            "last_update": last_metrics_update_time,
            "time_since_update": time.time() - last_metrics_update_time if last_metrics_update_time else None,
            "last_successful_run": scheduler_last_successful_run,
            "time_since_successful": time.time() - scheduler_last_successful_run if scheduler_last_successful_run else None
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
            logging.info(f"Force refresh successful, new timestamp: {metrics['server_timestamp']}")
            return jsonify({"status": "success", "message": "Metrics refreshed", "timestamp": metrics['server_timestamp']})
        else:
            return jsonify({"status": "error", "message": "Failed to fetch metrics"}), 500
    except Exception as e:
        logging.error(f"Force refresh error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

    return render_template("error.html", message="Internal server error."), 500

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
        if state_manager and hasattr(state_manager, 'redis_client') and state_manager.redis_client:
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
@app.template_filter('format_datetime')
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
@app.route('/earnings')
def earnings():
    """Serve the earnings page with user's currency and timezone preferences."""
    try:
        # Get user's currency and timezone preferences
        from config import get_currency, get_timezone
        user_currency = get_currency()
        user_timezone = get_timezone()
        
        # Define currency symbols for common currencies
        currency_symbols = {
            'USD': '$', 
            'EUR': '€', 
            'GBP': '£', 
            'JPY': '¥',
            'CAD': 'C$',
            'AUD': 'A$',
            'CNY': '¥',
            'KRW': '₩',
            'BRL': 'R$',
            'CHF': 'Fr'
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
                if cached_metrics and 'unpaid_earnings' in cached_metrics:
                    earnings_data = {
                        'payments': [],
                        'total_payments': 0,
                        'total_paid_btc': 0,
                        'total_paid_sats': 0,
                        'total_paid_usd': 0,
                        'unpaid_earnings': cached_metrics.get('unpaid_earnings', 0),
                        'unpaid_earnings_sats': int(float(cached_metrics.get('unpaid_earnings', 0)) * 100000000),
                        'est_time_to_payout': cached_metrics.get('est_time_to_payout', 'Unknown'),
                        'monthly_summaries': [],
                        'timestamp': datetime.now(ZoneInfo(user_timezone)).isoformat()
                    }
                else:
                    earnings_data = {
                        'payments': [],
                        'total_payments': 0,
                        'total_paid_btc': 0,
                        'total_paid_sats': 0,
                        'total_paid_usd': 0,
                        'unpaid_earnings': 0,
                        'unpaid_earnings_sats': 0,
                        'est_time_to_payout': 'Unknown',
                        'monthly_summaries': [],
                        'timestamp': datetime.now(ZoneInfo(user_timezone)).isoformat()
                    }

            notification_service.add_notification(
                "Data fetch timeout",
                "Unable to fetch payment history data from Ocean.xyz. Showing limited earnings data.",
                NotificationLevel.WARNING,
                NotificationCategory.DATA
            )
        except Exception as e:
            logging.error(f"Error fetching earnings data: {e}")
            error_message = f"Error fetching earnings data: {e}"
            earnings_data = state_manager.get_last_earnings() or {
                'payments': [],
                'total_payments': 0,
                'total_paid_btc': 0,
                'total_paid_sats': 0,
                'total_paid_usd': 0,
                'unpaid_earnings': 0,
                'unpaid_earnings_sats': 0,
                'est_time_to_payout': 'Unknown',
                'monthly_summaries': [],
                'timestamp': datetime.now(ZoneInfo(user_timezone)).isoformat()
            }

            notification_service.add_notification(
                "Error fetching earnings data",
                f"Error: {str(e)}",
                NotificationLevel.ERROR,
                NotificationCategory.DATA
            )
        
        # Convert USD values to user's preferred currency if needed
        if user_currency != 'USD' and earnings_data:
            # Get exchange rate
            try:
                exchange_rates = dashboard_service.fetch_exchange_rates()
                exchange_rate = exchange_rates.get(user_currency, 1.0)
                
                # Total paid conversion
                if 'total_paid_usd' in earnings_data:
                    earnings_data['total_paid_fiat'] = earnings_data['total_paid_usd'] * exchange_rate
                
                # Monthly summaries conversion
                if 'monthly_summaries' in earnings_data:
                    for month in earnings_data['monthly_summaries']:
                        if 'total_usd' in month:
                            month['total_fiat'] = month['total_usd'] * exchange_rate
            except Exception as e:
                logging.error(f"Error converting currency: {e}")
                # Set fiat values equal to USD as fallback
                if 'total_paid_usd' in earnings_data:
                    earnings_data['total_paid_fiat'] = earnings_data['total_paid_usd']
                
                if 'monthly_summaries' in earnings_data:
                    for month in earnings_data['monthly_summaries']:
                        if 'total_usd' in month:
                            month['total_fiat'] = month['total_usd']
        else:
            # If currency is USD, just copy USD values
            if earnings_data:
                if 'total_paid_usd' in earnings_data:
                    earnings_data['total_paid_fiat'] = earnings_data['total_paid_usd']
                
                if 'monthly_summaries' in earnings_data:
                    for month in earnings_data['monthly_summaries']:
                        if 'total_usd' in month:
                            month['total_fiat'] = month['total_usd']
        
        return render_template(
            'earnings.html',
            earnings=earnings_data,
            error_message=error_message,
            user_currency=user_currency,
            user_timezone=user_timezone,
            currency_symbols=currency_symbols,
            current_time=datetime.now(ZoneInfo(user_timezone)).strftime("%b %d, %Y %I:%M:%S %p")
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
    worker_service=None
)
worker_service = WorkerService()
# Connect the services
if hasattr(dashboard_service, 'set_worker_service'):
    dashboard_service.set_worker_service(worker_service)
worker_service.set_dashboard_service(dashboard_service)
notification_service.dashboard_service = dashboard_service

# Restore critical state if available
last_run, last_update = state_manager.load_critical_state()
register_memory_routes(app, state_manager, lambda: active_sse_connections, SERVER_START_TIME)
register_notification_routes(app, notification_service)
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
            scheduler.shutdown(wait=True) # wait for running jobs to complete
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
