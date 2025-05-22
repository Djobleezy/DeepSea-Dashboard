"""Utility functions for monitoring and managing memory usage."""

import os
import gc
import time
import psutil
import logging
import threading
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

from notification_service import NotificationService, NotificationLevel, NotificationCategory
from config import get_timezone

# Memory management configuration
MEMORY_CONFIG = {
    "MAX_METRICS_LOG_ENTRIES": 180,
    "MAX_ARROW_HISTORY_ENTRIES": 180,
    "GC_INTERVAL_SECONDS": 3600,
    "MEMORY_HIGH_WATERMARK": 80.0,
    "ADAPTIVE_GC_ENABLED": True,
    "MEMORY_MONITORING_INTERVAL": 300,
    "MEMORY_HISTORY_MAX_ENTRIES": 72,
}

memory_usage_history = []
memory_usage_lock = threading.Lock()
last_leak_check_time = 0
object_counts_history = {}


def log_memory_usage(state_manager, active_sse_connections):
    """Log current memory usage statistics."""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        logging.info("Memory usage: %.2f MB (RSS)", mem_info.rss / 1024 / 1024)
        logging.info(
            "Arrow history entries: %d",
            sum(len(v) for v in state_manager.get_history().values() if isinstance(v, (list, deque))),
        )
        logging.info("Metrics log entries: %d", len(state_manager.get_metrics_log()))
        logging.info("Active SSE connections: %d", active_sse_connections)
    except Exception as exc:  # pragma: no cover - logging
        logging.error("Error logging memory usage: %s", exc)


def adaptive_gc(force_level=None):
    """Run garbage collection adaptively based on memory pressure."""
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()
        logging.info("Memory usage before GC: %.1f%%", mem_percent)

        if force_level is not None:
            gc.collect(generation=force_level)
            logging.info("Forced garbage collection at generation %d", force_level)
            gc_performed = True
        elif mem_percent > 80:
            logging.warning(
                "Critical memory pressure detected: %.1f%% - Running full collection", mem_percent
            )
            gc.collect(generation=2)
            gc_performed = True
        elif mem_percent > 60:
            logging.info(
                "High memory pressure detected: %.1f%% - Running generation 1 collection", mem_percent
            )
            gc.collect(generation=1)
            gc_performed = True
        elif mem_percent > 40:
            logging.info(
                "Moderate memory pressure detected: %.1f%% - Running generation 0 collection",
                mem_percent,
            )
            gc.collect(generation=0)
            gc_performed = True
        else:
            return False

        new_mem_percent = process.memory_percent()
        memory_freed = mem_percent - new_mem_percent
        if memory_freed > 0:
            logging.info(
                "Memory after GC: %.1f%% (freed %.1f%%)", new_mem_percent, memory_freed
            )
        else:
            logging.info("Memory after GC: %.1f%% (no memory freed)", new_mem_percent)
        return gc_performed
    except Exception as exc:  # pragma: no cover - logging
        logging.error("Error in adaptive GC: %s", exc)
        return False


def check_for_memory_leaks(notification_service: NotificationService):
    """Monitor object counts over time to identify potential leaks."""
    global object_counts_history, last_leak_check_time

    current_time = time.time()
    if current_time - last_leak_check_time < 3600:
        return
    last_leak_check_time = current_time

    try:
        type_counts = {}
        for obj in gc.get_objects():
            obj_type = type(obj).__name__
            type_counts[obj_type] = type_counts.get(obj_type, 0) + 1

        if object_counts_history:
            potential_leaks = []
            for obj_type, count in type_counts.items():
                prev_count = object_counts_history.get(obj_type, 0)
                if prev_count > 100:
                    growth = count - prev_count
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
                logging.warning("Potential memory leaks detected: %s", potential_leaks)
                notification_service.add_notification(
                    "Potential memory leaks detected",
                    f"Unusual growth in {len(potential_leaks)} object types. Check logs for details.",
                    NotificationLevel.WARNING,
                    NotificationCategory.SYSTEM,
                )
        object_counts_history = type_counts
    except Exception as exc:  # pragma: no cover - logging
        logging.error("Error checking for memory leaks: %s", exc)


def record_memory_metrics(state_manager, active_sse_connections):
    """Record memory usage metrics for trend analysis."""
    global memory_usage_history
    try:
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()
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
            if len(memory_usage_history) > MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"]:
                memory_usage_history = memory_usage_history[-MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"] :]
    except Exception as exc:  # pragma: no cover - logging
        logging.error("Error recording memory metrics: %s", exc)


def memory_watchdog(state_manager, dashboard_service, notification_service, active_sse_connections):
    """Monitor memory usage and perform emergency cleanup if needed."""
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()
        record_memory_metrics(state_manager, active_sse_connections)
        logging.info("Memory watchdog: Current usage: %.1f%%", mem_percent)
        if mem_percent > MEMORY_CONFIG["MEMORY_HIGH_WATERMARK"]:
            logging.warning(
                "Memory usage critical (%.1f%%) - performing emergency cleanup", mem_percent
            )
            gc.collect(generation=2)
            try:
                state_manager.prune_old_data(aggressive=True)
                logging.info("Aggressively pruned history data")
            except Exception as exc:  # pragma: no cover - logging
                logging.error("Error pruning history data: %s", exc)
            if hasattr(dashboard_service, "cache"):
                dashboard_service.cache.clear()
                logging.info("Cleared dashboard service cache")
            notification_service.add_notification(
                "High memory usage detected",
                f"Memory usage reached {mem_percent:.1f}%. Emergency cleanup performed.",
                NotificationLevel.WARNING,
                NotificationCategory.SYSTEM,
            )
            new_mem_percent = process.memory_percent()
            logging.info(
                "Memory after emergency cleanup: %.1f%% (reduced by %.1f%%)",
                new_mem_percent,
                mem_percent - new_mem_percent,
            )
    except Exception as exc:  # pragma: no cover - logging
        logging.error("Error in memory watchdog: %s", exc)

