"""Tests for scrape parsing edge cases and error handling."""

import pytest
from unittest.mock import MagicMock, patch
from bs4 import BeautifulSoup
from datetime import datetime
from zoneinfo import ZoneInfo

from data_service import MiningDashboardService
from models import OceanData
import ocean_scraper


class TestScrapeParsing:
    """Test edge cases in HTML scraping and parsing."""

    def setup_method(self):
        """Setup test service instance."""
        self.service = MiningDashboardService("test_wallet", 0, 0)

    def test_cleanup_soup_with_none(self):
        """Test cleanup_soup handles None input gracefully."""
        # Should not raise any exceptions
        ocean_scraper.cleanup_soup(None)

    def test_cleanup_soup_with_exception(self):
        """Test cleanup_soup handles decompose exceptions."""
        mock_soup = MagicMock()
        mock_soup.decompose.side_effect = Exception("Mock decompose error")
        
        # Should not raise despite decompose exception
        ocean_scraper.cleanup_soup(mock_soup)
        mock_soup.decompose.assert_called_once()

    def test_parse_malformed_stats_html(self, monkeypatch):
        """Test parsing of malformed stats containers."""
        malformed_html = """
        <div id="lifetimesnap-statcards">
            <div class="blocks dashboard-container">
                <div class="blocks-label">Total hashes submitted</div>
                <!-- Missing span element -->
            </div>
            <div class="blocks dashboard-container">
                <div class="blocks-label">Earnings per day</div>
                <span>invalid_number BTC</span>
            </div>
        </div>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = malformed_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        # Should handle parsing errors gracefully
        result = self.service.get_ocean_data()
        assert result is not None
        assert result.estimated_earnings_per_day is None

    def test_parse_empty_workers_table(self, monkeypatch):
        """Test parsing empty or missing workers table."""
        empty_table_html = """
        <html>
            <body>
                <tbody id="workers-tablerows">
                    <!-- No rows -->
                </tbody>
            </body>
        </html>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = empty_table_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.get_ocean_data()
        assert result is not None

    def test_parse_missing_table_elements(self, monkeypatch):
        """Test parsing when required table elements are missing."""
        no_table_html = """
        <html>
            <body>
                <div>No workers table here</div>
            </body>
        </html>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = no_table_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.get_ocean_data()
        assert result is not None

    def test_parse_invalid_datetime_formats(self, monkeypatch):
        """Test handling of invalid datetime formats in last share parsing."""
        invalid_datetime_html = """
        <tbody id="workers-tablerows">
            <tr class="table-row">
                <td>total</td>
                <td>status</td>
                <td>invalid-date-format</td>
            </tr>
        </tbody>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = invalid_datetime_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        monkeypatch.setattr("ocean_scraper.get_timezone", lambda: "UTC")
        
        result = self.service.get_ocean_data()
        assert result is not None
        # Should preserve the invalid date string when parsing fails
        assert result.total_last_share == "invalid-date-format"

    def test_parse_blocks_found_edge_cases(self, monkeypatch):
        """Test blocks found parsing with various HTML structures."""
        blocks_html = """
        <div>blocks found</div>
        <span>not-a-number blocks</span>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = blocks_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.get_ocean_data()
        assert result is not None
        assert result.blocks_found is None

    def test_payment_history_pagination_edge_cases(self, monkeypatch):
        """Test payment history pagination with various response conditions."""
        call_count = 0
        
        def mock_get(url, headers=None, timeout=10):
            nonlocal call_count
            call_count += 1
            response = MagicMock()
            
            if "ppage=0" in url:
                # First page returns valid data
                response.ok = True
                response.text = """
                <tbody id="payouts-tablerows">
                    <tr class="table-row">
                        <td>2024-01-01 12:00</td>
                        <td><a href="/tx/test123">test123</a></td>
                        <td>0.00001000 BTC</td>
                    </tr>
                </tbody>
                """
            elif "ppage=1" in url:
                # Second page returns 404
                response.ok = False
                response.status_code = 404
            else:
                # Other pages return empty
                response.ok = True
                response.text = "<tbody id='payouts-tablerows'></tbody>"
            
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        monkeypatch.setattr("ocean_scraper.get_timezone", lambda: "UTC")
        
        payments = self.service.get_payment_history_scrape()
        assert payments is not None
        assert len(payments) == 1
        assert call_count == 2  # Should stop after 404 on page 1

    def test_payment_history_malformed_rows(self, monkeypatch):
        """Test payment history with malformed table rows."""
        malformed_html = """
        <tbody id="payouts-tablerows">
            <tr class="table-row">
                <td>2024-01-01 12:00</td>
                <!-- Missing cells -->
            </tr>
            <tr class="table-row">
                <td>2024-01-02 12:00</td>
                <td>txid</td>
                <td>invalid_amount</td>
            </tr>
            <tr class="table-row">
                <td>invalid-date</td>
                <td>txid2</td>
                <td>0.00001000 BTC</td>
            </tr>
        </tbody>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = malformed_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        monkeypatch.setattr("ocean_scraper.get_timezone", lambda: "UTC")
        
        payments = self.service.get_payment_history_scrape()
        assert payments is not None
        # Should only include the last valid row
        assert len(payments) == 1
        assert payments[0]["amount_btc"] == 0.00001000

    def test_payment_history_lightning_txid_parsing(self, monkeypatch):
        """Test parsing of lightning transaction IDs."""
        lightning_html = """
        <tbody id="payouts-tablerows">
            <tr class="table-row">
                <td>2024-01-01 12:00</td>
                <td><a href="/lightning/lnbc123">Lightning Payment</a></td>
                <td>0.00001000 BTC</td>
            </tr>
        </tbody>
        """
        
        def mock_get(url, headers=None, timeout=10):
            response = MagicMock()
            response.ok = True
            response.text = lightning_html
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        monkeypatch.setattr("ocean_scraper.get_timezone", lambda: "UTC")
        
        payments = self.service.get_payment_history_scrape()
        assert payments is not None
        assert len(payments) == 1
        assert payments[0]["lightning_txid"] == "lnbc123"
        assert payments[0]["txid"] == ""

    def test_debug_dump_table_with_none(self):
        """Test debug_dump_table handles None table gracefully."""
        # Should not raise any exceptions
        self.service.debug_dump_table(None)

    def test_debug_dump_table_with_exception(self):
        """Test debug_dump_table handles parsing exceptions."""
        mock_table = MagicMock()
        mock_table.find_all.side_effect = Exception("Mock parsing error")
        
        # Should not raise despite parsing exception
        self.service.debug_dump_table(mock_table)

    @patch('ocean_scraper.logging.debug')
    def test_debug_dump_table_structure(self, mock_log):
        """Test debug_dump_table logs table structure correctly."""
        html = """
        <table>
            <thead><tr><th>Name</th><th>Status</th></tr></thead>
            <tbody>
                <tr class="table-row">
                    <td class="table-cell">worker1</td>
                    <td class="table-cell">online</td>
                </tr>
            </tbody>
        </table>
        """
        soup = BeautifulSoup(html, 'html.parser')
        table = soup.find('tbody')
        
        self.service.debug_dump_table(table, max_rows=1)
        
        # Should have made several debug log calls
        assert mock_log.call_count >= 3

    def test_get_all_worker_rows_pagination_limit(self, monkeypatch):
        """Test worker rows pagination respects max_pages limit."""
        call_count = 0
        
        def mock_get(url, timeout=15):
            nonlocal call_count
            call_count += 1
            response = MagicMock()
            response.ok = True
            response.text = """
            <tbody id="workers-tablerows">
                <tr class="table-row"><td>worker</td></tr>
            </tbody>
            """
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        # Should stop at max_pages=10
        result = self.service.get_all_worker_rows()
        assert call_count == 10  # Reached max_pages limit

    def test_get_all_worker_rows_with_error_response(self, monkeypatch):
        """Test worker rows handles HTTP errors gracefully."""
        def mock_get(url, timeout=15):
            response = MagicMock()
            response.ok = False
            response.status_code = 500
            return response

        monkeypatch.setattr(self.service.session, "get", mock_get)
        
        result = self.service.get_all_worker_rows()
        assert result == []  # Should return empty list on error