"""Blueprint for earnings and payout-related routes."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests
from flask import Blueprint, Response, jsonify, render_template, request

from notification_service import NotificationLevel, NotificationCategory

earnings_bp = Blueprint("earnings", __name__)

_dashboard_service: Any | None = None
_state_manager: Any | None = None
_notification_service: Any | None = None
_get_cached_metrics: Callable[[], Any] | None = None


def init_earnings_routes(
    dashboard_service: Any,
    state_manager: Any,
    notification_service: Any,
    get_cached_metrics: Callable[[], Any],
) -> None:
    """Initialize the blueprint with required services."""
    global _dashboard_service, _state_manager, _notification_service, _get_cached_metrics
    _dashboard_service = dashboard_service
    _state_manager = state_manager
    _notification_service = notification_service
    _get_cached_metrics = get_cached_metrics


def payments_to_csv(payments: list[dict]) -> str:
    """Convert a list of payment dictionaries to a CSV string."""
    with io.StringIO() as output:
        writer = csv.writer(output)
        writer.writerow(
            ["date", "txid", "lightning_txid", "amount_btc", "amount_sats", "status"]
        )
        for pay in payments:
            writer.writerow(
                [
                    pay.get("date", ""),
                    pay.get("txid", ""),
                    pay.get("lightning_txid", ""),
                    pay.get("amount_btc", 0),
                    pay.get("amount_sats", 0),
                    pay.get("status", ""),
                ]
            )
        return output.getvalue()


@earnings_bp.route("/earnings")
def earnings_page():
    """Serve the earnings page with user's currency and timezone preferences."""
    try:
        from config import get_currency, get_timezone

        user_currency = get_currency()
        user_timezone = get_timezone()

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
            earnings_data = _dashboard_service.get_earnings_data()
            _state_manager.save_last_earnings(earnings_data)
        except requests.exceptions.ReadTimeout:
            logging.warning(
                "Timeout fetching earnings data from ocean.xyz - using cached or fallback data"
            )
            error_message = "Timeout fetching earnings data. Showing cached information."
            earnings_data = _state_manager.get_last_earnings() or {}
            if not earnings_data:
                cached_metrics = _get_cached_metrics() if _get_cached_metrics else None
                if cached_metrics and "unpaid_earnings" in cached_metrics:
                    earnings_data = {
                        "payments": [],
                        "total_payments": 0,
                        "total_paid_btc": 0,
                        "total_paid_sats": 0,
                        "total_paid_usd": 0,
                        "unpaid_earnings": cached_metrics.get("unpaid_earnings", 0),
                        "unpaid_earnings_sats": int(
                            float(cached_metrics.get("unpaid_earnings", 0)) * 100000000
                        ),
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

            _notification_service.add_notification(
                "Data fetch timeout: Unable to fetch payment history data from Ocean.xyz. Showing limited earnings data.",
                level=NotificationLevel.WARNING,
                category=NotificationCategory.DATA,
            )
        except Exception as e:  # pragma: no cover - defensive
            logging.error(f"Error fetching earnings data: {e}")
            error_message = f"Error fetching earnings data: {e}"
            earnings_data = _state_manager.get_last_earnings() or {
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

            _notification_service.add_notification(
                f"Error fetching earnings data: {str(e)}",
                level=NotificationLevel.ERROR,
                category=NotificationCategory.DATA,
            )

        if user_currency != "USD" and earnings_data:
            try:
                exchange_rates = _dashboard_service.fetch_exchange_rates()
                exchange_rate = exchange_rates.get(user_currency, 1.0)

                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"] * exchange_rate

                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month["total_usd"] * exchange_rate
            except Exception as e:  # pragma: no cover - defensive
                logging.error(f"Error converting currency: {e}")
                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]

                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month["total_usd"]
        else:
            if earnings_data and "total_paid_usd" in earnings_data:
                earnings_data["total_paid_fiat"] = earnings_data["total_paid_usd"]

            if earnings_data and "monthly_summaries" in earnings_data:
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
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error rendering earnings page: {e}")
        return (
            render_template(
                "error.html",
                message="Failed to load earnings data. Please try again later.",
            ),
            500,
        )


@earnings_bp.route("/api/earnings")
def api_earnings():
    """API endpoint for earnings data."""
    try:
        earnings_data = _dashboard_service.get_earnings_data()
        if not isinstance(earnings_data, dict) or earnings_data.get("error"):
            if isinstance(earnings_data, dict):
                logging.error("Earnings data error: %s", earnings_data.get("error"))
            else:
                logging.error("Earnings data unavailable")
            return jsonify({"error": "internal server error"}), 500
        _state_manager.save_last_earnings(earnings_data)
        fmt = request.args.get("format", "json").lower()
        if fmt == "csv":
            csv_data = payments_to_csv(earnings_data.get("payments", []))
            headers = {"Content-Disposition": "attachment; filename=earnings.csv"}
            return Response(csv_data, mimetype="text/csv", headers=headers)
        return jsonify(earnings_data)
    except Exception:  # pragma: no cover - defensive
        logging.exception("Error in earnings API endpoint")
        return jsonify({"error": "internal server error"}), 500


@earnings_bp.route("/api/payout-history", methods=["GET", "POST", "DELETE"])
def payout_history():
    """Manage payout history through a simple REST style interface."""
    try:
        if request.method == "GET":
            history = _state_manager.get_payout_history()
            return jsonify({"payout_history": history})

        if request.method == "POST":
            data = request.get_json() or {}
            if "history" in data:
                if not isinstance(data["history"], list):
                    return jsonify({"error": "history must be a list"}), 400
                _state_manager.save_payout_history(data["history"])
                return jsonify({"status": "success"})

            if "record" in data:
                if not isinstance(data["record"], dict):
                    return jsonify({"error": "record must be an object"}), 400
                history = _state_manager.get_payout_history()
                history.insert(0, data["record"])
                if len(history) > 30:
                    history = history[:30]
                _state_manager.save_payout_history(history)
                return jsonify({"status": "success"})

            return jsonify({"error": "invalid data"}), 400

        _state_manager.clear_payout_history()
        return jsonify({"status": "success"})
    except Exception as e:  # pragma: no cover - defensive
        logging.error(f"Error handling payout history: {e}")
        return jsonify({"error": "internal server error"}), 500
