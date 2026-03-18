"""
Test connection pooling functionality.
"""

import unittest
from unittest.mock import patch, MagicMock
import requests
from requests.adapters import HTTPAdapter

from connection_pool import create_optimized_session, PooledHTTPAdapter, get_pool_stats
from config import get_connection_pool_config


class TestConnectionPooling(unittest.TestCase):
    """Test connection pooling implementation."""

    def test_create_optimized_session(self):
        """Test that optimized session is created with proper adapters."""
        session = create_optimized_session()
        
        # Verify session has adapters mounted
        self.assertIn('https://', session.adapters)
        self.assertIn('http://', session.adapters)
        self.assertIn('https://api.ocean.xyz/', session.adapters)
        self.assertIn('https://mempool.guide/', session.adapters)
        self.assertIn('https://v6.exchangerate-api.com/', session.adapters)
        
        # Verify adapters are PooledHTTPAdapter instances
        for prefix, adapter in session.adapters.items():
            self.assertIsInstance(adapter, PooledHTTPAdapter)
        
        # Verify default headers are set
        self.assertIn('User-Agent', session.headers)
        self.assertEqual(session.headers['User-Agent'], 'DeepSea-Dashboard/1.0')
        
        # Clean up
        session.close()

    def test_pooled_http_adapter(self):
        """Test PooledHTTPAdapter configuration."""
        adapter = PooledHTTPAdapter(
            pool_connections=5,
            pool_maxsize=10,
            pool_block=False
        )
        
        # Verify adapter was created successfully
        self.assertIsInstance(adapter, HTTPAdapter)
        # HTTPAdapter internals may not be directly accessible, but we can verify it exists

    def test_pool_stats_empty_session(self):
        """Test pool stats with empty session."""
        session = requests.Session()
        stats = get_pool_stats(session)
        
        # Should return empty dict for session without custom adapters
        self.assertIsInstance(stats, dict)
        session.close()

    def test_pool_stats_with_adapters(self):
        """Test pool stats with configured session."""
        session = create_optimized_session()
        stats = get_pool_stats(session)
        
        # Should return statistics dict
        self.assertIsInstance(stats, dict)
        
        # Clean up
        session.close()

    @patch('config.load_config')
    def test_connection_pool_config(self, mock_load_config):
        """Test connection pool configuration loading."""
        mock_load_config.return_value = {
            'connection_pool': {
                'ocean_pool_size': 30,
                'ocean_connections': 12
            }
        }
        
        config = get_connection_pool_config()
        
        # Should merge with defaults
        self.assertEqual(config['ocean_pool_size'], 30)
        self.assertEqual(config['ocean_connections'], 12)
        # Should have defaults for other values
        self.assertIn('mempool_pool_size', config)
        self.assertIn('default_connections', config)

    def test_session_headers(self):
        """Test that session has appropriate headers."""
        session = create_optimized_session()
        
        expected_headers = {
            'User-Agent': 'DeepSea-Dashboard/1.0',
            'Accept': 'application/json, text/html, */*',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        
        for header, value in expected_headers.items():
            self.assertEqual(session.headers[header], value)
        
        session.close()

    def test_adapter_mounting_order(self):
        """Test that more specific URL patterns are mounted before general ones."""
        session = create_optimized_session()
        
        # More specific patterns should come first in the ordered dict
        adapters_list = list(session.adapters.keys())
        
        # Ocean-specific should come before general https://
        ocean_index = next(i for i, k in enumerate(adapters_list) if 'ocean' in k)
        https_index = next(i for i, k in enumerate(adapters_list) if k == 'https://')
        
        self.assertLess(ocean_index, https_index)
        
        session.close()


if __name__ == '__main__':
    unittest.main()