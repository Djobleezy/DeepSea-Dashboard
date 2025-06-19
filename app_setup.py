import os
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from config import load_config
from data_service import MiningDashboardService
from worker_service import WorkerService
from state_manager import StateManager
from notification_service import NotificationService


def configure_logging():
    """Configure root logger and return it."""
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "dashboard.log")
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logger = logging.getLogger()
    logger.setLevel(getattr(logging, log_level, logging.INFO))
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    from logging.handlers import RotatingFileHandler
    file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5)
    file_handler.setFormatter(formatter)
    if not hasattr(file_handler, "level"):
        file_handler.level = logging.NOTSET
    if not hasattr(file_handler, "filters"):
        file_handler.filters = []

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    if not hasattr(console_handler, "level"):
        console_handler.level = logging.NOTSET
    if not hasattr(console_handler, "filters"):
        console_handler.filters = []
    for handler in list(logger.handlers):
        try:
            handler.close()
        except Exception:
            pass
    logger.handlers = []
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    return logger


def init_state_manager():
    """Return a state manager configured from environment variables."""
    redis_url = os.environ.get("REDIS_URL")
    return StateManager(redis_url)


def init_services(state_manager):
    """Initialize dashboard, worker and notification services."""
    config = load_config()
    dashboard_service = MiningDashboardService(
        config.get("power_cost", 0.0),
        config.get("power_usage", 0.0),
        config.get("wallet"),
        network_fee=config.get("network_fee", 0.0),
        worker_service=None,
    )
    worker_service = WorkerService()
    if hasattr(dashboard_service, "set_worker_service"):
        dashboard_service.set_worker_service(worker_service)
    worker_service.set_dashboard_service(dashboard_service)
    notification_service = NotificationService(state_manager)
    notification_service.dashboard_service = dashboard_service
    return dashboard_service, worker_service, notification_service


def build_scheduler(update_job, watchdog_job, memory_job, leak_job, scheduler_cls=BackgroundScheduler):
    """Create and start a scheduler with the provided jobs."""
    scheduler = scheduler_cls(
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": 30,
        }
    )
    scheduler.add_job(func=update_job, trigger="interval", seconds=60, id="update_metrics_job", replace_existing=True)
    scheduler.add_job(func=watchdog_job, trigger="interval", seconds=30, id="scheduler_watchdog", replace_existing=True)
    scheduler.add_job(func=memory_job, trigger="interval", minutes=5, id="memory_watchdog", replace_existing=True)
    scheduler.add_job(func=leak_job, trigger="interval", hours=1, id="memory_leak_check", replace_existing=True)
    scheduler.start()
    logging.info("Scheduler created and started successfully")
    return scheduler
