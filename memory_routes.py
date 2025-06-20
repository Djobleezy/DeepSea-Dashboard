"""Blueprint for memory management endpoints."""

from __future__ import annotations

import gc
import logging
import os
import sys
import time
from collections import deque
from typing import Any

import psutil
from flask import Blueprint, jsonify, request

import memory_manager as mm
import sse_service

memory_bp = Blueprint("memory", __name__)


@memory_bp.route("/api/memory-profile")
def memory_profile() -> Any:
    """Return a detailed memory profile."""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()

        type_counts: dict[str, int] = {}
        for obj in gc.get_objects():
            obj_type = type(obj).__name__
            type_counts[obj_type] = type_counts.get(obj_type, 0) + 1
        most_common = sorted(type_counts.items(), key=lambda x: x[1], reverse=True)[:15]

        memory_trend: dict[str, Any] = {}
        if mm.memory_usage_history:
            recent = mm.memory_usage_history[-1]
            oldest = mm.memory_usage_history[0] if len(mm.memory_usage_history) > 1 else recent
            memory_trend = {
                "oldest_timestamp": oldest.get("timestamp"),
                "recent_timestamp": recent.get("timestamp"),
                "growth_mb": recent.get("rss_mb", 0) - oldest.get("rss_mb", 0),
                "growth_percent": recent.get("percent", 0) - oldest.get("percent", 0),
            }

        uptime_seconds = time.time() - process.create_time()
        return jsonify(
            {
                "memory": {
                    "rss_mb": mem_info.rss / 1024 / 1024,
                    "vms_mb": mem_info.vms / 1024 / 1024,
                    "percent": process.memory_percent(),
                    "data_structures": {
                        "arrow_history": {
                            "entries": sum(
                                len(v)
                                for v in mm.state_manager.get_history().values()
                                if isinstance(v, (list, deque))
                            ),
                            "keys": list(mm.state_manager.get_history().keys()),
                        },
                        "metrics_log": {"entries": len(mm.state_manager.get_metrics_log())},
                        "memory_usage_history": {"entries": len(mm.memory_usage_history)},
                        "sse_connections": sse_service.active_sse_connections,
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
                    "uptime_seconds": uptime_seconds,
                    "python_version": sys.version,
                },
            }
        )
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error in memory profiling: {e}")
        return jsonify({"error": "internal server error"}), 500


@memory_bp.route("/api/memory-history")
def memory_history() -> Any:
    """Return historical memory usage metrics."""
    with mm.memory_usage_lock:
        history_copy = list(mm.memory_usage_history)
    process = psutil.Process(os.getpid())
    return jsonify(
        {
            "history": history_copy,
            "current": {
                "rss_mb": process.memory_info().rss / 1024 / 1024,
                "percent": process.memory_percent(),
            },
        }
    )


@memory_bp.route("/api/force-gc", methods=["POST"])
def force_gc() -> Any:
    """Run garbage collection and report statistics."""
    try:
        generation = request.json.get("generation", 2) if request.is_json else 2
        if generation not in [0, 1, 2]:
            generation = 2
        start_time = time.time()
        objects_before = len(gc.get_objects())
        collected = gc.collect(generation)
        duration = time.time() - start_time
        objects_after = len(gc.get_objects())
        mm.log_memory_usage()
        return jsonify(
            {
                "status": "success",
                "collected": collected,
                "duration_seconds": duration,
                "objects_removed": objects_before - objects_after,
                "generation": generation,
            }
        )
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error during forced GC: {e}")
        return jsonify({"status": "error", "message": "internal server error"}), 500
