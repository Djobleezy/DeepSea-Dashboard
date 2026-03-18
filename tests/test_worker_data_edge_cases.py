"""Tests for worker data processing edge cases."""

import pytest
from unittest.mock import MagicMock, patch
from bs4 import BeautifulSoup

from data_service import MiningDashboardService
from worker_service import WorkerService
from miner_specs import parse_worker_name
import worker_models


class TestWorkerDataEdgeCases:
    """Test edge cases in worker data processing and parsing."""

    def setup_method(self):
        """Setup test service instances."""
        self.service = MiningDashboardService("test_wallet", 0, 0)
        self.worker_service = WorkerService()

    def test_parse_worker_name_edge_cases(self):
        """Test parse_worker_name with various edge case inputs."""
        # Test with None
        assert parse_worker_name(None) == {"base_name": None, "miner_type": "Unknown"}
        
        # Test with empty string
        assert parse_worker_name("") == {"base_name": "", "miner_type": "Unknown"}
        
        # Test with whitespace only
        assert parse_worker_name("   ") == {"base_name": "   ", "miner_type": "Unknown"}
        
        # Test with very long name
        long_name = "a" * 1000
        result = parse_worker_name(long_name)
        assert result["base_name"] == long_name
        assert result["miner_type"] == "Unknown"
        
        # Test with special characters
        special_name = "worker-1@#$%^&*()"
        result = parse_worker_name(special_name)
        assert result["base_name"] == special_name

    def test_get_worker_data_alternative_empty_response(self, monkeypatch):
        """Test get_worker_data_alternative with empty/no response."""
        def mock_get_all_worker_rows():
            return []

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        assert result["workers_total"] == 0
        assert result["workers"] == []
        assert result["hashrate_current"] == 0.0

    def test_get_worker_data_alternative_malformed_cells(self, monkeypatch):
        """Test worker data parsing with malformed cell data."""
        malformed_rows = [
            {"cells": []},  # Empty cells
            {"cells": ["worker1"]},  # Too few cells
            {"cells": ["worker2", "status", "time", "invalid_hashrate", "invalid_hashrate", "invalid_earnings"]},
            {"cells": ["worker3", "online", "now", "100 TH/s", "90 TH/s", "0.00001000 BTC"]},  # Valid row
        ]
        
        def mock_get_all_worker_rows():
            return malformed_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        # Should only process the valid row
        assert result["workers_total"] == 1
        assert result["workers"][0]["name"] == "worker3"

    def test_get_worker_data_original_network_error(self, monkeypatch):
        """Test get_worker_data_original handles network errors gracefully."""
        def mock_get(url, headers=None, timeout=15):
            raise Exception("Network timeout")

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.get_worker_data_original()
        assert result["workers_total"] == 0
        assert result["workers"] == []

    def test_get_worker_data_original_malformed_html(self, monkeypatch):
        """Test original worker data method with malformed HTML."""
        malformed_html = """
        <tbody id="workers-tablerows">
            <tr class="table-row">
                <td class="table-cell">worker1</td>
                <!-- Missing cells -->
            </tr>
            <tr class="table-row">
                <td class="table-cell">worker2</td>
                <td class="table-cell">offline</td>
                <td class="table-cell">1 hour ago</td>
                <td class="table-cell">not_a_number</td>
                <td class="table-cell">also_not_a_number</td>
                <td class="table-cell">invalid BTC</td>
            </tr>
        </tbody>
        """
        
        def mock_get(url, headers=None, timeout=15):
            response = MagicMock()
            response.ok = True
            response.text = malformed_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        monkeypatch.setattr("ocean_scraper.get_timezone", lambda: "UTC")
        
        result = self.service.get_worker_data_original()
        # Should handle malformed data gracefully
        assert result["workers_total"] >= 0

    def test_worker_hashrate_conversion_edge_cases(self, monkeypatch):
        """Test hashrate conversion with various formats and edge cases."""
        test_rows = [
            {"cells": ["w1", "online", "now", "0 TH/s", "0 TH/s", "0 BTC"]},  # Zero hashrate
            {"cells": ["w2", "online", "now", "0.001 TH/s", "0.002 TH/s", "0 BTC"]},  # Very small
            {"cells": ["w3", "online", "now", "9999 TH/s", "8888 TH/s", "0 BTC"]},  # Very large
            {"cells": ["w4", "online", "now", "100", "90", "0 BTC"]},  # No units
            {"cells": ["w5", "online", "now", "100 GH/s", "90 GH/s", "0 BTC"]},  # Different units
            {"cells": ["w6", "online", "now", "100 PH/s", "90 PH/s", "0 BTC"]},  # PH/s units
            {"cells": ["w7", "online", "now", "-100 TH/s", "-90 TH/s", "0 BTC"]},  # Negative
        ]
        
        def mock_get_all_worker_rows():
            return test_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        assert len(result["workers"]) == len(test_rows)
        
        # Check specific conversions
        workers = {w["name"]: w for w in result["workers"]}
        
        # Zero should remain zero
        assert workers["w1"]["hashrate_current"] == 0.0
        assert workers["w1"]["hashrate_3hr"] == 0.0
        
        # Very small numbers should be preserved
        assert workers["w2"]["hashrate_current"] == 0.001
        assert workers["w2"]["hashrate_3hr"] == 0.002

    def test_worker_earnings_parsing_edge_cases(self, monkeypatch):
        """Test worker earnings parsing with various formats."""
        test_rows = [
            {"cells": ["w1", "online", "now", "100 TH/s", "90 TH/s", "0 BTC"]},
            {"cells": ["w2", "online", "now", "100 TH/s", "90 TH/s", "0.00000001 BTC"]},  # Very small
            {"cells": ["w3", "online", "now", "100 TH/s", "90 TH/s", "1.00000000 BTC"]},  # Large amount
            {"cells": ["w4", "online", "now", "100 TH/s", "90 TH/s", "invalid_amount"]},  # Invalid
            {"cells": ["w5", "online", "now", "100 TH/s", "90 TH/s", ""]},  # Empty
            {"cells": ["w6", "online", "now", "100 TH/s", "90 TH/s", "BTC"]},  # No number
        ]
        
        def mock_get_all_worker_rows():
            return test_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        workers = {w["name"]: w for w in result["workers"]}
        
        # Valid amounts should be parsed correctly
        assert workers["w1"]["earnings_btc"] == 0.0
        assert workers["w2"]["earnings_btc"] == 0.00000001
        assert workers["w3"]["earnings_btc"] == 1.0
        
        # Invalid amounts should default to 0
        assert workers["w4"]["earnings_btc"] == 0.0
        assert workers["w5"]["earnings_btc"] == 0.0
        assert workers["w6"]["earnings_btc"] == 0.0

    def test_worker_status_edge_cases(self, monkeypatch):
        """Test worker status parsing with various statuses."""
        test_rows = [
            {"cells": ["w1", "online", "now", "100 TH/s", "90 TH/s", "0 BTC"]},
            {"cells": ["w2", "offline", "1 hour ago", "0 TH/s", "0 TH/s", "0 BTC"]},
            {"cells": ["w3", "ONLINE", "now", "100 TH/s", "90 TH/s", "0 BTC"]},  # Uppercase
            {"cells": ["w4", "", "now", "100 TH/s", "90 TH/s", "0 BTC"]},  # Empty status
            {"cells": ["w5", "unknown_status", "now", "100 TH/s", "90 TH/s", "0 BTC"]},
        ]
        
        def mock_get_all_worker_rows():
            return test_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        workers = {w["name"]: w for w in result["workers"]}
        
        # Status should be preserved as-is
        assert workers["w1"]["status"] == "online"
        assert workers["w2"]["status"] == "offline"  
        assert workers["w3"]["status"] == "ONLINE"
        assert workers["w4"]["status"] == ""
        assert workers["w5"]["status"] == "unknown_status"

    def test_worker_service_edge_cases(self):
        """Test WorkerService with edge case scenarios."""
        # Test with None dashboard service
        self.worker_service.set_dashboard_service(None)
        
        # Should handle gracefully without crashing
        result = self.worker_service.get_workers()
        assert result is not None
        
        # Test with service that returns None
        mock_service = MagicMock()
        mock_service.get_worker_data_alternative.return_value = None
        
        self.worker_service.set_dashboard_service(mock_service)
        result = self.worker_service.get_workers()
        assert result is not None

    def test_worker_models_edge_cases(self):
        """Test worker model creation with edge case data."""
        # Test with minimal data
        minimal_worker = {
            "name": "test",
            "status": "online",
        }
        
        # Should handle missing fields gracefully
        worker = worker_models.Worker.from_dict(minimal_worker)
        assert worker.name == "test"
        assert worker.status == "online"
        
        # Test with extra fields
        extra_worker = {
            "name": "test2", 
            "status": "offline",
            "extra_field": "should_be_ignored",
            "another_extra": 123,
        }
        
        worker2 = worker_models.Worker.from_dict(extra_worker)
        assert worker2.name == "test2"
        assert worker2.status == "offline"

    def test_worker_aggregation_edge_cases(self, monkeypatch):
        """Test worker data aggregation with edge cases."""
        # Test with mixed online/offline workers
        mixed_rows = [
            {"cells": ["online1", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]},
            {"cells": ["offline1", "offline", "1h ago", "0 TH/s", "0 TH/s", "0.002 BTC"]},
            {"cells": ["online2", "online", "now", "200 TH/s", "180 TH/s", "0.003 BTC"]},
            {"cells": ["offline2", "offline", "2h ago", "0 TH/s", "0 TH/s", "0.004 BTC"]},
        ]
        
        def mock_get_all_worker_rows():
            return mixed_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        
        # Check totals
        assert result["workers_total"] == 4
        
        # Hashrate should only include online workers
        expected_current = 100 + 200  # Only online workers
        expected_3hr = 90 + 180
        assert result["hashrate_current"] == expected_current
        assert result["hashrate_3hr"] == expected_3hr
        
        # Earnings should include all workers
        expected_earnings = (0.001 + 0.002 + 0.003 + 0.004) * self.service.sats_per_btc
        assert result["total_sats"] == int(expected_earnings)

    def test_worker_data_with_unicode_names(self, monkeypatch):
        """Test worker data parsing with unicode/special character names."""
        unicode_rows = [
            {"cells": ["мiner-1", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]},  # Cyrillic
            {"cells": ["矿工-2", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]},  # Chinese
            {"cells": ["worker🚀", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]},  # Emoji
            {"cells": ["café-worker", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]},  # Accented
        ]
        
        def mock_get_all_worker_rows():
            return unicode_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        
        # Should handle unicode names correctly
        assert result["workers_total"] == 4
        worker_names = [w["name"] for w in result["workers"]]
        assert "мiner-1" in worker_names
        assert "矿工-2" in worker_names
        assert "worker🚀" in worker_names
        assert "café-worker" in worker_names

    def test_worker_data_performance_with_large_dataset(self, monkeypatch):
        """Test worker data processing performance with large number of workers."""
        # Generate large dataset
        large_rows = []
        for i in range(1000):
            large_rows.append({
                "cells": [f"worker{i}", "online", "now", "100 TH/s", "90 TH/s", "0.001 BTC"]
            })
        
        def mock_get_all_worker_rows():
            return large_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        import time
        start_time = time.time()
        result = self.service.get_worker_data_alternative()
        processing_time = time.time() - start_time
        
        # Should process 1000 workers reasonably quickly (< 1 second)
        assert processing_time < 1.0
        assert result["workers_total"] == 1000
        assert len(result["workers"]) == 1000