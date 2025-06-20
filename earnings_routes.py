"""Blueprint for earnings-related routes."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests
from flask import Blueprint, Response, jsonify, render_template, request

from config import get_currency, get_timezone

earnings_bp = Blueprint("earnings", __name__)

_dashboard_service: Any | None = None
_state_manager: Any | None = None


def init_earnings_routes(dashboard_service: Any, state_manager: Any) -> None:
    """Initialize the blueprint with required services."""
    global _dashboard_service, _state_manager
    _dashboard_service = dashboard_service
    _state_manager = state_manager


@earnings_bp.app_template_filter("format_datetime")
def format_datetime(value: Any, timezone: str | None = None) -> str:
    """Format a datetime string according to the specified timezone."""
    if not value:
        return "None"

    import datetime as _dt
    import pytz

    if timezone is None:
        timezone = get_timezone()

    try:
        if isinstance(value, str):
            dt = _dt.datetime.strptime(value, "%Y-%m-%d %H:%M")
        else:
            dt = value
        if dt.tzinfo is None:
            dt = pytz.UTC.localize(dt)
        user_tz = pytz.timezone(timezone)
        dt = dt.astimezone(user_tz)
        return dt.strftime("%b %d, %Y %I:%M %p")
    except ValueError:
        return str(value)


def payments_to_csv(payments: list[dict[str, Any]]) -> str:
    """Convert a list of payment dictionaries to a CSV string."""
    with io.StringIO() as output:
        writer = csv.writer(output)
        writer.writerow(["date", "txid", "lightning_txid", "amount_btc", "amount_sats", "status"])
        for pay in payments:
            writer.writerow([
                pay.get("date", ""),
                pay.get("txid", ""),
                pay.get("lightning_txid", ""),
                pay.get("amount_btc", 0),
                pay.get("amount_sats", 0),
                pay.get("status", ""),
            ])
        return output.getvalue()


@earnings_bp.route("/earnings")
def earnings() -> Any:
    """Serve the earnings page with user's currency and timezone preferences."""
    try:
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
            error_message = "Timed out fetching earnings data"
            earnings_data = _state_manager.get_last_earnings() or {}
        except Exception:
            logging.exception("Error fetching earnings data")
            error_message = "Failed to fetch earnings data"
            earnings_data = _state_manager.get_last_earnings() or {}

        if user_currency != "USD" and earnings_data:
            if "total_paid_usd" in earnings_data:
                earnings_data["total_paid_fiat"] = earnings_data.get("total_paid_usd")
            if "monthly_summaries" in earnings_data:
                for month in earnings_data["monthly_summaries"]:
                    if "total_usd" in month:
                        month["total_fiat"] = month.get("total_usd")
        else:
            if earnings_data:
                if "total_paid_usd" in earnings_data:
                    earnings_data["total_paid_fiat"] = earnings_data.get("total_paid_usd")
                if "monthly_summaries" in earnings_data:
                    for month in earnings_data["monthly_summaries"]:
                        if "total_usd" in month:
                            month["total_fiat"] = month.get("total_usd")

        current_time = datetime.now(ZoneInfo(user_timezone)).strftime("%b %d, %Y %I:%M:%S %p")
        return render_template(
            "earnings.html",
            earnings=earnings_data,
            error_message=error_message,
            user_currency=user_currency,
            user_timezone=user_timezone,
            currency_symbols=currency_symbols,
            current_time=current_time,
        )
    except Exception:
        logging.exception("Error rendering earnings page")
        return render_template(
            "error.html",
            message="Failed to load earnings data. Please try again later.",
        ), 500


@earnings_bp.route("/api/earnings")
def api_earnings() -> Any:
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
    except Exception:
        logging.exception("Error in earnings API endpoint")
        return jsonify({"error": "internal server error"}), 500


@earnings_bp.route("/api/payout-history", methods=["GET", "POST", "DELETE"])
def payout_history() -> Any:
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


__all__ = [
    "earnings_bp",
    "init_earnings_routes",
    "earnings",
    "api_earnings",
    "payout_history",
    "payments_to_csv",
    "format_datetime",
]
