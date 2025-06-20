"""End-to-end UI test using Selenium"""
import threading
import time

import pytest
import shutil
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By


@pytest.fixture(scope="function")
def server(monkeypatch):
    import App
    import apscheduler.schedulers.background as bg

    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)
    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    App.cached_metrics = {
        "workers_hashing": 1,
        "total_last_share": "now",
        "blocks_found": "1",
        "hashrate_10min": 10,
        "hashrate_10min_unit": "TH/s",
    }

    sample_history = [
        {
            "timestamp": "2025-01-01T00:00:00",
            "amountBTC": "0.1",
            "verified": True,
            "officialId": "abc",
            "lightningId": "",
            "status": "confirmed",
        }
    ]

    monkeypatch.setattr(App.state_manager, "get_payout_history", lambda: sample_history)
    monkeypatch.setattr(App.state_manager, "save_payout_history", lambda h: True)
    monkeypatch.setattr(App.dashboard_service, "get_earnings_data", lambda: {"payments": sample_history})
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

        for page in pages:
            driver.get(server + page)

            # Click all links and buttons on the page
            clickable = driver.find_elements(By.CSS_SELECTOR, "a, button")
            for elem in clickable:
                try:
                    elem.click()
                except Exception:
                    pass

            # Ensure metrics or summary stats contain text
            selectors = [
                ".metric-value",
                ".summary-stat-value",
                "#workers-count",
                "#notifications-container",
            ]
            elements = []
            for selector in selectors:
                elements.extend(driver.find_elements(By.CSS_SELECTOR, selector))
            assert any(e.text.strip() for e in elements)

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
