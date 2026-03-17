"""
Tests for DS-01: API coverage audit.

Verifies that:
1. API_FIELD_COVERAGE is importable and well-formed.
2. The "api-primary" skip guards in get_ocean_data() prevent redundant DOM
   queries when the API has already filled a field.
"""

from unittest.mock import MagicMock, patch

from data_service import API_FIELD_COVERAGE, MiningDashboardService


# ---------------------------------------------------------------------------
# API_FIELD_COVERAGE structure tests
# ---------------------------------------------------------------------------

class TestApiFieldCoverage:
    """Validate the coverage map constant."""

    REQUIRED_KEYS = {"api_endpoint", "scrape_source", "status"}
    VALID_STATUSES = {"api-primary", "scrape-only", "both"}

    def test_coverage_is_dict(self):
        assert isinstance(API_FIELD_COVERAGE, dict)
        assert len(API_FIELD_COVERAGE) > 0, "API_FIELD_COVERAGE should have entries"

    def test_all_entries_have_required_keys(self):
        for field, info in API_FIELD_COVERAGE.items():
            missing = self.REQUIRED_KEYS - info.keys()
            assert not missing, f"Field '{field}' is missing keys: {missing}"

    def test_all_statuses_are_valid(self):
        for field, info in API_FIELD_COVERAGE.items():
            assert info["status"] in self.VALID_STATUSES, (
                f"Field '{field}' has invalid status '{info['status']}'"
            )

    def test_scrape_only_fields_have_no_api_endpoint(self):
        for field, info in API_FIELD_COVERAGE.items():
            if info["status"] == "scrape-only":
                assert info["api_endpoint"] is None, (
                    f"Scrape-only field '{field}' should have api_endpoint=None"
                )

    def test_api_primary_fields_have_endpoint(self):
        for field, info in API_FIELD_COVERAGE.items():
            if info["status"] == "api-primary":
                assert info["api_endpoint"] is not None, (
                    f"API-primary field '{field}' must have an api_endpoint"
                )

    def test_known_scrape_only_fields_present(self):
        scrape_only = {f for f, i in API_FIELD_COVERAGE.items() if i["status"] == "scrape-only"}
        expected = {"pool_fees_percentage", "last_block_earnings", "estimated_earnings_per_day", "est_time_to_payout"}
        assert expected.issubset(scrape_only), (
            f"Missing scrape-only fields: {expected - scrape_only}"
        )

    def test_known_api_primary_fields_present(self):
        api_primary = {f for f, i in API_FIELD_COVERAGE.items() if i["status"] == "api-primary"}
        expected = {
            "hashrate_60sec", "hashrate_5min", "hashrate_10min", "hashrate_3hr", "hashrate_24hr",
            "pool_total_hashrate", "workers_hashing", "blocks_found",
            "last_block_height", "last_block_time",
            "unpaid_earnings", "estimated_earnings_next_block", "estimated_rewards_in_window",
            "total_last_share",
        }
        assert expected.issubset(api_primary), (
            f"Missing api-primary fields: {expected - api_primary}"
        )


# ---------------------------------------------------------------------------
# Skip-guard tests: API-filled fields should suppress DOM queries
# ---------------------------------------------------------------------------

def _make_service():
    """Return a MiningDashboardService with dummy config."""
    svc = MiningDashboardService.__new__(MiningDashboardService)
    svc.power_cost = 0.07
    svc.power_usage = 3000
    svc.wallet = "bc1testwalletaddress"
    svc.network_fee = 0.0
    svc.worker_service = None
    svc.cache = {}
    svc.sats_per_btc = 100_000_000
    svc.previous_values = {}
    svc.cached_metrics = None
    svc._closed = False
    import requests
    svc.session = requests.Session()
    from concurrent.futures import ThreadPoolExecutor
    svc.executor = ThreadPoolExecutor(max_workers=2)
    from datetime import datetime
    from zoneinfo import ZoneInfo
    svc.server_start_time = datetime.now(ZoneInfo("UTC"))
    svc.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
    svc.exchange_rate_ttl = 7200
    return svc


