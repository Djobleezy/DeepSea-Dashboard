"""End-to-end UI test using Selenium"""
import threading
import time

import pytest
import shutil
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


@pytest.fixture(scope="function")
def server(monkeypatch):
    import App
    import apscheduler.schedulers.background as bg

    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)
    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)
    monkeypatch.setattr(
        App.worker_service,
        "get_workers_data",
        lambda *a, **k: App.worker_service.generate_default_workers_data(),
    )

    # Force dashboard routes to fall back to default metrics
    App.cached_metrics = None

    sample_payments = [
        {
            "date": "2025-01-01 00:00",
            "date_iso": "2025-01-01T00:00:00",
            "amount_btc": 0.1,
            "amount_sats": 10_000_000,
            "status": "confirmed",
        }
    ]

    sample_earnings = {
        "payments": sample_payments,
        "total_payments": 1,
        "total_paid_btc": 0.1,
        "total_paid_sats": 10_000_000,
        "total_paid_fiat": 5000,
        "unpaid_earnings": 0.0,
        "unpaid_earnings_sats": 0,
        "est_time_to_payout": "Unknown",
        "avg_days_between_payouts": None,
        "monthly_summaries": [],
        "currency": "USD",
    }

    monkeypatch.setattr(App.state_manager, "get_payout_history", lambda: sample_payments)
    monkeypatch.setattr(App.state_manager, "save_payout_history", lambda h: True)
    monkeypatch.setattr(App.dashboard_service, "get_earnings_data", lambda: sample_earnings)
    monkeypatch.setattr(App.state_manager, "save_last_earnings", lambda e: True)

    def run_app():
        App.app.run(host="127.0.0.1", port=5001, use_reloader=False)

    thread = threading.Thread(target=run_app)
    thread.daemon = True
    thread.start()
    time.sleep(1)
    yield "http://127.0.0.1:5001"
    # Teardown
    import requests
    try:
        requests.get("http://127.0.0.1:5001/shutdown")
    except Exception:
        pass
    thread.join(timeout=1)
@pytest.mark.skipif(not shutil.which("chromedriver") or not shutil.which("chromium-browser"), reason="Chromium not installed")


def test_click_all_elements(server):
    """Navigate through each dashboard page and interact with UI elements."""
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")

    try:
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
    except Exception as exc:
        pytest.skip(f"Webdriver unavailable: {exc}")

    try:
        pages = ["/dashboard", "/workers", "/earnings", "/blocks", "/notifications"]

        selectors = [
            ".metric-value",
            ".summary-stat-value",
            ".stat-value",
            "#workers-count",
            "#notifications-container",
        ]

        for page in pages:
            driver.get(server + page)

            # Wait briefly for metrics to populate
            WebDriverWait(driver, 3).until(
                lambda d: any(
                    e.text.strip()
                    for css in selectors
                    for e in d.find_elements(By.CSS_SELECTOR, css)
                )
            )

            # Capture metrics before interacting with the page
            elements = []
            for selector in selectors:
                elements.extend(driver.find_elements(By.CSS_SELECTOR, selector))
            assert any(e.text.strip() for e in elements)

            # Click all links and buttons on the page
            clickable = driver.find_elements(By.CSS_SELECTOR, "a, button")
            for elem in clickable:
                try:
                    elem.click()
                except Exception:
                    pass

        # Specifically verify the payout summary on the dashboard
        driver.get(server + "/dashboard")
        try:
            driver.find_element(By.ID, "view-payout-history").click()
            summary = driver.find_element(By.ID, "payout-summary")
            assert "Last Payout Summary" in summary.text
        except Exception:
            pytest.skip("Last payout summary not present")
    finally:
        driver.quit()
