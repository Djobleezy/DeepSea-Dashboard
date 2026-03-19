import re
from pathlib import Path


def test_sparklines_allowlist():
    """Verify sparklines only render for explicitly configured metrics."""
    js_path = Path('static/js/sparklines.js')
    content = js_path.read_text()

    # SPARKLINE_CONFIG is an object with nested objects — extract top-level keys
    assert 'SPARKLINE_CONFIG' in content, 'SPARKLINE_CONFIG not found in sparklines.js'

    # Extract keys: lines like "    pool_total_hashrate: {"
    keys = re.findall(r"^\s+(\w+)\s*:\s*\{", content, re.MULTILINE)
    assert len(keys) > 0, 'No metric keys found in SPARKLINE_CONFIG'

    # These metrics should have sparklines
    expected = [
        'pool_total_hashrate',
        'hashrate_24hr',
        'btc_price',
        'network_hashrate',
        'daily_mined_sats',
        'blocks_found',
    ]
    for key in expected:
        assert key in keys, f'{key} missing from SPARKLINE_CONFIG'

    # These metrics should NOT have sparklines
    forbidden = [
        'workers_hashing',
        'pool_fees_percentage',
        'est_time_to_payout',
        'difficulty',
        'block_number',
        'hashrate_60sec',
        'hashrate_10min',
        'hashrate_3hr',
    ]
    for key in forbidden:
        assert key not in keys, f'{key} should not be in SPARKLINE_CONFIG'
