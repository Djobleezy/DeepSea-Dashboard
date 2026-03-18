import sys
from pathlib import Path

import pytest

# Ensure project root is on sys.path so tests can import modules
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# Pre-import pytz so tests that stub it don't override the real module
try:
    import pytz  # noqa: F401
except Exception:
    pass

# Ensure logging.handlers exists for tests that monkeypatch it
import logging.handlers  # noqa: F401,E402
import flask  # noqa: F401,E402


@pytest.fixture(autouse=True)
def clear_ttl_caches():
    """Clear all ttl_cache state before each test to prevent cross-test interference.

    The ttl_cache decorator stores results in module-level WeakKeyDictionary
    closures.  Without explicit clearing, a cached result from one test can
    bleed into the next, producing false positives or false negatives.
    """
    try:
        from ocean_scraper import OceanScraperMixin
        from ocean_api_client import OceanApiClientMixin

        for method_name in ("get_ocean_data",):
            m = getattr(OceanScraperMixin, method_name, None)
            if m and hasattr(m, "cache_clear"):
                m.cache_clear()

        for method_name in ("get_ocean_api_data", "get_bitcoin_stats",
                             "get_block_reward", "get_average_fee_per_block"):
            m = getattr(OceanApiClientMixin, method_name, None)
            if m and hasattr(m, "cache_clear"):
                m.cache_clear()
    except Exception:
        pass
    yield
    # Optionally clear after too, for test ordering independence
    try:
        from ocean_scraper import OceanScraperMixin
        from ocean_api_client import OceanApiClientMixin

        for method_name in ("get_ocean_data",):
            m = getattr(OceanScraperMixin, method_name, None)
            if m and hasattr(m, "cache_clear"):
                m.cache_clear()

        for method_name in ("get_ocean_api_data", "get_bitcoin_stats",
                             "get_block_reward", "get_average_fee_per_block"):
            m = getattr(OceanApiClientMixin, method_name, None)
            if m and hasattr(m, "cache_clear"):
                m.cache_clear()
    except Exception:
        pass
