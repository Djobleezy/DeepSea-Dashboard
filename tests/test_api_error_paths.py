"""Tests for API error handling and edge cases."""

import pytest
from unittest.mock import MagicMock, patch
import json

from data_service import MiningDashboardService
from cache_utils import CircuitBreaker
import ocean_api_client


class TestApiErrorPaths:
    """Test API error handling and circuit breaker behavior."""

    def setup_method(self):
        """Setup test service instance."""
        self.service = MiningDashboardService("test_wallet", 0, 0)

    def test_fetch_url_timeout_error(self, monkeypatch):
        """Test fetch_url handles timeout errors."""
        def mock_get(url, timeout=5):
            raise Exception("Connection timeout")

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.fetch_url("http://test.com", timeout=5)
        assert result is None

    def test_fetch_url_with_response_close_error(self, monkeypatch):
        """Test fetch_url handles response.close() exceptions."""
        response = MagicMock()
        response.ok = True
        response.text = "test"
        response.close.side_effect = Exception("Close error")

        def mock_get(url, timeout=5):
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.fetch_url("http://test.com")
        assert result is not None
        assert result.text == "test"

    def test_ocean_api_data_concurrent_futures_exception(self, monkeypatch):
        """Test get_ocean_api_data handles future submission exceptions."""
        # Mock executor to raise exception on submit
        mock_executor = MagicMock()
        mock_executor.submit.side_effect = Exception("Submit error")
        self.service.executor = mock_executor

        result = self.service.get_ocean_api_data()
        
        # Should return dict with hashrate fields set to None
        # (keys populated during parsing even when responses are empty)
        expected_keys = [
            "hashrate_60sec", "hashrate_5min", "hashrate_10min",
            "hashrate_24hr", "hashrate_3hr",
        ]
        for key in expected_keys:
            assert key in result
            assert result[key] is None

    def test_ocean_api_data_future_timeout(self, monkeypatch):
        """Test get_ocean_api_data handles future timeout exceptions."""
        mock_future = MagicMock()
        mock_future.result.side_effect = Exception("Future timeout")
        
        mock_executor = MagicMock()
        mock_executor.submit.return_value = mock_future
        self.service.executor = mock_executor

        result = self.service.get_ocean_api_data()
        
        # Should handle timeout gracefully
        assert isinstance(result, dict)

    def test_ocean_api_data_invalid_json_response(self, monkeypatch):
        """Test handling of invalid JSON in API responses."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.json.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)
        
        def mock_fetch(url, timeout):
            return mock_response

        monkeypatch.setattr(self.service, "_fetch_ocean_api", mock_fetch)
        
        # Mock executor to return our mock response
        mock_future = MagicMock()
        mock_future.result.return_value = mock_response
        mock_executor = MagicMock()
        mock_executor.submit.return_value = mock_future
        self.service.executor = mock_executor

        result = self.service.get_ocean_api_data()
        assert isinstance(result, dict)

    def test_ocean_api_data_separate_thread_pool(self, monkeypatch):
        """Test get_ocean_api_data uses separate thread pool when in executor thread."""
        # Mock current thread to appear as ThreadPoolExecutor thread
        mock_thread = MagicMock()
        mock_thread.name = "ThreadPoolExecutor-1-Thread-1"
        
        with patch('threading.current_thread', return_value=mock_thread):
            with patch('concurrent.futures.ThreadPoolExecutor') as mock_pool:
                mock_context = MagicMock()
                mock_pool.return_value = mock_context
                mock_context.__enter__.return_value = mock_context
                mock_context.submit.return_value = MagicMock()
                
                self.service.get_ocean_api_data()
                
                # Should have created separate thread pool
                mock_pool.assert_called_once_with(max_workers=5, thread_name_prefix="ocean-api")

    def test_fetch_ocean_api_circuit_breaker_open(self, monkeypatch):
        """Test _fetch_ocean_api respects circuit breaker state."""
        # Mock circuit breaker to be open
        mock_circuit = MagicMock()
        mock_circuit.call.side_effect = Exception("Circuit breaker open")
        
        monkeypatch.setattr(ocean_api_client, "_ocean_circuit", mock_circuit)
        
        result = self.service._fetch_ocean_api("http://test.com", 10)
        assert result is None

    def test_fetch_exchange_api_circuit_breaker_failure(self, monkeypatch):
        """Test _fetch_exchange_api handles circuit breaker failures."""
        mock_circuit = MagicMock()
        mock_circuit.call.side_effect = Exception("Exchange rate service down")
        
        monkeypatch.setattr(ocean_api_client, "_exchange_circuit", mock_circuit)
        
        result = self.service._fetch_exchange_api("http://test.com", 5)
        assert result is None

    def test_fetch_exchange_rates_no_api_key(self, monkeypatch):
        """Test fetch_exchange_rates returns empty dict when no API key configured."""
        monkeypatch.setattr("config.get_exchange_rate_api_key", lambda: None)
        # Clear cache to force a fresh fetch
        self.service.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
        
        result = self.service.fetch_exchange_rates()
        assert result == {}

    def test_fetch_exchange_rates_api_error(self, monkeypatch):
        """Test fetch_exchange_rates returns empty dict when API fails."""
        monkeypatch.setattr("config.get_exchange_rate_api_key", lambda: "fake-key")
        monkeypatch.setattr("config.get_currency", lambda: "USD")
        
        def mock_fetch_exchange(url, timeout):
            return None

        monkeypatch.setattr(self.service, "_fetch_exchange_api", mock_fetch_exchange)
        # Clear the cache to force a fresh fetch
        self.service.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
        
        result = self.service.fetch_exchange_rates()
        assert result == {}

    def test_get_payment_history_api_all_endpoints_fail(self, monkeypatch):
        """Test payment history API when all endpoints fail."""
        def mock_fetch_ocean_api(url, timeout):
            return None  # All API calls fail

        monkeypatch.setattr(self.service, "_fetch_ocean_api", mock_fetch_ocean_api)
        
        result = self.service.get_payment_history_api()
        assert result is None or isinstance(result, list)

    def test_get_payment_history_api_malformed_response(self, monkeypatch):
        """Test payment history API with malformed responses."""
        malformed_response = MagicMock()
        malformed_response.ok = True
        malformed_response.json.return_value = {
            "result": {
                "data": [
                    {"missing_required_fields": True},
                    {"amount": "not_a_number", "date": "invalid_date"},
                    None,  # null entry
                ]
            }
        }
        
        def mock_fetch_ocean_api(url, timeout):
            return malformed_response

        monkeypatch.setattr(self.service, "_fetch_ocean_api", mock_fetch_ocean_api)
        monkeypatch.setattr("ocean_api_client.get_timezone", lambda: "UTC")
        
        result = self.service.get_payment_history_api()
        # Should handle malformed entries gracefully and return None or empty list
        assert result is None or isinstance(result, list)

    def test_fetch_mempool_api_network_error(self, monkeypatch):
        """Test _fetch_mempool_api handles network errors."""
        mock_circuit = MagicMock()
        mock_circuit.call.side_effect = Exception("Network error")
        
        monkeypatch.setattr(ocean_api_client, "_mempool_circuit", mock_circuit)
        
        result = self.service._fetch_mempool_api("http://test.com", 5)
        assert result is None

    def test_fetch_mempool_api_returns_response(self, monkeypatch):
        """Test _fetch_mempool_api returns response on success."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.json.return_value = {"fastestFee": 10, "halfHourFee": 5, "hourFee": 3}
        
        mock_circuit = MagicMock()
        mock_circuit.call.return_value = mock_response
        
        monkeypatch.setattr(ocean_api_client, "_mempool_circuit", mock_circuit)
        
        result = self.service._fetch_mempool_api("http://test.com", 5)
        assert result == mock_response

    def test_fetch_ocean_api_response_close_exception(self, monkeypatch):
        """Test _fetch_ocean_api handles response.close() exceptions."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.close.side_effect = Exception("Close error")
        
        mock_circuit = MagicMock()
        mock_circuit.call.return_value = mock_response
        
        monkeypatch.setattr(ocean_api_client, "_ocean_circuit", mock_circuit)
        
        result = self.service._fetch_ocean_api("http://test.com", 10)
        assert result == mock_response  # Should still return the response

    def test_circuit_breaker_state_transitions(self):
        """Test circuit breaker open/close state transitions."""
        cb = CircuitBreaker("test", max_failures=2, reset_timeout=0.1)
        
        # Initially closed
        assert cb.state == CircuitBreaker.CLOSED
        
        # Fail twice to open circuit
        cb.call(lambda: (_ for _ in ()).throw(Exception("fail")))
        cb.call(lambda: (_ for _ in ()).throw(Exception("fail")))
        
        # Should now be open
        assert cb.state == CircuitBreaker.OPEN
        
        # Calls should be blocked while open (returns None)
        result = cb.call(lambda: "success")
        assert result is None

    def test_retry_request_max_retries_exceeded(self):
        """Test retry_request respects max retries limit."""
        from cache_utils import retry_request
        
        call_count = 0
        def failing_func():
            nonlocal call_count
            call_count += 1
            raise Exception("Always fails")
        
        result = retry_request(failing_func, retries=3, backoff=0.01)
        assert result is None
        assert call_count == 3  # Exactly 3 attempts (retries=3)

    def test_cached_response_json_parsing_error(self):
        """Test CachedResponse.json() handles parsing errors."""
        from ocean_api_client import CachedResponse
        
        cached_resp = CachedResponse(ok=True, status_code=200, text="invalid json")
        
        with pytest.raises(json.JSONDecodeError):
            cached_resp.json()

    def test_convert_to_ths_edge_cases(self):
        """Test convert_to_ths function with edge case inputs."""
        from models import convert_to_ths
        
        # Test with None — returns 0 (not None)
        assert convert_to_ths(None, "th/s") == 0
        
        # Test with zero — returns 0 (value <= 0 guard)
        assert convert_to_ths(0, "th/s") == 0
        
        # Test TH/s passthrough
        assert convert_to_ths(1.0, "th/s") == 1.0
        
        # Test GH/s → TH/s conversion
        assert convert_to_ths(1000, "GH/s") == pytest.approx(1.0)
        
        # Test PH/s → TH/s conversion
        assert convert_to_ths(1.0, "PH/s") == pytest.approx(1000.0)

    @patch('ocean_api_client.logging.error')
    def test_api_error_logging(self, mock_log, monkeypatch):
        """Test that API errors are properly logged."""
        def mock_get(url, timeout=5):
            raise Exception("Network error for testing")

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.fetch_url("http://test.com")
        assert result is None
        
        # Should have logged the error
        assert mock_log.called
