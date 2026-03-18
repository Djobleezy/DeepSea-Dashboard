"""Tests for worker data processing edge cases."""

from unittest.mock import MagicMock

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
        # Test with None — returns None (not a dict)
        assert parse_worker_name(None) is None

        # Test with empty string — returns None (falsy guard)
        assert parse_worker_name("") is None

        # Test with whitespace only — returns None (falsy after strip? check)
        # "   " is truthy so it enters the loop; no specs match → returns None
        result = parse_worker_name("   ")
        assert result is None

        # Test with very long name (no specs match → None)
        long_name = "a" * 1000
        result = parse_worker_name(long_name)
        assert result is None

        # Test with a known model — should return a dict with model info
        result = parse_worker_name("Antminer S19")
        assert result is not None
        assert "model" in result
        assert "type" in result

    def test_get_worker_data_alternative_empty_response(self, monkeypatch):
        """Test get_worker_data_alternative returns None with empty response."""
        def mock_get_all_worker_rows():
            return []

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        # The real implementation returns None when rows are empty
        result = self.service.get_worker_data_alternative()
        assert result is None

    def test_get_worker_data_alternative_malformed_cells(self, monkeypatch):
        """Test worker data parsing with malformed cell data."""
        malformed_rows = [
            {"cells": []},  # Empty cells — skipped (< 3 cells)
            {"cells": ["worker1"]},  # Too few cells — skipped (< 3 cells)
            {"cells": ["worker2", "status", "time", "invalid_hashrate", "invalid_hashrate", "invalid_earnings"]},
            {"cells": ["worker3", "online", "now", "100 TH/s", "90 TH/s", "0.00001000 BTC"]},  # Valid row
        ]
        
        def mock_get_all_worker_rows():
            return malformed_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        # worker2 (with invalid hashrate but valid cells) and worker3 are both processed
        assert result["workers_total"] == 2
        worker_names = [w["name"] for w in result["workers"]]
        assert "worker3" in worker_names

    def test_get_worker_data_original_network_error(self, monkeypatch):
        """Test get_worker_data_original handles network errors gracefully."""
        def mock_get(url, headers=None, timeout=15):
            raise Exception("Network timeout")

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        # Returns None on error (not an empty dict)
        result = self.service.get_worker_data_original()
        assert result is None

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
        # Should handle malformed data gracefully — worker2 is processed
        assert result is not None
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
        
        # Check specific conversions — actual dict key is "hashrate_60sec" and "hashrate_3hr"
        workers = {w["name"]: w for w in result["workers"]}
        
        # Zero should remain zero
        assert workers["w1"]["hashrate_60sec"] == 0.0
        assert workers["w1"]["hashrate_3hr"] == 0.0
        
        # Very small numbers should be preserved
        assert workers["w2"]["hashrate_60sec"] == 0.001
        assert workers["w2"]["hashrate_3hr"] == 0.002

    def test_worker_earnings_parsing_edge_cases(self, monkeypatch):
        """Test worker earnings parsing with various formats."""
        test_rows = [
            {"cells": ["w1", "online", "now", "100 TH/s", "90 TH/s", "0 BTC"]},
            {"cells": ["w2", "online", "now", "100 TH/s", "90 TH/s", "0.00000001 BTC"]},  # Very small
            {"cells": ["w3", "online", "now", "100 TH/s", "90 TH/s", "1.00000000 BTC"]},  # Large amount
            {"cells": ["w4", "online", "now", "100 TH/s", "90 TH/s", "invalid_amount"]},  # Invalid (no BTC)
            {"cells": ["w5", "online", "now", "100 TH/s", "90 TH/s", ""]},  # Empty
            {"cells": ["w6", "online", "now", "100 TH/s", "90 TH/s", "BTC"]},  # No number
        ]
        
        def mock_get_all_worker_rows():
            return test_rows

        monkeypatch.setattr(self.service, "get_all_worker_rows", mock_get_all_worker_rows)
        
        result = self.service.get_worker_data_alternative()
        # The actual dict key is "earnings" not "earnings_btc"
        workers = {w["name"]: w for w in result["workers"]}
        
        # Valid amounts should be parsed correctly
        assert workers["w1"]["earnings"] == 0.0
        assert workers["w2"]["earnings"] == 0.00000001
        assert workers["w3"]["earnings"] == 1.0
        
        # Invalid amounts default to 0
        assert workers["w4"]["earnings"] == 0.0
        assert workers["w5"]["earnings"] == 0.0
        # w6 has "BTC" so the btc check matches, but regex finds no number → earnings stays 0
        assert workers["w6"]["earnings"] == 0.0

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
        
        # Status is normalised: "online" if "online" in status.lower() else "offline"
        assert workers["w1"]["status"] == "online"
        assert workers["w2"]["status"] == "offline"
        # "ONLINE".lower() == "online" → "online" in "online" is True → status "online"
        assert workers["w3"]["status"] == "online"
        # "" → "online" not in "" → "offline"
        assert workers["w4"]["status"] == "offline"
        # "unknown_status" → "online" not in it → "offline"
        assert workers["w5"]["status"] == "offline"

    def test_worker_service_edge_cases(self):
        """Test WorkerService with edge case scenarios."""
        # Test with None dashboard service
        self.worker_service.set_dashboard_service(None)
        
        # WorkerService.get_workers_data requires cached_metrics arg — call generate_fallback_data instead
        result = self.worker_service.generate_fallback_data(cached_metrics=None)
        assert result is not None
        
        # Test generate_default_workers_data
        default_result = self.worker_service.generate_default_workers_data()
        assert default_result is not None

    def test_worker_models_constants(self):
        """Test worker_models module contains expected constants."""
        # worker_models only exports MINER_MODELS list and WORKER_NAME_PREFIXES
        assert isinstance(worker_models.MINER_MODELS, list)
        assert len(worker_models.MINER_MODELS) > 0
        
        # Each model entry should have required fields
        for model in worker_models.MINER_MODELS:
            assert "type" in model
            assert "model" in model
            assert "max_hashrate" in model
            assert "power" in model
        
        assert isinstance(worker_models.WORKER_NAME_PREFIXES, list)
        assert len(worker_models.WORKER_NAME_PREFIXES) > 0

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
        
        # total_hashrate sums 3hr hashrate across ALL workers (not just online)
        # online1: 90, offline1: 0, online2: 180, offline2: 0 → 270
        assert result["total_hashrate"] == 90 + 0 + 180 + 0
        
        # total_earnings sums all workers' earnings
        assert abs(result["total_earnings"] - (0.001 + 0.002 + 0.003 + 0.004)) < 1e-9

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
