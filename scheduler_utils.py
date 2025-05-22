# Scheduler utility functions separated from App.py
import logging
import time
import threading
import gc
from apscheduler.schedulers.background import BackgroundScheduler

from config import load_config, save_config
from memory_utils import (
    MEMORY_CONFIG,
    memory_usage_history,
    memory_usage_lock,
    log_memory_usage,
    adaptive_gc,
    check_for_memory_leaks,
    memory_watchdog,
)


def update_metrics_job(force: bool = False):
    """Background job to update metrics."""
    import App  # type: ignore - local import to avoid circular dependency

    logging.info("Starting update_metrics_job")

    try:
        # Check scheduler health - enhanced logic to detect failed executors
        if not App.scheduler or not hasattr(App.scheduler, "running"):
            logging.error("Scheduler object is invalid, attempting to recreate")
            with App.scheduler_recreate_lock:
                create_scheduler()
            return

        if not App.scheduler.running:
            logging.warning("Scheduler stopped unexpectedly, attempting to restart")
            try:
                App.scheduler.start()
                logging.info("Scheduler restarted successfully")
            except Exception as exc:  # pragma: no cover
                logging.error("Failed to restart scheduler: %s", exc)
                with App.scheduler_recreate_lock:
                    create_scheduler()
                return

        # Test the scheduler's executor by checking its state
        try:
            jobs = App.scheduler.get_jobs()
            if not jobs:
                logging.error("No jobs found in scheduler - recreating")
                with App.scheduler_recreate_lock:
                    create_scheduler()
                return

            next_runs = [job.next_run_time for job in jobs]
            if not any(next_runs):
                logging.error("No jobs with next_run_time found - recreating scheduler")
                with App.scheduler_recreate_lock:
                    create_scheduler()
                return
        except RuntimeError as exc:
            if "cannot schedule new futures after shutdown" in str(exc):
                logging.error("Detected dead executor, recreating scheduler")
                with App.scheduler_recreate_lock:
                    create_scheduler()
                return
        except Exception as exc:  # pragma: no cover
            logging.error("Error checking scheduler state: %s", exc)

        current_time = time.time()
        if not force and App.last_metrics_update_time and (
            current_time - App.last_metrics_update_time < 30
        ):
            logging.info("Skipping metrics update - previous update too recent")
            return

        App.last_metrics_update_time = current_time
        logging.info("Updated last_metrics_update_time: %s", App.last_metrics_update_time)

        job_timeout = 45
        job_successful = False

        def timeout_handler():
            if not job_successful:
                logging.error("Background job timed out after 45 seconds")

        timer = threading.Timer(job_timeout, timeout_handler)
        timer.daemon = True
        timer.start()

        try:
            metrics = App.dashboard_service.fetch_metrics()
            if metrics:
                logging.info("Fetched metrics successfully")

                config = load_config()
                metrics["config_reset"] = config.get("config_reset", False)
                logging.info("Added config_reset flag to metrics: %s", metrics.get("config_reset"))

                App.notification_service.check_and_generate_notifications(metrics, App.cached_metrics)

                App.cached_metrics = metrics

                if metrics.get("config_reset"):
                    config = load_config()
                    if "config_reset" in config:
                        del config["config_reset"]
                        save_config(config)
                        logging.info("Cleared config_reset flag from configuration after use")

                App.state_manager.update_metrics_history(metrics)

                logging.info("Background job: Metrics updated successfully")
                job_successful = True

                App.scheduler_last_successful_run = time.time()
                logging.info(
                    "Updated scheduler_last_successful_run: %s", App.scheduler_last_successful_run
                )

                App.state_manager.persist_critical_state(
                    App.cached_metrics,
                    App.scheduler_last_successful_run,
                    App.last_metrics_update_time,
                )

                if current_time % 300 < 60:
                    logging.info("Pruning old data")
                    App.state_manager.prune_old_data()

                if current_time % 300 < 60:
                    logging.info("Saving graph state")
                    App.state_manager.save_graph_state()

                if MEMORY_CONFIG["ADAPTIVE_GC_ENABLED"]:
                    if current_time % 600 < 60 or force:
                        if adaptive_gc():
                            log_memory_usage(App.state_manager, App.active_sse_connections)
                else:
                    if current_time % MEMORY_CONFIG["GC_INTERVAL_SECONDS"] < 60:
                        logging.info(
                            "Scheduled full memory cleanup (every %d minutes)",
                            MEMORY_CONFIG["GC_INTERVAL_SECONDS"] // 60,
                        )
                        gc.collect(generation=2)
                        log_memory_usage(App.state_manager, App.active_sse_connections)
            else:
                logging.error("Background job: Metrics update returned None")
        except Exception as exc:  # pragma: no cover
            logging.error("Background job: Unexpected error: %s", exc)
            import traceback

            logging.error(traceback.format_exc())
            log_memory_usage(App.state_manager, App.active_sse_connections)
        finally:
            timer.cancel()
    except Exception as exc:  # pragma: no cover
        logging.error("Background job: Unhandled exception: %s", exc)
        import traceback

        logging.error(traceback.format_exc())
    logging.info("Completed update_metrics_job")


def scheduler_watchdog():
    """Periodically check if the scheduler is running and healthy."""
    import App  # type: ignore

    try:
        if App.scheduler_last_successful_run is None or time.time() - App.scheduler_last_successful_run > 120:
            logging.warning("Scheduler watchdog: No successful runs detected in last 2 minutes")
            if not App.scheduler or not getattr(App.scheduler, "running", False):
                logging.error("Scheduler watchdog: Scheduler appears to be dead, recreating")
                with App.scheduler_recreate_lock:
                    create_scheduler()
    except Exception as exc:  # pragma: no cover
        logging.error("Error in scheduler watchdog: %s", exc)


def create_scheduler():
    """Create and configure a new scheduler instance with proper error handling."""
    import App  # type: ignore

    try:
        if "scheduler" in App.__dict__ and App.scheduler:
            try:
                if hasattr(App.scheduler, "running") and App.scheduler.running:
                    logging.info("Shutting down existing scheduler before creating a new one")
                    App.scheduler.shutdown(wait=False)
            except Exception as exc:  # pragma: no cover
                logging.error("Error shutting down existing scheduler: %s", exc)

        new_scheduler = BackgroundScheduler(
            job_defaults={
                "coalesce": True,
                "max_instances": 1,
                "misfire_grace_time": 30,
            }
        )

        new_scheduler.add_job(
            func=update_metrics_job,
            trigger="interval",
            seconds=60,
            id="update_metrics_job",
            replace_existing=True,
        )

        new_scheduler.add_job(
            func=scheduler_watchdog,
            trigger="interval",
            seconds=30,
            id="scheduler_watchdog",
            replace_existing=True,
        )

        new_scheduler.add_job(
            func=lambda: memory_watchdog(
                App.state_manager,
                App.dashboard_service,
                App.notification_service,
                App.active_sse_connections,
            ),
            trigger="interval",
            minutes=5,
            id="memory_watchdog",
            replace_existing=True,
        )

        new_scheduler.add_job(
            func=lambda: check_for_memory_leaks(App.notification_service),
            trigger="interval",
            hours=1,
            id="memory_leak_check",
            replace_existing=True,
        )

        new_scheduler.start()
        logging.info("Scheduler created and started successfully")
        App.scheduler = new_scheduler
        return new_scheduler
    except Exception as exc:  # pragma: no cover
        logging.error("Error creating scheduler: %s", exc)
        return None