class TestApiFirstSkipGuards:
    """
    Verify that get_ocean_data() skips DOM queries for fields already
    populated by the API.  We mock get_ocean_api_data() to return a fully
    populated result, then check that BeautifulSoup.find() is never called
    for the guarded element IDs.
    """

    FULLY_POPULATED_API = {
        "hashrate_60sec": 100.0,
        "hashrate_60sec_unit": "TH/s",
        "hashrate_5min": 98.0,
        "hashrate_5min_unit": "TH/s",
        "hashrate_10min": 97.0,
        "hashrate_10min_unit": "TH/s",
        "hashrate_3hr": 95.0,
        "hashrate_3hr_unit": "TH/s",
        "hashrate_24hr": 90.0,
        "hashrate_24hr_unit": "TH/s",
        "pool_total_hashrate": 1000.0,
        "pool_total_hashrate_unit": "PH/s",
        "workers_hashing": 5,
        "blocks_found": "123",
        "last_block_height": "876543",
        "last_block_time": "2026-03-16 10:00 AM",
        "unpaid_earnings": 0.001,
        "estimated_earnings_next_block": 0.0005,
        "estimated_rewards_in_window": 0.0003,
        "total_last_share": "2026-03-16 09:55 AM",
    }

    def _run_get_ocean_data_with_api(self, svc, find_spy):
        """
        Patch get_ocean_api_data to return FULLY_POPULATED_API, patch
        session.get to return a minimal HTML page, and run get_ocean_data().
        """
        minimal_html = "<html><body></body></html>"

        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.text = minimal_html
        mock_resp.close = MagicMock()

        with patch.object(svc.session, "get", return_value=mock_resp):
            with patch.object(svc, "get_ocean_api_data", return_value=self.FULLY_POPULATED_API):
                with patch("data_service.BeautifulSoup") as mock_bs_class:
                    mock_soup = MagicMock()
                    mock_soup.find = find_spy
                    mock_bs_class.return_value = mock_soup
                    result = svc.get_ocean_data()
        return result

    def test_pool_status_item_not_queried_when_api_filled(self):
        svc = _make_service()
        queried_ids = []

        def tracking_find(*args, **kwargs):
            if args and isinstance(args[-1], str):
                queried_ids.append(args[-1])
            elif "id" in kwargs:
                queried_ids.append(kwargs["id"])
            m = MagicMock()
            m.find.return_value = None
            m.find_all.return_value = []
            m.get_text.return_value = ""
            return m

        self._run_get_ocean_data_with_api(svc, tracking_find)
        assert "pool-status-item" not in queried_ids, (
            "pool-status-item should not be queried when API filled pool_total_hashrate and last_block_height"
        )

    def test_hashrates_tablerows_not_queried_when_api_filled(self):
        svc = _make_service()
        queried_ids = []

        def tracking_find(*args, **kwargs):
            if "id" in kwargs:
                queried_ids.append(kwargs["id"])
            m = MagicMock()
            m.find.return_value = None
            m.find_all.return_value = []
            m.get_text.return_value = ""
            return m

        self._run_get_ocean_data_with_api(svc, tracking_find)
        assert "hashrates-tablerows" not in queried_ids, (
            "hashrates-tablerows should not be queried when all hashrate intervals already filled by API"
        )

    def test_earnings_tablerows_always_queried_for_scrape_only_fields(self):
        """
        pool_fees_percentage and last_block_earnings are scrape-only;
        earnings-tablerows must always be queried.
        """
        svc = _make_service()
        queried_ids = []

        def tracking_find(*args, **kwargs):
            if "id" in kwargs:
                queried_ids.append(kwargs["id"])
            m = MagicMock()
            m.find.return_value = None
            m.find_all.return_value = []
            m.get_text.return_value = ""
            return m

        self._run_get_ocean_data_with_api(svc, tracking_find)
        assert "earnings-tablerows" in queried_ids, (
            "earnings-tablerows must always be scraped (scrape-only: pool_fees_percentage, last_block_earnings)"
        )

    def test_lifetimesnap_always_queried_for_estimated_earnings_per_day(self):
        """estimated_earnings_per_day is scrape-only; lifetimesnap-statcards must always be queried."""
        svc = _make_service()
        queried_ids = []

        def tracking_find(*args, **kwargs):
            if "id" in kwargs:
                queried_ids.append(kwargs["id"])
            m = MagicMock()
            m.find.return_value = None
            m.find_all.return_value = []
            m.get_text.return_value = ""
            return m

        self._run_get_ocean_data_with_api(svc, tracking_find)
        assert "lifetimesnap-statcards" in queried_ids, (
            "lifetimesnap-statcards must always be scraped (scrape-only: estimated_earnings_per_day)"
        )

    def test_api_values_not_overwritten_by_scrape(self):
        """
        When API fills all hashrate intervals, hashrates-tablerows is skipped
        entirely — the scrape never even runs for those fields.
        """
        svc = _make_service()
        queried_ids = []

        def tracking_find(*args, **kwargs):
            if "id" in kwargs:
                queried_ids.append(kwargs["id"])
            m = MagicMock()
            m.find.return_value = None
            m.find_all.return_value = []
            m.get_text.return_value = ""
            return m

        self._run_get_ocean_data_with_api(svc, tracking_find)
        # With all hashrates filled by API, the table is never even queried
        assert "hashrates-tablerows" not in queried_ids, (
            "hashrates-tablerows should be skipped when API fills all hashrate intervals"
        )
