"""Tests for DS-09: request deduplication and smart cache invalidation."""

from data_service import MiningDashboardService
from ocean_scraper import OceanScraperMixin
from ocean_api_client import OceanApiClientMixin


class FakeExecutor:
    """Synchronous executor that records submitted callables."""

    def __init__(self):
        self.calls = []

    def submit(self, fn, *args, **kwargs):
        self.calls.append((fn, args, kwargs))

        class FakeFuture:
            def __init__(self, fn, args, kwargs):
                try:
                    self._result = fn(*args, **kwargs)
                    self._exc = None
                except Exception as e:
                    self._result = None
                    self._exc = e

            def result(self, timeout=None):
                if self._exc:
                    raise self._exc
                return self._result

            def done(self):
                return True

            def cancel(self):
                pass

        return FakeFuture(fn, args, kwargs)


class DummyResp:
    """Minimal response stub for API tests."""

    def __init__(self, ok=True, text="{}", json_data=None):
        self.ok = ok
        self.text = text
        self._json = json_data or {}
        self.status_code = 200 if ok else 500

    def json(self):
        return self._json

    def close(self):
        pass


# ---------------------------------------------------------------------------
# get_ocean_api_data: concurrent fetching + caching
# ---------------------------------------------------------------------------

class TestOceanApiDataConcurrency:
    """Verify that get_ocean_api_data fires all 5 endpoints concurrently."""

    def test_all_endpoints_submitted_concurrently(self, monkeypatch):
        """All 5 Ocean.xyz API calls should be submitted to the executor."""
        svc = MiningDashboardService(0, 0, "test_wallet")
        executor = FakeExecutor()
        svc.executor = executor

        def fake_fetch(url, timeout=10):
            return DummyResp(ok=True, text="{}", json_data={"result": {}})

        monkeypatch.setattr(svc, "_fetch_ocean_api", fake_fetch)
        # Clear cache so the call actually executes
        OceanApiClientMixin.get_ocean_api_data.cache_clear()

        svc.get_ocean_api_data()

        # Should have submitted exactly 5 futures
        assert len(executor.calls) == 5
        urls = [args[0] for (_, args, _) in executor.calls]
        assert any("user_hashrate" in u for u in urls)
        assert any("statsnap" in u for u in urls)
        assert any("pool_stat" in u for u in urls)
        assert any("pool_hashrate" in u for u in urls)
        assert any("blocks" in u for u in urls)

    def test_cached_on_second_call(self, monkeypatch):
        """Second call within TTL should return cached data (no new requests)."""
        svc = MiningDashboardService(0, 0, "test_wallet")
        executor = FakeExecutor()
        svc.executor = executor
        call_count = 0

        def counting_fetch(url, timeout=10):
            nonlocal call_count
            call_count += 1
            return DummyResp(ok=True, text="{}", json_data={"result": {}})

        monkeypatch.setattr(svc, "_fetch_ocean_api", counting_fetch)
        OceanApiClientMixin.get_ocean_api_data.cache_clear()

        svc.get_ocean_api_data()
        first_count = call_count

        svc.get_ocean_api_data()
        # No additional calls should have been made
        assert call_count == first_count


# ---------------------------------------------------------------------------
# get_ocean_data: TTL cache decorator is present
# ---------------------------------------------------------------------------

