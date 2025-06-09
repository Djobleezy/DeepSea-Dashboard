import ast
import re
from pathlib import Path


def test_sparklines_skip_keys():
    js_path = Path('static/js/sparklines.js')
    content = js_path.read_text()
    match = re.search(r"skipKeys = new Set\((\[[^\]]*\])\)", content)
    assert match, 'skipKeys set not found'
    keys = ast.literal_eval(match.group(1))
    required = [
        'pool_fees_percentage',
        'last_block',
        'est_time_to_payout',
        'daily_mined_sats',
        'monthly_mined_sats',
        'estimated_earnings_per_day_sats',
        'estimated_earnings_next_block_sats',
        'estimated_rewards_in_window_sats',
        'daily_power_cost',
        'daily_profit_usd',
        'monthly_profit_usd',
        'difficulty',
        'block_number',
        'hashrate_3hr',
        'hashrate_10min',
        'hashrate_60sec',
    ]
    for key in required:
        assert key in keys
