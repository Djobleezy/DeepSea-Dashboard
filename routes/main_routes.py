"""Routes for dashboard pages and APIs."""
from __future__ import annotations
import os
import psutil
from datetime import datetime, timedelta

import logging
import time
import requests
from zoneinfo import ZoneInfo

from notification_service import NotificationCategory, NotificationLevel
from flask import render_template, jsonify, request

from config import get_timezone


def register_main_routes(app, context: dict) -> None:
    """Register main dashboard and system routes."""

    get_cached_metrics = context["get_cached_metrics"]
    update_metrics_job = context["update_metrics_job"]
    worker_service = context["worker_service"]
    dashboard_service = context["dashboard_service"]
    state_manager = context["state_manager"]
    notification_service = context["notification_service"]
    get_active_connections = context["get_active_sse_connections"]
    server_start_time = context["server_start_time"]
    get_scheduler = context["get_scheduler"]
    get_last_metrics_update_time = context["get_last_metrics_update_time"]
    get_scheduler_last_successful_run = context["get_scheduler_last_successful_run"]

    @app.route("/")
    def boot():
        """Serve the boot sequence page."""
        return render_template("boot.html", base_url=request.host_url.rstrip("/"))

    @app.route("/dashboard")
    def dashboard():
        """Serve the main dashboard page."""
        cached_metrics = get_cached_metrics()
        if cached_metrics is None:
            logging.info("Dashboard accessed with no cached metrics - forcing immediate fetch")
            try:
                update_metrics_job(force=True)
            except Exception as exc:  # pragma: no cover - log unexpected error
                logging.error("Error during forced metrics fetch: %s", exc)

            cached_metrics = get_cached_metrics()
            if cached_metrics is None:
                default_metrics = {
                    "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
                    "server_start_time": server_start_time.astimezone(ZoneInfo(get_timezone())).isoformat(),
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
                    "arrow_history": {},
                }
                logging.warning("Rendering dashboard with default metrics - no data available yet")
                current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
                return render_template("dashboard.html", metrics=default_metrics, current_time=current_time)

        current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
        return render_template("dashboard.html", metrics=cached_metrics, current_time=current_time)

    @app.route("/api/metrics")
    def api_metrics():
        """API endpoint for metrics data."""
        metrics = get_cached_metrics()
        if metrics is None:
            update_metrics_job()
            metrics = get_cached_metrics()
        return jsonify(metrics)

    @app.route("/api/available_timezones")
    def available_timezones_route():
        """Return a list of available timezones."""
        from zoneinfo import available_timezones
        return jsonify({"timezones": sorted(available_timezones())})

    @app.route("/api/timezone", methods=["GET"])
    def get_timezone_config():
        """Return the configured timezone."""
        from config import get_timezone as cfg_timezone
        return jsonify({"timezone": cfg_timezone()})

    @app.route("/blocks")
    def blocks_page():
        """Serve the blocks overview page."""
        current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
        return render_template("blocks.html", current_time=current_time)

    @app.route("/workers")
    def workers_dashboard():
        """Serve the workers overview dashboard page."""
        current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %I:%M:%S %p")
        workers_data = worker_service.get_workers_data(get_cached_metrics())
        return render_template(
            "workers.html",
            current_time=current_time,
            workers_total=workers_data.get("workers_total", 0),
            workers_online=workers_data.get("workers_online", 0),
            workers_offline=workers_data.get("workers_offline", 0),
            total_hashrate=workers_data.get("total_hashrate", 0),
            hashrate_unit=workers_data.get("hashrate_unit", "TH/s"),
            total_earnings=workers_data.get("total_earnings", 0),
            daily_sats=workers_data.get("daily_sats", 0),
            avg_acceptance_rate=workers_data.get("avg_acceptance_rate", 0),
        )

    @app.route("/api/workers")
    def api_workers():
        """API endpoint for worker data."""
        force_refresh = request.args.get("force", "false").lower() == "true"
        return jsonify(worker_service.get_workers_data(get_cached_metrics(), force_refresh=force_refresh))

    @app.route("/api/time")
    def api_time():
        """API endpoint for server time."""
        return jsonify(
            {
                "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
                "server_start_time": server_start_time.astimezone(ZoneInfo(get_timezone())).isoformat(),
            }
        )

    @app.route("/api/health")
    def health_check():
        """Health check endpoint with diagnostics."""
        cached_metrics = get_cached_metrics()
        uptime_seconds = (datetime.now(ZoneInfo(get_timezone())) - server_start_time).total_seconds()
        try:
            process = psutil.Process(os.getpid())
            mem_info = process.memory_info()
            memory_usage_mb = mem_info.rss / 1024 / 1024
            memory_percent = process.memory_percent()
            memory_total_mb = psutil.virtual_memory().total / 1024 / 1024
        except Exception as exc:  # pragma: no cover
            logging.error("Error getting memory usage: %s", exc)
            memory_usage_mb = memory_percent = memory_total_mb = 0

        data_age = 0
        if cached_metrics and cached_metrics.get("server_timestamp"):
            try:
                last_update = datetime.fromisoformat(cached_metrics["server_timestamp"])
                data_age = (datetime.now(ZoneInfo(get_timezone())) - last_update).total_seconds()
            except Exception as exc:  # pragma: no cover
                logging.error("Error calculating data age: %s", exc)

        health_status = "healthy"
        if data_age > 300:
            health_status = "degraded"
        if not cached_metrics:
            health_status = "unhealthy"

        scheduler = get_scheduler()
        scheduler_last_successful_run = get_scheduler_last_successful_run()
        status = {
            "status": health_status,
            "uptime": uptime_seconds,
            "uptime_formatted": f"{int(uptime_seconds // 3600)}h {int((uptime_seconds % 3600) // 60)}m {int(uptime_seconds % 60)}s",
            "connections": get_active_connections(),
            "memory": {
                "usage_mb": round(memory_usage_mb, 2),
                "percent": round(memory_percent, 2),
                "total_mb": round(memory_total_mb, 2),
            },
            "data": {
                "last_update": cached_metrics.get("server_timestamp") if cached_metrics else None,
                "age_seconds": int(data_age),
                "available": cached_metrics is not None,
            },
            "scheduler": {
                "running": scheduler.running if hasattr(scheduler, "running") else False,
                "last_successful_run": scheduler_last_successful_run,
            },
            "redis": {"connected": state_manager.redis_client is not None},
            "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
        }

        if health_status != "healthy":
            logging.warning("Health check returning %s status: %s", health_status, status)
        return jsonify(status)

    @app.route("/api/scheduler-health")
    def scheduler_health():
        """API endpoint for scheduler health information."""
        scheduler = get_scheduler()
        scheduler_last_successful_run = get_scheduler_last_successful_run()
        last_metrics_update_time = get_last_metrics_update_time()
        try:
            scheduler_status = {
                "running": scheduler.running if hasattr(scheduler, "running") else False,
                "job_count": len(scheduler.get_jobs()) if hasattr(scheduler, "get_jobs") else 0,
                "next_run": str(scheduler.get_jobs()[0].next_run_time) if hasattr(scheduler, "get_jobs") and scheduler.get_jobs() else None,
                "last_update": last_metrics_update_time,
                "time_since_update": time.time() - last_metrics_update_time if last_metrics_update_time else None,
                "last_successful_run": scheduler_last_successful_run,
                "time_since_successful": time.time() - scheduler_last_successful_run if scheduler_last_successful_run else None,
            }
            return jsonify(scheduler_status)
        except Exception as exc:  # pragma: no cover
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/reset-chart-data", methods=["POST"])
    def reset_chart_data():
        """API endpoint to reset chart data history."""
        try:
            hashrate_keys = ["hashrate_60sec", "hashrate_3hr", "hashrate_10min", "hashrate_24hr"]
            state_manager.clear_arrow_history(hashrate_keys)
            if state_manager and getattr(state_manager, "redis_client", None):
                state_manager.last_save_time = 0
                state_manager.save_graph_state()
                logging.info("Chart data reset saved to Redis immediately")
            return jsonify({"status": "success", "message": "Chart data reset successfully"})
        except Exception as exc:  # pragma: no cover
            logging.error("Error resetting chart data: %s", exc)
            return jsonify({"status": "error", "message": str(exc)}), 500

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

            state_manager.clear_payout_history()
            return jsonify({"status": "success"})
        except Exception as exc:  # pragma: no cover
            logging.error("Error handling payout history: %s", exc)
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/block-events")
    def block_events():
        """Return recent block notifications for chart annotations."""
        try:
            limit = request.args.get("limit", 20, type=int)
            minutes = request.args.get("minutes", 180, type=int)
            notifications = notification_service.get_notifications(
                limit=limit * 5,
                category=NotificationCategory.BLOCK.value,
            )
            cutoff = notification_service._get_current_time() - timedelta(minutes=minutes)
            events = []
            for notif in notifications:
                ts = notif.get("timestamp")
                data = notif.get("data") or {}
                height = data.get("block_height")
                if ts and height:
                    when = notification_service._parse_timestamp(ts)
                    if when >= cutoff:
                        events.append({"timestamp": ts, "height": height})
                        if len(events) >= limit:
                            break
            events.sort(key=lambda e: e["timestamp"], reverse=True)
            return jsonify({"events": events})
        except Exception as exc:  # pragma: no cover
            logging.error("Error fetching block events: %s", exc)
            return jsonify({"error": str(exc)}), 500

    @app.template_filter("format_datetime")
    def format_datetime(value, timezone=None):
        """Format a datetime string according to the specified timezone."""
        if not value:
            return "None"

        import datetime as dt
        import pytz

        if timezone is None:
            timezone = get_timezone()

        try:
            if isinstance(value, str):
                parsed = dt.datetime.strptime(value, "%Y-%m-%d %H:%M")
            else:
                parsed = value

            if parsed.tzinfo is None:
                parsed = pytz.UTC.localize(parsed)
            user_tz = pytz.timezone(timezone)
            parsed = parsed.astimezone(user_tz)
            return parsed.strftime("%b %d, %Y %I:%M %p")
        except ValueError:  # pragma: no cover
            return value

    @app.route("/earnings")
    def earnings():
        """Serve the earnings page."""
        try:
            from config import get_currency, get_timezone as cfg_timezone
            user_currency = get_currency()
            user_timezone = cfg_timezone()
            currency_symbols = {
                "USD": "$",
                "EUR": "€",
                "GBP": "£",
                "JPY": "¥",
                "CAD": "C$",
                "AUD": "A$",
                "CNY": "¥",
                "KRW": "₩",
                "BRL": "R$",
                "CHF": "Fr",
            }
            error_message = None
            try:
                earnings_data = dashboard_service.get_earnings_data()
                state_manager.save_last_earnings(earnings_data)
            except requests.exceptions.ReadTimeout:
                logging.warning(
                    "Timeout fetching earnings data from ocean.xyz - using cached or fallback data"
                )
                error_message = "Timeout fetching earnings data. Showing cached information."
                earnings_data = state_manager.get_last_earnings() or {}
                if not earnings_data:
                    cached_metrics = get_cached_metrics()
                    if cached_metrics and "unpaid_earnings" in cached_metrics:
                        earnings_data = {
                            "payments": [],
                            "total_payments": 0,
                            "total_paid_btc": 0,
                            "total_paid_sats": 0,
                            "total_paid_usd": 0,
                            "unpaid_earnings": cached_metrics.get("unpaid_earnings", 0),
                            "unpaid_earnings_sats": int(float(cached_metrics.get("unpaid_earnings", 0)) * 100000000),
                            "est_time_to_payout": cached_metrics.get("est_time_to_payout", "Unknown"),
                            "monthly_summaries": [],
                            "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
                        }
                    else:
                        earnings_data = {
                            "payments": [],
                            "total_payments": 0,
                            "total_paid_btc": 0,
                            "total_paid_sats": 0,
                            "total_paid_usd": 0,
                            "unpaid_earnings": 0,
                            "unpaid_earnings_sats": 0,
                            "est_time_to_payout": "Unknown",
                            "monthly_summaries": [],
                            "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
                        }
                notification_service.add_notification(
                    "Data fetch timeout",
                    "Unable to fetch payment history data from Ocean.xyz. Showing limited earnings data.",
                    NotificationLevel.WARNING,
                    NotificationCategory.DATA,
                )
            except Exception as exc:
                logging.error("Error fetching earnings data: %s", exc)
                error_message = f"Error fetching earnings data: {exc}"
                earnings_data = state_manager.get_last_earnings() or {
                    "payments": [],
                    "total_payments": 0,
                    "total_paid_btc": 0,
                    "total_paid_sats": 0,
                    "total_paid_usd": 0,
                    "unpaid_earnings": 0,
                    "unpaid_earnings_sats": 0,
                    "est_time_to_payout": "Unknown",
                    "monthly_summaries": [],
                    "timestamp": datetime.now(ZoneInfo(user_timezone)).isoformat(),
                }
                notification_service.add_notification(
                    "Error fetching earnings data",
                    f"Error: {str(exc)}",
                    NotificationLevel.ERROR,
                    NotificationCategory.DATA,
                )

            if user_currency != "USD" and earnings_data:
                try:
                    exchange_rates = dashboard_service.fetch_exchange_rates()
                    exchange_rate = exchange_rates.get(user_currency, 1.0)
                    if "total_paid_usd" in earnings_data:
                        earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"] * exchange_rate
                    if "monthly_summaries" in earnings_data:
                        for month in earnings_data["monthly_summaries"]:
                            if "total_usd" in month:
                                month["total_fiat"] = month["total_usd"] * exchange_rate
                except Exception as exc:
                    logging.error("Error converting currency: %s", exc)
                    if "total_paid_usd" in earnings_data:
                        earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]
                    if "monthly_summaries" in earnings_data:
                        for month in earnings_data["monthly_summaries"]:
                            if "total_usd" in month:
                                month["total_fiat"] = month["total_usd"]
            else:
                if earnings_data:
                    if "total_paid_usd" in earnings_data:
                        earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]
                    if "monthly_summaries" in earnings_data:
                        for month in earnings_data["monthly_summaries"]:
                            if "total_usd" in month:
                                month["total_fiat"] = month["total_usd"]

            return render_template(
                "earnings.html",
                earnings=earnings_data,
                error_message=error_message,
                user_currency=user_currency,
                user_timezone=user_timezone,
                currency_symbols=currency_symbols,
                current_time=datetime.now(ZoneInfo(user_timezone)).strftime("%b %d, %Y %I:%M:%S %p"),
            )
        except Exception as exc:  # pragma: no cover
            logging.error("Error rendering earnings page: %s", exc)
            import traceback

            logging.error(traceback.format_exc())
            return (
                render_template("error.html", message="Failed to load earnings data. Please try again later."),
                500,
            )

    @app.route("/api/earnings")
    def api_earnings():
        """API endpoint for earnings data."""
        try:
            earnings_data = dashboard_service.get_earnings_data()
            state_manager.save_last_earnings(earnings_data)
            return jsonify(earnings_data)
        except Exception as exc:  # pragma: no cover
            logging.error("Error in earnings API endpoint: %s", exc)
            return jsonify({"error": str(exc)}), 500

