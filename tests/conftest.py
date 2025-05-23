import sys
from pathlib import Path
import types
import pytest

# Ensure project root is on sys.path so tests can import modules
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# Pre-import pytz so tests that stub it don't override the real module
try:
    import pytz  # noqa: F401
except Exception:
    pass


def install_dummy_pytz():
    """Install a lightweight pytz substitute if missing."""
    if "pytz" not in sys.modules:
        tz_module = types.ModuleType("pytz")

        class DummyTZInfo:
            def utcoffset(self, dt):
                return None

            def dst(self, dt):
                return None

            def tzname(self, dt):
                return "UTC"

            def localize(self, dt_obj):
                return dt_obj.replace(tzinfo=self)

        tz_module.timezone = lambda name: DummyTZInfo()
        sys.modules["pytz"] = tz_module
    return sys.modules["pytz"]


def install_dummy_requests():
    """Install a lightweight requests stub if missing."""
    if "requests" not in sys.modules:
        req_module = types.ModuleType("requests")

        class DummySession:
            def get(self, *args, **kwargs):
                raise NotImplementedError

        req_module.Session = DummySession
        req_module.exceptions = types.SimpleNamespace(Timeout=Exception, ConnectionError=Exception)
        sys.modules["requests"] = req_module
    return sys.modules["requests"]


def install_dummy_bs4():
    """Install a lightweight bs4 stub if missing."""
    if "bs4" not in sys.modules:
        bs4_module = types.ModuleType("bs4")

        class DummySoup:
            pass

        bs4_module.BeautifulSoup = DummySoup
        sys.modules["bs4"] = bs4_module
    return sys.modules["bs4"]


@pytest.fixture
def dummy_pytz():
    """Fixture ensuring a pytz stub is available."""
    return install_dummy_pytz()


@pytest.fixture
def dummy_requests():
    """Fixture ensuring a requests stub is available."""
    return install_dummy_requests()


@pytest.fixture
def dummy_bs4():
    """Fixture ensuring a bs4 stub is available."""
    return install_dummy_bs4()


@pytest.fixture
def dummy_deps(dummy_pytz, dummy_requests, dummy_bs4):
    """Fixture installing all dummy dependencies."""
    return dummy_pytz, dummy_requests, dummy_bs4
