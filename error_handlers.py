"""Flask error handling utilities used across the dashboard."""

import logging
from flask import Blueprint, render_template

# Blueprint that holds the error handler routes. This object is imported by
# the main application when registering blueprints.
errors = Blueprint("errors", __name__)

@errors.app_errorhandler(404)
def page_not_found(error):
    """Return a friendly 404 error page."""
    return render_template("error.html", message="Page not found."), 404

@errors.app_errorhandler(500)
def internal_server_error(error):
    """Return a friendly 500 error page and log the exception."""
    logging.error("Internal server error: %s", error)
    return render_template("error.html", message="Internal server error."), 500

def register_error_handlers(app):
    """Register error handlers with the given Flask app."""
    app.register_blueprint(errors)
