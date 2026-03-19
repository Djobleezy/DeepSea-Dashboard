"""Docker HEALTHCHECK script — does not require curl."""
import sys
import urllib.request
import urllib.error

try:
    urllib.request.urlopen("http://localhost:8000/api/health", timeout=5)
    sys.exit(0)
except Exception:
    sys.exit(1)
