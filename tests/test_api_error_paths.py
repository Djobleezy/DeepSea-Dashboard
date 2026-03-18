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
        
        # Should return empty dict with API fields set to None
        expected_keys = [
            "hashrate_60sec", "hashrate_5min", "hashrate_10min", 
            "hashrate_24hr", "hashrate_3hr", "difficulty", 
            "last_block_time", "blocks_found"
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

    def test_fetch_exchange_rate_circuit_breaker_failure(self, monkeypatch):
        """Test exchange rate fetching with circuit breaker failures."""
        mock_circuit = MagicMock()
        mock_circuit.call.side_effect = Exception("Exchange rate service down")
        
        monkeypatch.setattr(ocean_api_client, "_exchange_circuit", mock_circuit)
        
        result = self.service.fetch_exchange_rate("http://test.com", 5)
        assert result is None

    def test_get_btc_price_all_sources_fail(self, monkeypatch):
        """Test BTC price fetching when all sources fail."""
        def mock_fetch_exchange(url, timeout):
            return None

        monkeypatch.setattr(self.service, "fetch_exchange_rate", mock_fetch_exchange)
        
        price = self.service.get_btc_price()
        assert price is None

    def test_get_btc_price_invalid_response_format(self, monkeypatch):
        """Test BTC price parsing with invalid response formats."""
        # Mock responses with various invalid formats
        invalid_responses = [
            MagicMock(ok=True, text="not json"),
            MagicMock(ok=True, text='{"no_price_field": 123}'),
            MagicMock(ok=True, text='{"USD": "not_a_number"}'),
            MagicMock(ok=False, status_code=500),
        ]
        
        call_count = 0
        def mock_fetch_exchange(url, timeout):
            nonlocal call_count
            if call_count < len(invalid_responses):
                response = invalid_responses[call_count]
                call_count += 1
                return response
            return None

        monkeypatch.setattr(self.service, "fetch_exchange_rate", mock_fetch_exchange)
        
        price = self.service.get_btc_price()
        assert price is None

    def test_get_ocean_payment_history_api_all_endpoints_fail(self, monkeypatch):
        """Test payment history API when all endpoints fail."""
        def mock_fetch_ocean_api(url, timeout):
            return None  # All API calls fail

        monkeypatch.setattr(self.service, "_fetch_ocean_api", mock_fetch_ocean_api)
        
        result = self.service.get_ocean_payment_history_api()
        assert result is None

    def test_get_ocean_payment_history_api_malformed_response(self, monkeypatch):
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
        
        result = self.service.get_ocean_payment_history_api()
        # Should handle malformed entries gracefully and return empty list
        assert result is not None
        assert isinstance(result, list)

    def test_get_mempool_fee_estimates_network_error(self, monkeypatch):
        """Test mempool fee estimates with network errors."""
        mock_circuit = MagicMock()
        mock_circuit.call.side_effect = Exception("Network error")
        
        monkeypatch.setattr(ocean_api_client, "_mempool_circuit", mock_circuit)
        
        result = self.service.get_mempool_fee_estimates()
        assert result is None

    def test_get_mempool_fee_estimates_invalid_json(self, monkeypatch):
        """Test mempool fee estimates with invalid JSON response."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.json.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)
        
        mock_circuit = MagicMock()
        mock_circuit.call.return_value = mock_response
        
        monkeypatch.setattr(ocean_api_client, "_mempool_circuit", mock_circuit)
        
        result = self.service.get_mempool_fee_estimates()
        assert result is None

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
        assert not cb.is_open()
        
        # Fail twice to open circuit
        with pytest.raises(Exception):
            cb.call(lambda: (_ for _ in ()).throw(Exception("fail")))
        
        with pytest.raises(Exception):
            cb.call(lambda: (_ for _ in ()).throw(Exception("fail")))
        
        # Should now be open
        assert cb.is_open()
        
        # Calls should fail fast while open
        with pytest.raises(Exception):
            cb.call(lambda: "success")

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
        assert call_count == 4  # Initial + 3 retries

    def test_cached_response_json_parsing_error(self):
        """Test CachedResponse.json() handles parsing errors."""
        from ocean_api_client import CachedResponse
        
        cached_resp = CachedResponse(ok=True, status_code=200, text="invalid json")
        
        with pytest.raises(json.JSONDecodeError):
            cached_resp.json()

    def test_convert_to_ths_edge_cases(self):
        """Test convert_to_ths function with edge case inputs."""
        from models import convert_to_ths
        
        # Test with None
        assert convert_to_ths(None) is None
        
        # Test with zero
        assert convert_to_ths(0) == 0.0
        
        # Test with very small numbers
        assert convert_to_ths(1e-15) == 1e-27
        
        # Test with very large numbers  
        assert convert_to_ths(1e15) == 1.0

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