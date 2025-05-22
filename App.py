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

from routes.main_routes import register_main_routes

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
context = {
    "get_cached_metrics": lambda: cached_metrics,
    "update_metrics_job": (lambda force=False: update_metrics_job(force)),
    "worker_service": worker_service,
    "dashboard_service": dashboard_service,
    "state_manager": state_manager,
    "notification_service": notification_service,
    "get_active_sse_connections": lambda: active_sse_connections,
    "server_start_time": SERVER_START_TIME,
    "get_scheduler": lambda: scheduler,
    "get_last_metrics_update_time": lambda: last_metrics_update_time,
    "get_scheduler_last_successful_run": lambda: scheduler_last_successful_run,
}
register_main_routes(app, context)
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
