"""
Connection pooling configuration for HTTP requests.

This module provides optimized HTTPAdapter configurations for different
external services to improve connection reuse and reduce latency.
"""

import requests
from urllib3.util import Retry
from requests.adapters import HTTPAdapter


class PooledHTTPAdapter(HTTPAdapter):
    """Custom HTTPAdapter with optimized connection pooling."""
    
    def __init__(self, pool_connections=20, pool_maxsize=20, max_retries=None, 
                 pool_block=False, **kwargs):
        """
        Initialize the pooled HTTP adapter.
        
        Args:
            pool_connections (int): Number of connection pools to cache
            pool_maxsize (int): Maximum number of connections to save in the pool
            max_retries (int or Retry): Number of retry attempts
            pool_block (bool): Whether to block when no connections are available
        """
        if max_retries is None:
            max_retries = Retry(
                total=3,
                read=2,
                connect=2,
                backoff_factor=0.3,
                status_forcelist=(429, 500, 502, 503, 504),
                raise_on_status=False
            )
        
        super().__init__(
            pool_connections=pool_connections,
            pool_maxsize=pool_maxsize,
            max_retries=max_retries,
            pool_block=pool_block,
            **kwargs
        )


def create_optimized_session():
    """
    Create a requests session with optimized connection pooling.
    
    Returns:
        requests.Session: Configured session with connection pooling
    """
    from config import get_connection_pool_config
    
    # Get configuration values
    pool_config = get_connection_pool_config()
    
    session = requests.Session()
    
    # Configure different adapters for different services
    
    # Ocean.xyz API - high traffic, needs larger pool
    # No retries here since ocean_api_client.py already handles retries via retry_request()
    ocean_adapter = PooledHTTPAdapter(
        pool_connections=pool_config["ocean_connections"],
        pool_maxsize=pool_config["ocean_pool_size"],
        max_retries=Retry(
            total=0,
            read=0,
            connect=0,
            raise_on_status=False
        )
    )
    session.mount('https://api.ocean.xyz/', ocean_adapter)
    session.mount('https://ocean.xyz/', ocean_adapter)
    
    # Mempool services - medium traffic
    # Minimal retries to stay within 5s collector deadline (fetch_network_data timeout)
    mempool_adapter = PooledHTTPAdapter(
        pool_connections=pool_config["mempool_connections"],
        pool_maxsize=pool_config["mempool_pool_size"],
        max_retries=Retry(
            total=1,
            read=0,
            connect=1,
            backoff_factor=0.1,
            status_forcelist=(429, 500, 502, 503, 504),
            raise_on_status=False
        )
    )
    session.mount('https://mempool.guide/', mempool_adapter)
    session.mount('https://mempool.space/', mempool_adapter)
    
    # Exchange rate APIs - low traffic but important for caching
    exchange_adapter = PooledHTTPAdapter(
        pool_connections=pool_config["exchange_connections"],
        pool_maxsize=pool_config["exchange_pool_size"],
        max_retries=Retry(
            total=2,
            read=1,
            connect=1,
            backoff_factor=0.2,
            status_forcelist=(429, 500, 502, 503, 504),
            raise_on_status=False
        )
    )
    session.mount('https://v6.exchangerate-api.com/', exchange_adapter)
    
    # Blockchain.info - fallback service
    blockchain_adapter = PooledHTTPAdapter(
        pool_connections=3,
        pool_maxsize=6,
        max_retries=Retry(
            total=1,
            read=1,
            connect=1,
            backoff_factor=0.3,
            status_forcelist=(500, 502, 503, 504),
            raise_on_status=False
        )
    )
    session.mount('https://blockchain.info/', blockchain_adapter)
    
    # Default adapter for any other URLs
    default_adapter = PooledHTTPAdapter(
        pool_connections=pool_config["default_connections"],
        pool_maxsize=pool_config["default_pool_size"],
        max_retries=Retry(
            total=2,
            read=1,
            connect=1,
            backoff_factor=0.3,
            status_forcelist=(429, 500, 502, 503, 504),
            raise_on_status=False
        )
    )
    session.mount('https://', default_adapter)
    session.mount('http://', default_adapter)
    
    # Configure session-level settings
    session.headers.update({
        'User-Agent': 'DeepSea-Dashboard/1.0',
        'Accept': 'application/json, text/html, */*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    })
    
    # Note: session.timeout is not effective - timeouts must be passed per-request
    
    return session


def get_pool_stats(session):
    """
    Get statistics about the connection pools in use.
    
    Args:
        session (requests.Session): Session to inspect
        
    Returns:
        dict: Connection pool statistics
    """
    stats = {}
    
    if hasattr(session, 'adapters'):
        for prefix, adapter in session.adapters.items():
            pool_info = {
                'prefix': prefix,
                'adapter_type': type(adapter).__name__,
                'pools': {}
            }
            
            if hasattr(adapter, 'poolmanager'):
                pool_manager = adapter.poolmanager
                if hasattr(pool_manager, 'pools'):
                    try:
                        # Get pool count safely
                        pool_count = len(pool_manager.pools) if hasattr(pool_manager.pools, '__len__') else 0
                        pool_info['num_pools'] = pool_count
                        
                        # Try to get pool details if possible (urllib3 containers may not allow iteration)
                        if hasattr(pool_manager, 'pool_connections_to_host'):
                            pool_info['pool_connections_to_host'] = pool_manager.pool_connections_to_host
                        if hasattr(pool_manager, 'num_pools'):
                            pool_info['num_pools'] = pool_manager.num_pools
                        
                        # Try to safely get some pool information without iterating
                        pool_info['has_pools'] = pool_count > 0
                        
                    except Exception as e:
                        pool_info['error'] = f"Could not access pools: {e}"
                        pool_info['num_pools'] = 0
            else:
                pool_info['num_pools'] = 0
                pool_info['has_poolmanager'] = False
            
            stats[prefix] = pool_info
    
    return stats