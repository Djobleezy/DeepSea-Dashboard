# Configuration-related routes blueprint

from __future__ import annotations

import logging
from typing import Any
from flask import Blueprint, jsonify, request

from config import load_config, save_config
from data_service import MiningDashboardService

config_bp = Blueprint("config", __name__)

_dashboard_service: Any | None = None
_worker_service: Any | None = None
_notification_service: Any | None = None
_update_metrics_job: Any | None = None


def init_config_routes(
    dashboard_service: Any,
    worker_service: Any,
    notification_service: Any,
    update_metrics_job: Any,
) -> None:
    """Initialize the blueprint with required services."""
    global _dashboard_service, _worker_service, _notification_service, _update_metrics_job
    _dashboard_service = dashboard_service
    _worker_service = worker_service
    _notification_service = notification_service
    _update_metrics_job = update_metrics_job


@config_bp.route("/api/config", methods=["GET"])
def get_config() -> Any:
    """Return the current application configuration."""
    try:
        config = load_config()
        return jsonify(config)
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error getting configuration: {e}")
        return jsonify({"error": "internal server error"}), 500


@config_bp.route("/api/config", methods=["POST"])
def update_config() -> Any:
    """Update the application configuration."""
    global _dashboard_service, _worker_service

    try:
        new_config = request.json
        logging.info("Received config update request: %s", new_config)
        if not isinstance(new_config, dict):
            logging.error("Invalid configuration format")
            return jsonify({"error": "Invalid configuration format"}), 400

        current_config = load_config()
        currency_changed = (
            "currency" in new_config
            and new_config.get("currency") != current_config.get("currency", "USD")
        )

        defaults = {
            "wallet": "yourwallethere",
            "power_cost": 0.0,
            "power_usage": 0.0,
            "currency": "USD",
            "EXCHANGE_RATE_API_KEY": "",
            "extended_history": False,
        }

        merged_config = {**current_config}
        for key, value in defaults.items():
            merged_config.setdefault(key, value)
        for key, value in new_config.items():
            if value is not None:
                merged_config[key] = value

        logging.info("Saving configuration: %s", merged_config)
        if save_config(merged_config):
            if _dashboard_service:
                try:
                    _dashboard_service.close()
                except Exception as e:  # pragma: no cover - defensive
                    logging.error("Error closing old dashboard service: %s", e)

            _dashboard_service = MiningDashboardService(
                merged_config.get("power_cost", 0.0),
                merged_config.get("power_usage", 0.0),
                merged_config.get("wallet"),
                network_fee=merged_config.get("network_fee", 0.0),
                worker_service=_worker_service,
            )
            try:
                import App

                App.dashboard_service = _dashboard_service
            except Exception as e:  # pragma: no cover - defensive
                logging.error("Error updating global dashboard service: %s", e)
            logging.info(
                "Dashboard service reinitialized with new wallet: %s",
                merged_config.get("wallet"),
            )

            _worker_service.set_dashboard_service(_dashboard_service)
            if hasattr(_dashboard_service, "set_worker_service"):
                _dashboard_service.set_worker_service(_worker_service)
            _notification_service.dashboard_service = _dashboard_service
            logging.info("Worker service updated with the new dashboard service")

            extended_changed = (
                "extended_history" in merged_config
                and merged_config.get("extended_history")
                != current_config.get("extended_history", False)
            )
            if extended_changed:
                try:
                    import App
                    from app_setup import init_state_manager
                    import memory_manager

                    old_sm = App.state_manager
                    if old_sm:
                        try:
                            old_sm.close()
                        except Exception as e:  # pragma: no cover - defensive
                            logging.error("Error closing old state manager: %s", e)

                    App.state_manager = init_state_manager()
                    memory_manager.state_manager = App.state_manager
                    _notification_service.state_manager = App.state_manager
                    logging.info(
                        "State manager reinitialized with extended_history=%s",
                        merged_config.get("extended_history"),
                    )
                    App.cached_metrics = None
                    logging.info("Cleared cached metrics after extended_history change")
                except Exception as e:  # pragma: no cover - defensive
                    logging.error("Error reinitializing state manager: %s", e)

            if currency_changed:
                try:
                    old_currency = current_config.get("currency", "USD")
                    logging.info(
                        "Currency changed from %s to %s",
                        old_currency,
                        merged_config["currency"],
                    )
                    updated_count = _notification_service.update_notification_currency(
                        merged_config["currency"]
                    )
                    logging.info(
                        "Updated %s notifications to use %s currency",
                        updated_count,
                        merged_config["currency"],
                    )
                except Exception as e:  # pragma: no cover - defensive
                    logging.error("Error updating notification currency: %s", e)

            _update_metrics_job(force=True)
            logging.info("Forced metrics update after configuration change")

            return jsonify(
                {
                    "status": "success",
                    "message": "Configuration saved successfully",
                    "config": merged_config,
                }
            )

        logging.error("Failed to save configuration")
        return jsonify({"error": "Failed to save configuration"}), 500
    except Exception as e:  # pragma: no cover - defensive
        logging.error("Error updating configuration: %s", e)
        return jsonify({"error": "internal server error"}), 500


__all__ = ["config_bp", "init_config_routes", "get_config", "update_config"]

