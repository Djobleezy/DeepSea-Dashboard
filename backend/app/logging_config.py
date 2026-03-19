"""Structured logging configuration for DeepSea Dashboard.

Configures JSON-formatted log output for production and a human-friendly
format for development.  Log level is controlled by the LOG_LEVEL env var
(default: INFO).

Usage::

    from app.logging_config import configure_logging, get_request_middleware

    configure_logging()          # call once at startup
    app.middleware("http")(get_request_middleware())  # register HTTP middleware
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Callable

from fastapi import Request
from fastapi.responses import Response


# ---------------------------------------------------------------------------
# JSON formatter
# ---------------------------------------------------------------------------

class _JsonFormatter(logging.Formatter):
    """Emit each log record as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        payload: dict = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Include any extra key=value pairs passed via the `extra=` kwarg
        for key, val in record.__dict__.items():
            if key not in {
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs",
                "message", "pathname", "process", "processName",
                "relativeCreated", "stack_info", "thread", "threadName",
                "exc_info", "exc_text",
            }:
                payload[key] = val
        return json.dumps(payload, default=str)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def configure_logging() -> None:
    """Set up root logger.  Call once during app startup."""
    log_level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    use_json = os.environ.get("LOG_FORMAT", "json").lower() == "json"

    handler = logging.StreamHandler()
    if use_json:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )

    root = logging.getLogger()
    root.setLevel(log_level)
    # Replace any existing handlers so we don't double-log
    root.handlers.clear()
    root.addHandler(handler)

    # Reduce noise from uvicorn access log (we have our own middleware)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def log_startup_banner(
    *,
    version: str,
    wallet_configured: bool,
    redis_connected: bool,
) -> None:
    """Emit a structured startup banner."""
    logger = logging.getLogger("deepsea.startup")
    logger.info(
        "DeepSea Dashboard starting",
        extra={
            "version": version,
            "wallet_configured": wallet_configured,
            "redis_connected": redis_connected,
            "log_level": os.environ.get("LOG_LEVEL", "INFO").upper(),
        },
    )


def get_request_middleware() -> Callable:
    """Return an async ASGI middleware function that logs each HTTP request."""
    _req_logger = logging.getLogger("deepsea.http")

    async def request_logging_middleware(request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        response: Response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)

        _req_logger.debug(
            "%s %s %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
                "client": request.client.host if request.client else "unknown",
            },
        )
        return response

    return request_logging_middleware
