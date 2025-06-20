import os
import logging
import time
import gc
import psutil
import threading
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

from data_service import MiningDashboardService
from notification_service import NotificationLevel, NotificationCategory
from config import get_timezone

# Memory management configuration
MEMORY_CONFIG = {
    "MAX_METRICS_LOG_ENTRIES": 180,
    "MAX_ARROW_HISTORY_ENTRIES": 180,
    "GC_INTERVAL_SECONDS": 3600,
    "MEMORY_HIGH_WATERMARK": 80.0,
    "ADAPTIVE_GC_ENABLED": True,
    "MEMORY_MONITORING_INTERVAL": 600,
    "MEMORY_HISTORY_MAX_ENTRIES": 288,
}

memory_usage_history = deque(maxlen=MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"])
memory_usage_lock = threading.Lock()
last_leak_check_time = 0
object_counts_history = {}
leak_growth_tracker = {}

state_manager = None
notification_service = None
get_dashboard_service = lambda: None
get_active_connections = lambda: 0

def init_memory_manager(sm, notif_service, dashboard_service_getter, active_connections_getter):
    """Initialize memory manager dependencies."""
    global state_manager, notification_service, get_dashboard_service, get_active_connections
    state_manager = sm
    notification_service = notif_service
    get_dashboard_service = dashboard_service_getter
    get_active_connections = active_connections_getter


def log_memory_usage():
    """Log current memory usage."""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        logging.info(f"Memory usage: {mem_info.rss / 1024 / 1024:.2f} MB (RSS)")

        arrow_entries = sum(
            len(v) for v in state_manager.get_history().values() if isinstance(v, (list, deque))
        )
        logging.info(f"Arrow history entries: {arrow_entries}")
        logging.info(f"Metrics log entries: {len(state_manager.get_metrics_log())}")
        logging.info(f"Active SSE connections: {get_active_connections()}")
    except Exception as e:
        logging.error(f"Error logging memory usage: {e}")


def adaptive_gc(force_level=None):
    """Run garbage collection adaptively based on memory pressure."""
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()
        logging.info(f"Memory usage before GC: {mem_percent:.1f}%")

        if force_level is not None:
            gc.collect(generation=force_level)
            logging.info(f"Forced garbage collection at generation {force_level}")
            gc_performed = True
        elif mem_percent > 80:
            logging.warning(
                f"Critical memory pressure detected: {mem_percent:.1f}% - Running full collection"
            )
            gc.collect(generation=2)
            gc_performed = True
        elif mem_percent > 60:
            logging.info(
                f"High memory pressure detected: {mem_percent:.1f}% - Running generation 1 collection"
            )
            gc.collect(generation=1)
            gc_performed = True
        elif mem_percent > 40:
            logging.info(
                f"Moderate memory pressure detected: {mem_percent:.1f}% - Running generation 0 collection"
            )
            gc.collect(generation=0)
            gc_performed = True
        else:
            return False

        new_mem_percent = process.memory_percent()
        memory_freed = mem_percent - new_mem_percent
        if memory_freed > 0:
            logging.info(
                f"Memory after GC: {new_mem_percent:.1f}% (freed {memory_freed:.1f}%)"
            )
        else:
            logging.info(f"Memory after GC: {new_mem_percent:.1f}% (no memory freed)")

        return gc_performed
    except Exception as e:
        logging.error(f"Error in adaptive GC: {e}")
        return False


def check_for_memory_leaks():
    """Monitor object counts over time and flag persistent growth."""
    global object_counts_history, last_leak_check_time, leak_growth_tracker

    current_time = time.time()
    if current_time - last_leak_check_time < 3600:
        return

    last_leak_check_time = current_time
    gc.collect()

    try:
        thread_count = threading.active_count()
        dashboard_services = [
            obj for obj in gc.get_objects() if isinstance(obj, MiningDashboardService)
        ]
        if len(dashboard_services) > 1:
            logging.warning(
                f"Multiple MiningDashboardService instances detected: {len(dashboard_services)}"
            )
        expected_thread_count = 50
        if thread_count > expected_thread_count:
            logging.warning(f"Excessive threads detected: {thread_count}")

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
                        leak_growth_tracker[obj_type] = leak_growth_tracker.get(obj_type, 0) + 1
                        if leak_growth_tracker[obj_type] >= 2:
                            potential_leaks.append(
                                {
                                    "type": obj_type,
                                    "previous": prev_count,
                                    "current": count,
                                    "growth": f"{growth} (+{(growth/prev_count)*100:.1f}%)",
                                }
                            )
                    else:
                        leak_growth_tracker.pop(obj_type, None)

            for t in list(leak_growth_tracker.keys()):
                if t not in type_counts or type_counts[t] <= object_counts_history.get(t, 0):
                    leak_growth_tracker.pop(t, None)

            if potential_leaks:
                logging.warning(f"Potential memory leaks detected: {potential_leaks}")
                if notification_service:
                    notification_service.add_notification(
                        "Potential memory leaks detected - "
                        f"{len(potential_leaks)} object types grew. "
                        "Check logs for details.",
                        level=NotificationLevel.WARNING,
                        category=NotificationCategory.SYSTEM,
                    )

        object_counts_history = type_counts

    except Exception as e:
        logging.error(f"Error checking for memory leaks: {e}")


def record_memory_metrics():
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
            "sse_connections": get_active_connections(),
        }

        with memory_usage_lock:
            desired_max = MEMORY_CONFIG["MEMORY_HISTORY_MAX_ENTRIES"]
            if memory_usage_history.maxlen != desired_max:
                memory_usage_history = deque(memory_usage_history, maxlen=desired_max)
            memory_usage_history.append(entry)

    except Exception as e:
        logging.error(f"Error recording memory metrics: {e}")


def memory_watchdog():
    """Monitor memory usage and take action if it gets too high."""
    try:
        process = psutil.Process(os.getpid())
        mem_percent = process.memory_percent()

        record_memory_metrics()
        logging.info(f"Memory watchdog: Current usage: {mem_percent:.1f}%")

        if mem_percent > MEMORY_CONFIG["MEMORY_HIGH_WATERMARK"]:
            logging.warning(
                f"Memory usage critical ({mem_percent:.1f}%) - performing emergency cleanup"
            )

            gc.collect(generation=2)

            try:
                state_manager.prune_old_data(aggressive=True)
                logging.info("Aggressively pruned history data")
            except Exception as e:
                logging.error(f"Error pruning history data: {e}")

            ds = get_dashboard_service()
            if ds:
                if hasattr(ds, "cache"):
                    cache_obj = ds.cache
                    if hasattr(cache_obj, "purge"):
                        cache_obj.purge()
                    elif hasattr(cache_obj, "clear"):
                        cache_obj.clear()
                    logging.info("Cleared dashboard service cache")
                if hasattr(ds, "purge_caches"):
                    try:
                        ds.purge_caches()
                        logging.info("Purged dashboard service caches")
                    except Exception as e:
                        logging.error(f"Error purging dashboard caches: {e}")

            if notification_service:
                notification_service.add_notification(
                    f"High memory usage detected - {mem_percent:.1f}% (emergency cleanup performed)",
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.SYSTEM,
                )

            new_mem_percent = process.memory_percent()
            reduction = mem_percent - new_mem_percent
            logging.info(
                f"Memory after emergency cleanup: {new_mem_percent:.1f}% (reduced by {reduction:.1f}%)"
            )

    except Exception as e:
        logging.error(f"Error in memory watchdog: {e}")
