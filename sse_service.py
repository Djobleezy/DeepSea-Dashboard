"""Server-Sent Events (SSE) utilities."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Callable, Optional, Any

from flask import Blueprint, Response, jsonify, request, stream_with_context

from json_utils import convert_deques
import state_manager

# Default connection limits
MAX_SSE_CONNECTIONS = 50
MAX_SSE_CONNECTION_TIME = 900  # 15 minutes

active_sse_connections = 0
sse_connections_lock = threading.Lock()

_cached_metrics_getter: Optional[Callable[[], Any]] = None

sse_bp = Blueprint("sse", __name__)


def init_sse_service(metrics_getter: Callable[[], Any]) -> None:
    """Register the function used to retrieve cached metrics."""
    global _cached_metrics_getter
    _cached_metrics_getter = metrics_getter


def _get_cached_metrics() -> Any:
    if _cached_metrics_getter:
        return _cached_metrics_getter()
    return None


@sse_bp.route("/stream")
def stream() -> Response:
    """Stream real-time dashboard updates using SSE."""

    try:
        start_event_id = int(request.headers.get("Last-Event-ID", 0))
    except ValueError:
        start_event_id = 0

    num_points = state_manager.MAX_HISTORY_ENTRIES

    def event_stream(start_event_id: int, num_points: int):
        global active_sse_connections
        client_id = None
        incremented = False

        try:
            with sse_connections_lock:
                if active_sse_connections >= MAX_SSE_CONNECTIONS:
                    logging.warning(
                        "Connection limit reached (%s), refusing new SSE connection", MAX_SSE_CONNECTIONS
                    )
                    yield 'data: {"error": "Too many connections, please try again later", "retry": 5000}\n\n'
                    return

                active_sse_connections += 1
                incremented = True
                client_id = f"client-{int(time.time() * 1000) % 10000}"
                logging.info("SSE %s: Connection established (total: %s)", client_id, active_sse_connections)

            end_time = time.time() + MAX_SSE_CONNECTION_TIME
            last_timestamp = None
            last_ping_time = time.time()

            logging.info("SSE %s: Streaming %s history points", client_id, num_points)

            cached_metrics = _get_cached_metrics()
            if cached_metrics:
                initial_data = json.dumps(convert_deques(cached_metrics))
                yield f"data: {initial_data}\n\n"
                last_timestamp = cached_metrics.get("server_timestamp")
            else:
                yield f'data: {{"type": "ping", "client_id": "{client_id}"}}\n\n'

            while time.time() < end_time:
                try:
                    cached_metrics = _get_cached_metrics()
                    if cached_metrics and cached_metrics.get("server_timestamp") != last_timestamp:
                        sse_metrics = {k: v for k, v in cached_metrics.items()}

                        if "arrow_history" in sse_metrics:
                            for key, values in sse_metrics["arrow_history"].items():
                                if len(values) > num_points:
                                    sse_metrics["arrow_history"][key] = values[-num_points:]

                        data = json.dumps(convert_deques(sse_metrics))
                        last_timestamp = cached_metrics.get("server_timestamp")
                        yield f"data: {data}\n\n"

                    if time.time() - last_ping_time >= 30:
                        last_ping_time = time.time()
                        yield f'data: {{"type": "ping", "time": {int(last_ping_time)}, "connections": {active_sse_connections}}}\n\n'

                    time.sleep(1)

                    remaining_time = end_time - time.time()
                    if remaining_time < 60 and int(remaining_time) % 15 == 0:
                        yield f'data: {{"type": "timeout_warning", "remaining": {int(remaining_time)}}}\n\n'
                except Exception as e:
                    logging.error("SSE %s: Error in stream: %s", client_id, e)
                    time.sleep(2)

            logging.info("SSE %s: Connection timeout reached (%s s)", client_id, MAX_SSE_CONNECTION_TIME)
            yield 'data: {"type": "timeout", "message": "Connection timeout reached", "reconnect": true}\n\n'

        except GeneratorExit:
            logging.info("SSE %s: Client disconnected (GeneratorExit)", client_id)
        finally:
            with sse_connections_lock:
                if incremented:
                    active_sse_connections = max(0, active_sse_connections - 1)
                logging.info(
                    "SSE %s: Connection closed (remaining: %s)", client_id, active_sse_connections
                )

    try:
        response = Response(
            stream_with_context(event_stream(start_event_id, num_points)), mimetype="text/event-stream"
        )
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    except Exception as e:
        logging.error("Error creating SSE response: %s", e)
        return jsonify({"error": "Internal server error"}), 500


@sse_bp.route("/dashboard/stream")
def dashboard_stream() -> Response:
    """Alias of :func:`stream` for the dashboard route."""
    return stream()


__all__ = [
    "sse_bp",
    "init_sse_service",
    "stream",
    "dashboard_stream",
    "MAX_SSE_CONNECTIONS",
    "MAX_SSE_CONNECTION_TIME",
    "active_sse_connections",
    "sse_connections_lock",
]
