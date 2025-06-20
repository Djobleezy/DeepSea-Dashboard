"""Scheduler management utilities for the dashboard application."""

import gc
import logging
import threading
import time
from apscheduler.schedulers.background import BackgroundScheduler

from app_setup import build_scheduler
from config import load_config, save_config
from memory_manager import (
    MEMORY_CONFIG,
    adaptive_gc,
    check_for_memory_leaks,
    log_memory_usage,
    memory_watchdog,
)

# Reference to the application module for shared state
_app = None


def configure(app_module):
    """Configure the scheduler service with the given app module."""
    global _app
    _app = app_module


def update_metrics_job(force=False):
    """Background job to update metrics."""
    global _app
    cached_metrics = _app.cached_metrics
    last_metrics_update_time = _app.last_metrics_update_time
    scheduler = _app.scheduler
    scheduler_last_successful_run = _app.scheduler_last_successful_run
    scheduler_recreate_lock = _app.scheduler_recreate_lock

    logging.info("Starting update_metrics_job")

    try:
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
            except Exception as e:  # pragma: no cover - defensive
                logging.error(f"Failed to restart scheduler: {e}")
                with scheduler_recreate_lock:
                    create_scheduler()
                return

        try:
            jobs = scheduler.get_jobs()
            if not jobs:
                logging.error("No jobs found in scheduler - recreating")
                with scheduler_recreate_lock:
                    create_scheduler()
                return

            next_runs = [job.next_run_time for job in jobs]
            if not any(next_runs):
                logging.error("No jobs with next_run_time found - recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except RuntimeError as e:
            if "cannot schedule new futures after shutdown" in str(e):
                logging.error("Detected dead executor, recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except Exception as e:  # pragma: no cover - defensive
            logging.error(f"Error checking scheduler state: {e}")

        current_time = time.time()
        if not force and last_metrics_update_time and (current_time - last_metrics_update_time < 30):
            logging.info("Skipping metrics update - previous update too recent")
            return

        last_metrics_update_time = current_time
        logging.info(f"Updated last_metrics_update_time: {last_metrics_update_time}")

        job_timeout = 45
        job_successful = False

        def timeout_handler():
            if not job_successful:
                logging.error("Background job timed out after 45 seconds")

        timer = threading.Timer(job_timeout, timeout_handler)
        timer.daemon = True
        timer.start()

        try:
            metrics = _app.dashboard_service.fetch_metrics()
            if metrics:
                logging.info("Fetched metrics successfully")

                config = load_config()
                metrics["config_reset"] = config.get("config_reset", False)
                logging.info(f"Added config_reset flag to metrics: {metrics.get('config_reset')}")

                _app.notification_service.check_and_generate_notifications(metrics, cached_metrics)

                cached_metrics = metrics

                if metrics.get("config_reset"):
                    config = load_config()
                    if "config_reset" in config:
                        del config["config_reset"]
                        save_config(config)
                        logging.info("Cleared config_reset flag from configuration after use")

                _app.state_manager.update_metrics_history(metrics)

                logging.info("Background job: Metrics updated successfully")
                job_successful = True

                scheduler_last_successful_run = time.time()
                logging.info(f"Updated scheduler_last_successful_run: {scheduler_last_successful_run}")

                _app.state_manager.persist_critical_state(
                    cached_metrics,
                    scheduler_last_successful_run,
                    last_metrics_update_time,
                )

                if current_time % 300 < 60:
                    logging.info("Pruning old data")
                    _app.state_manager.prune_old_data()

                if current_time % 300 < 60:
                    logging.info("Saving graph state")
                    _app.state_manager.save_graph_state()

                if MEMORY_CONFIG["ADAPTIVE_GC_ENABLED"]:
                    if current_time % 600 < 60 or force:
                        if adaptive_gc():
                            log_memory_usage()
                else:
                    if current_time % MEMORY_CONFIG["GC_INTERVAL_SECONDS"] < 60:
                        interval = MEMORY_CONFIG["GC_INTERVAL_SECONDS"] // 60
                        logging.info(f"Scheduled full memory cleanup (every {interval} minutes)")
                        gc.collect(generation=2)
                        log_memory_usage()
            else:
                logging.error("Background job: Metrics update returned None")
        except Exception as e:  # pragma: no cover - defensive
            logging.error(f"Background job: Unexpected error: {e}")
            import traceback

            logging.error(traceback.format_exc())
            log_memory_usage()
        finally:
            timer.cancel()
            if timer.is_alive():
                try:
                    timer.join()
                except Exception:  # pragma: no cover - defensive
                    pass
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Background job: Unhandled exception: {e}")
        import traceback

        logging.error(traceback.format_exc())
    logging.info("Completed update_metrics_job")

    _app.cached_metrics = cached_metrics
    _app.last_metrics_update_time = last_metrics_update_time
    _app.scheduler_last_successful_run = scheduler_last_successful_run


def scheduler_watchdog():
    """Periodically check if the scheduler is running and healthy."""
    global _app
    try:
        if _app.scheduler_last_successful_run is None or time.time() - _app.scheduler_last_successful_run > 120:
            logging.warning("Scheduler watchdog: No successful runs detected in last 2 minutes")

            if not _app.scheduler or not getattr(_app.scheduler, "running", False):
                logging.error("Scheduler watchdog: Scheduler appears to be dead, recreating")
                with _app.scheduler_recreate_lock:
                    create_scheduler()
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error in scheduler watchdog: {e}")


def create_scheduler():
    """Create and configure a new scheduler instance with proper error handling."""
    global _app
    try:
        if hasattr(_app, "scheduler") and _app.scheduler:
            try:
                if hasattr(_app.scheduler, "running") and _app.scheduler.running:
                    logging.info("Shutting down existing scheduler before creating a new one")
                    _app.scheduler.shutdown(wait=True)
            except Exception as e:  # pragma: no cover - defensive
                logging.error(f"Error shutting down existing scheduler: {e}")

        scheduler_cls = getattr(_app, "BackgroundScheduler", BackgroundScheduler)
        new_scheduler = build_scheduler(
            update_metrics_job,
            scheduler_watchdog,
            memory_watchdog,
            check_for_memory_leaks,
            scheduler_cls=scheduler_cls,
        )
        _app.scheduler = new_scheduler
        return new_scheduler
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error creating scheduler: {e}")
        return None
