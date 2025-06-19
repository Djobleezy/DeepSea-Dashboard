import sys
from pathlib import Path

# Ensure project root is on sys.path so tests can import modules
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# Pre-import pytz so tests that stub it don't override the real module
try:
    import pytz  # noqa: F401
except Exception:
    pass

# Ensure logging.handlers exists for tests that monkeypatch it
import logging.handlers
import flask  # noqa: F401
