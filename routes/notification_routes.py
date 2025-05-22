"""Notification API routes."""
from flask import jsonify, request, render_template
from datetime import datetime
from zoneinfo import ZoneInfo

from config import get_timezone


def register_notification_routes(app, notification_service):
    """Register notification related routes."""

    @app.route("/api/notifications")
    def api_notifications():
        """API endpoint for notification data."""
        limit = request.args.get("limit", 50, type=int)
        offset = request.args.get("offset", 0, type=int)
        unread_only = request.args.get("unread_only", "false").lower() == "true"
        category = request.args.get("category")
        level = request.args.get("level")

        notifications = notification_service.get_notifications(
            limit=limit,
            offset=offset,
            unread_only=unread_only,
            category=category,
            level=level,
        )

        unread_count = notification_service.get_unread_count()

        return jsonify(
            {
                "notifications": notifications,
                "unread_count": unread_count,
                "total": len(notifications),
                "limit": limit,
                "offset": offset,
            }
        )

    @app.route("/api/notifications/unread_count")
    def api_unread_count():
        """API endpoint for unread notification count."""
        return jsonify({"unread_count": notification_service.get_unread_count()})

    @app.route("/api/notifications/mark_read", methods=["POST"])
    def api_mark_read():
        """API endpoint to mark notifications as read."""
        notification_id = request.json.get("notification_id")
        success = notification_service.mark_as_read(notification_id)
        return jsonify({"success": success, "unread_count": notification_service.get_unread_count()})

    @app.route("/api/notifications/delete", methods=["POST"])
    def api_delete_notification():
        """API endpoint to delete a notification."""
        notification_id = request.json.get("notification_id")
        if not notification_id:
            return jsonify({"error": "notification_id is required"}), 400
        success = notification_service.delete_notification(notification_id)
        return jsonify({"success": success, "unread_count": notification_service.get_unread_count()})

    @app.route("/api/notifications/clear", methods=["POST"])
    def api_clear_notifications():
        """API endpoint to clear notifications."""
        category = request.json.get("category")
        older_than_days = request.json.get("older_than_days")
        read_only = request.json.get("read_only", False)
        cleared_count = notification_service.clear_notifications(
            category=category,
            older_than_days=older_than_days,
            read_only=read_only,
        )
        return jsonify({"success": True, "cleared_count": cleared_count, "unread_count": notification_service.get_unread_count()})

    @app.route("/notifications")
    def notifications_page():
        """Serve the notifications page."""
        current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
        return render_template("notifications.html", current_time=current_time)