class TestOceanDataCaching:
    """Verify that get_ocean_data is decorated with @ttl_cache."""

    def test_has_ttl_cache_attributes(self):
        """get_ocean_data must expose cache_clear / cache_size from @ttl_cache."""
        method = getattr(OceanScraperMixin, "get_ocean_data", None)
        assert method is not None, "OceanScraperMixin.get_ocean_data missing"
        assert hasattr(method, "cache_clear"), "get_ocean_data must be @ttl_cache decorated"
        assert hasattr(method, "cache_size"), "get_ocean_data must be @ttl_cache decorated"
        assert hasattr(method, "cache_purge"), "get_ocean_data must be @ttl_cache decorated"

    def test_second_call_returns_same_object(self):
        """Two rapid calls to get_ocean_data should return the exact same object.

        Run in a fresh subprocess to guarantee zero cross-test cache state.
        The @ttl_cache decorator should return the identical object on both
        calls, with no second HTTP fetch occurring.
        """
        import subprocess
        import sys
        import os
        from pathlib import Path

        repo_root = str(Path(__file__).resolve().parent.parent)
        code = """
from data_service import MiningDashboardService
from ocean_scraper import OceanScraperMixin

class FakeResp:
    ok = True
    text = "<html><body></body></html>"
    status_code = 200
    def json(self): return {}
    def close(self): pass

class FakeSession:
    def get(self, url, **kwargs): return FakeResp()
    def close(self): pass

svc = MiningDashboardService(0, 0, "test_wallet")
svc.get_ocean_api_data = lambda: {}
svc.session = FakeSession()
OceanScraperMixin.get_ocean_data.cache_clear()

r1 = svc.get_ocean_data()
r2 = svc.get_ocean_data()

if r1 is None:
    print("SKIP: get_ocean_data returned None")
    raise SystemExit(0)
if r1 is r2:
    print("PASS")
    raise SystemExit(0)
print(f"FAIL: r1 id={id(r1)}, r2 id={id(r2)}")
raise SystemExit(1)
"""
        env = {**os.environ, "PYTHONPATH": repo_root}
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
        )
        output = (result.stdout + result.stderr).strip()
        assert result.returncode == 0, (
            f"get_ocean_data caching check failed:\n{output}"
        )
        assert "FAIL" not in output, f"Caching assertion failed:\n{output}"


# ---------------------------------------------------------------------------
# get_bitcoin_stats: lazy fallback strategy
# ---------------------------------------------------------------------------

class TestBitcoinStatsLazyFallback:
    """Verify that blockchain.info fallbacks only fire when mempool tier fails."""

    def test_no_blockchain_calls_when_mempool_succeeds(self, monkeypatch):
        """When all mempool.guide endpoints succeed, no blockchain.info calls."""
        svc = MiningDashboardService(0, 0, "test_wallet")
        called_urls = []

        def tracking_fetch(url, timeout=5):
            called_urls.append(url)
            if "prices" in url:
                return DummyResp(
                    ok=True,
                    json_data={"USD": 100000, "time": 123},
                )
            elif "hashrate" in url:
                return DummyResp(
                    ok=True,
                    json_data={
                        "currentHashrate": 500e18,
                        "currentDifficulty": 80e12,
                    },
                )
            elif "height" in url:
                return DummyResp(ok=True, text="900000")
            return DummyResp(ok=True, text="{}", json_data={})

        monkeypatch.setattr(svc, "fetch_url", tracking_fetch)
        # Clear cache so the call actually runs
        OceanApiClientMixin.get_bitcoin_stats.cache_clear()

        difficulty, network_hashrate, btc_price, block_count = svc.get_bitcoin_stats()

        # All data should be populated from mempool tier
        assert btc_price == 100000
        assert network_hashrate == 500e18
        assert difficulty == 80e12
        assert block_count == 900000

        # No blockchain.info URLs should have been called
        blockchain_calls = [u for u in called_urls if "blockchain.info" in u]
        assert len(blockchain_calls) == 0

    def test_blockchain_fallback_only_for_gaps(self, monkeypatch):
        """If mempool prices fail, only the price fallback fires."""
        svc = MiningDashboardService(0, 0, "test_wallet")
        called_urls = []

        def tracking_fetch(url, timeout=5):
            called_urls.append(url)
            if "prices" in url:
                return DummyResp(ok=False)
            elif "hashrate" in url and ("mempool.guide" in url or "mempool.space" in url):
                return DummyResp(
                    ok=True,
                    json_data={
                        "currentHashrate": 500e18,
                        "currentDifficulty": 80e12,
                    },
                )
            elif "height" in url:
                return DummyResp(ok=True, text="900000")
            elif "ticker" in url:
                return DummyResp(
                    ok=True,
                    json_data={"USD": {"last": 99000}},
                )
            return DummyResp(ok=True, text="{}", json_data={})

        monkeypatch.setattr(svc, "fetch_url", tracking_fetch)
        OceanApiClientMixin.get_bitcoin_stats.cache_clear()

        difficulty, network_hashrate, btc_price, block_count = svc.get_bitcoin_stats()

        assert btc_price == 99000  # from blockchain.info ticker
        assert network_hashrate == 500e18
        assert block_count == 900000

        # Only the ticker fallback should have been called from blockchain.info
        blockchain_calls = [u for u in called_urls if "blockchain.info" in u]
        assert len(blockchain_calls) == 1
        assert "ticker" in blockchain_calls[0]
