"""Blueprint for notification-related routes."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any
from flask import Blueprint, jsonify, render_template, request

from config import get_timezone

notifications_bp = Blueprint("notifications", __name__)

_notification_service = None


def init_notification_routes(service: Any) -> None:
    """Store the notification service used by the routes."""
    global _notification_service
    _notification_service = service


@notifications_bp.route("/api/notifications")
def api_notifications():
    """Return notification data."""
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    unread_only = request.args.get("unread_only", "false").lower() == "true"
    category = request.args.get("category")
    level = request.args.get("level")

    notifications = _notification_service.get_notifications(
        limit=limit,
        offset=offset,
        unread_only=unread_only,
        category=category,
        level=level,
    )

    unread_count = _notification_service.get_unread_count()

    return jsonify(
        {
            "notifications": notifications,
            "unread_count": unread_count,
            "total": len(notifications),
            "limit": limit,
            "offset": offset,
        }
    )


@notifications_bp.route("/api/notifications/unread_count")
def api_unread_count():
    """Return unread notification count."""
    return jsonify({"unread_count": _notification_service.get_unread_count()})


@notifications_bp.route("/api/notifications/mark_read", methods=["POST"])
def api_mark_read():
    """Mark a notification as read."""
    notification_id = request.json.get("notification_id")
    success = _notification_service.mark_as_read(notification_id)
    return jsonify({"success": success, "unread_count": _notification_service.get_unread_count()})


@notifications_bp.route("/api/notifications/delete", methods=["POST"])
def api_delete_notification():
    """Delete a notification."""
    notification_id = request.json.get("notification_id")
    if not notification_id:
        return jsonify({"error": "notification_id is required"}), 400
    success = _notification_service.delete_notification(notification_id)
    return jsonify({"success": success, "unread_count": _notification_service.get_unread_count()})


@notifications_bp.route("/api/notifications/clear", methods=["POST"])
def api_clear_notifications():
    """Clear notifications based on filters."""
    category = request.json.get("category")
    older_than_days = request.json.get("older_than_days")
    read_only = request.json.get("read_only", False)
    include_block = request.json.get("include_block", False)

    cleared_count = _notification_service.clear_notifications(
        category=category,
        older_than_days=older_than_days,
        read_only=read_only,
        include_block=include_block,
    )

    return jsonify(
        {
            "success": True,
            "cleared_count": cleared_count,
            "unread_count": _notification_service.get_unread_count(),
        }
    )


@notifications_bp.route("/notifications")
def notifications_page():
    """Render the notifications page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
    return render_template("notifications.html", current_time=current_time)

