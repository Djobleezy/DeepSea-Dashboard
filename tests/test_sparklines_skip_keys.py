import ast
import re
from pathlib import Path


def test_sparklines_skip_keys():
    js_path = Path('static/js/sparklines.js')
    content = js_path.read_text()
    match = re.search(r"skipKeys = new Set\((\[[^\]]*\])\)", content)
    assert match, 'skipKeys set not found'
    keys = ast.literal_eval(match.group(1))
    for key in ['pool_fees_percentage', 'last_block', 'est_time_to_payout']:
        assert key in keys
