"""
Ocean scraper module — handles all BeautifulSoup HTML parsing for Ocean.xyz.
"""

import gc
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from models import OceanData, convert_to_ths
from config import get_timezone
from cache_utils import ttl_cache
from miner_specs import parse_worker_name
from state_manager import MAX_PAYOUT_HISTORY_ENTRIES


def cleanup_soup(soup):
    """Decompose a BeautifulSoup object and force garbage collection."""
    if soup is not None:
        try:
            soup.decompose()
        except Exception:
            pass
    gc.collect()


class OceanScraperMixin:
    """Mixin providing all BeautifulSoup scraping methods for Ocean.xyz."""

    @ttl_cache(ttl_seconds=30, maxsize=1)
    def get_ocean_data(self):
        """
        Get mining data from Ocean.xyz.

        Results are cached for 30 s so that ``fetch_metrics()`` and
        ``get_earnings_data()`` share the same data when called in quick
        succession, avoiding duplicate API + scrape round-trips.

        Returns:
            OceanData: Ocean.xyz mining data
        """
        base_url = "https://ocean.xyz"
        stats_url = f"{base_url}/stats/{self.wallet}"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
        }

        # Create an empty data object to populate
        data = OceanData()

        # First attempt to populate using the official API
        api_data = self.get_ocean_api_data()
        for key, value in api_data.items():
            if hasattr(data, key) and value is not None:
                setattr(data, key, value)

        soup = None
        response = None
        try:
            response = self.session.get(stats_url, headers=headers, timeout=10)
            if not response.ok:
                logging.error(f"Error fetching ocean data: status code {response.status_code}")
                return None

            soup = BeautifulSoup(response.text, "html.parser")

            # Safely extract pool status information.
            # Pool hashrate and last-block data are "api-primary" fields; only
            # scrape them when the API did not supply a value.
            _need_pool_hashrate = data.pool_total_hashrate is None
            _need_last_block = data.last_block_height is None
            try:
                if _need_pool_hashrate or _need_last_block:
                    pool_status = soup.find("p", id="pool-status-item")
                    if pool_status:
                        if _need_pool_hashrate:
                            text = pool_status.get_text(strip=True)
                            m_total = re.search(r"HASHRATE:\s*([\d\.]+)\s*(\w+/s)", text, re.IGNORECASE)
                            if m_total:
                                raw_val = float(m_total.group(1))
                                unit = m_total.group(2)
                                data.pool_total_hashrate = raw_val
                                data.pool_total_hashrate_unit = unit
                        if _need_last_block:
                            span = pool_status.find("span", class_="pool-status-newline")
                            if span:
                                last_block_text = span.get_text(strip=True)
                                m_block = re.search(r"LAST BLOCK:\s*(\d+\s*\(.*\))", last_block_text, re.IGNORECASE)
                                if m_block:
                                    full_last_block = m_block.group(1)
                                    data.last_block = full_last_block
                                    match = re.match(r"(\d+)\s*\((.*?)\)", full_last_block)
                                    if match:
                                        data.last_block_height = match.group(1)
                                        data.last_block_time = match.group(2)
                                    else:
                                        data.last_block_height = full_last_block
                                        data.last_block_time = ""
                else:
                    logging.debug(
                        "Skipping pool-status-item scrape: "
                        "API already supplied pool_total_hashrate and last_block_height"
                    )
            except Exception as e:
                logging.error(f"Error parsing pool status: {e}")

            # Parse the earnings value from the earnings table and convert to sats.
            try:
                earnings_table = soup.find("tbody", id="earnings-tablerows")
                if earnings_table:
                    latest_row = earnings_table.find("tr", class_="table-row")
                    if latest_row:
                        cells = latest_row.find_all("td", class_="table-cell")
                        if len(cells) >= 4:  # Ensure there are enough cells for earnings and pool fees
                            earnings_text = cells[2].get_text(strip=True)
                            pool_fees_text = cells[3].get_text(strip=True)

                            # Parse earnings and pool fees
                            earnings_value = earnings_text.replace("BTC", "").strip()
                            pool_fees_value = pool_fees_text.replace("BTC", "").strip()

                            try:
                                # Convert earnings to BTC and sats
                                btc_earnings = float(earnings_value)
                                sats = int(round(btc_earnings * 100_000_000))
                                data.last_block_earnings = str(sats)

                                # Calculate percentage lost to pool fees
                                btc_pool_fees = float(pool_fees_value)
                                percentage_lost = (btc_pool_fees / btc_earnings) * 100 if btc_earnings > 0 else 0
                                data.pool_fees_percentage = round(percentage_lost, 2)
                            except Exception as e:
                                logging.error(f"Error converting earnings or calculating percentage: {e}")
                                data.last_block_earnings = earnings_value
                                data.pool_fees_percentage = None
            except Exception as e:
                logging.error(f"Error parsing earnings data: {e}")

            # Parse hashrate data from the hashrates table.
            # All hashrate fields are "api-primary"; only scrape intervals
            # that the API did not populate.
            _hr_gaps = {
                "24 hrs": ("hashrate_24hr", "hashrate_24hr_unit"),
                "3 hrs": ("hashrate_3hr", "hashrate_3hr_unit"),
                "10 min": ("hashrate_10min", "hashrate_10min_unit"),
                "5 min": ("hashrate_5min", "hashrate_5min_unit"),
                "60 sec": ("hashrate_60sec", "hashrate_60sec_unit"),
            }
            # Trim to only intervals still missing
            _hr_gaps = {k: v for k, v in _hr_gaps.items() if getattr(data, v[0]) is None}
            try:
                if _hr_gaps:
                    hashrate_table = soup.find("tbody", id="hashrates-tablerows")
                    if hashrate_table:
                        for row in hashrate_table.find_all("tr", class_="table-row"):
                            cells = row.find_all("td", class_="table-cell")
                            if len(cells) >= 2:
                                period_text = cells[0].get_text(strip=True).lower()
                                hashrate_str = cells[1].get_text(strip=True).lower()
                                try:
                                    parts = hashrate_str.split()
                                    hashrate_val = float(parts[0])
                                    unit = parts[1] if len(parts) > 1 else "th/s"
                                    for key, (attr, unit_attr) in _hr_gaps.items():
                                        if key.lower() in period_text:
                                            setattr(data, attr, hashrate_val)
                                            setattr(data, unit_attr, unit)
                                            break
                                except Exception as e:
                                    logging.error(f"Error parsing hashrate '{hashrate_str}': {e}")
                else:
                    logging.debug("Skipping hashrates-tablerows scrape: all hashrate intervals already filled by API")
            except Exception as e:
                logging.error(f"Error parsing hashrate table: {e}")

            # Parse lifetime stats data
            try:
                lifetime_snap = soup.find("div", id="lifetimesnap-statcards")
                if lifetime_snap:
                    for container in lifetime_snap.find_all("div", class_="blocks dashboard-container"):
                        label_div = container.find("div", class_="blocks-label")
                        if label_div:
                            label_text = label_div.get_text(strip=True).lower()
                            earnings_span = label_div.find_next("span", class_=lambda x: x != "tooltiptext")
                            if earnings_span:
                                span_text = earnings_span.get_text(strip=True)
                                try:
                                    earnings_value = float(span_text.split()[0].replace(",", ""))
                                    if "earnings" in label_text and "day" in label_text:
                                        data.estimated_earnings_per_day = earnings_value
                                except Exception:
                                    pass
            except Exception as e:
                logging.error(f"Error parsing lifetime stats: {e}")

            # Parse payout stats data.
            # estimated_earnings_next_block and estimated_rewards_in_window are
            # "api-primary"; only scrape if the API left them empty.
            _need_next_block = data.estimated_earnings_next_block is None
            _need_window = data.estimated_rewards_in_window is None
            try:
                if _need_next_block or _need_window:
                    payout_snap = soup.find("div", id="payoutsnap-statcards")
                    if payout_snap:
                        for container in payout_snap.find_all("div", class_="blocks dashboard-container"):
                            label_div = container.find("div", class_="blocks-label")
                            if label_div:
                                label_text = label_div.get_text(strip=True).lower()
                                earnings_span = label_div.find_next("span", class_=lambda x: x != "tooltiptext")
                                if earnings_span:
                                    span_text = earnings_span.get_text(strip=True)
                                    try:
                                        earnings_value = float(span_text.split()[0].replace(",", ""))
                                        if _need_next_block and "earnings" in label_text and "block" in label_text:
                                            data.estimated_earnings_next_block = earnings_value
                                        elif _need_window and "rewards" in label_text and "window" in label_text:
                                            data.estimated_rewards_in_window = earnings_value
                                    except Exception:
                                        pass
                else:
                    logging.debug(
                        "Skipping payoutsnap-statcards scrape: "
                        "estimated_earnings_next_block and estimated_rewards_in_window already filled by API"
                    )
            except Exception as e:
                logging.error(f"Error parsing payout stats: {e}")

            # Parse user stats data.
            # workers_hashing and unpaid_earnings are "api-primary"; only scrape
            # if the API left them empty.  est_time_to_payout is "scrape-only"
            # and is always collected here.
            _need_workers = data.workers_hashing is None
            _need_unpaid = data.unpaid_earnings is None
            try:
                if _need_workers or _need_unpaid or True:  # always scrape for est_time_to_payout
                    usersnap = soup.find("div", id="usersnap-statcards")
                    if usersnap:
                        for container in usersnap.find_all("div", class_="blocks dashboard-container"):
                            label_div = container.find("div", class_="blocks-label")
                            if label_div:
                                label_text = label_div.get_text(strip=True).lower()
                                value_span = label_div.find_next("span", class_=lambda x: x != "tooltiptext")
                                if value_span:
                                    span_text = value_span.get_text(strip=True)
                                    if _need_workers and "workers currently hashing" in label_text:
                                        try:
                                            data.workers_hashing = int(span_text.replace(",", ""))
                                            _need_workers = False
                                        except Exception:
                                            pass
                                    elif (
                                        _need_unpaid
                                        and "unpaid earnings" in label_text
                                        and "btc" in span_text.lower()
                                    ):
                                        try:
                                            data.unpaid_earnings = float(span_text.split()[0].replace(",", ""))
                                            _need_unpaid = False
                                        except Exception:
                                            pass
                                    elif "estimated time until minimum payout" in label_text:
                                        # scrape-only: always collect
                                        data.est_time_to_payout = span_text
            except Exception as e:
                logging.error(f"Error parsing user stats: {e}")

            # Parse blocks found data.
            # blocks_found is "api-primary" (pool_stat endpoint); only scrape
            # when the API did not supply it.
            try:
                if data.blocks_found is None:
                    blocks_container = soup.find(
                        lambda tag: tag.name == "div" and "blocks found" in tag.get_text(strip=True).lower()
                    )
                    if blocks_container:
                        span = blocks_container.find_next_sibling("span")
                        if span:
                            num_match = re.search(r"(\d+)", span.get_text(strip=True))
                            if num_match:
                                data.blocks_found = num_match.group(1)
                else:
                    logging.debug("Skipping blocks-found scrape: API already supplied blocks_found")
            except Exception as e:
                logging.error(f"Error parsing blocks found: {e}")

            # Parse last share time data.
            # total_last_share is "api-primary" (statsnap lastest_share_ts);
            # only fall back to scraping the workers table when the API did not
            # supply a formatted timestamp.
            try:
                if data.total_last_share == "N/A":
                    workers_table = soup.find("tbody", id="workers-tablerows")
                    if workers_table:
                        for row in workers_table.find_all("tr", class_="table-row"):
                            cells = row.find_all("td")
                            if cells and cells[0].get_text(strip=True).lower().startswith("total"):
                                last_share_str = cells[2].get_text(strip=True)
                                try:
                                    naive_dt = datetime.strptime(last_share_str, "%Y-%m-%d %H:%M")
                                    utc_dt = naive_dt.replace(tzinfo=ZoneInfo("UTC"))
                                    la_dt = utc_dt.astimezone(ZoneInfo(get_timezone()))
                                    data.total_last_share = la_dt.strftime("%Y-%m-%d %I:%M %p")
                                except Exception as e:
                                    logging.error(f"Error converting last share time '{last_share_str}': {e}")
                                    data.total_last_share = last_share_str
                                break
                else:
                    logging.debug("Skipping workers-tablerows last-share scrape: API already supplied total_last_share")
            except Exception as e:
                logging.error(f"Error parsing last share time: {e}")

            return data
        except Exception as e:
            logging.error(f"Error fetching Ocean data: {e}")
            return None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass
            cleanup_soup(soup)

    def debug_dump_table(self, table_element, max_rows=3):
        """
        Helper method to dump the structure of an HTML table for debugging.

        Args:
            table_element: BeautifulSoup element representing the table
            max_rows (int): Maximum number of rows to output
        """
        if not table_element:
            logging.debug("Table element is None - cannot dump structure")
            return

        try:
            rows = table_element.find_all("tr", class_="table-row")
            logging.debug(f"Found {len(rows)} rows in table")

            # Dump header row if present
            header_row = table_element.find_parent("table").find("thead")
            if header_row:
                header_cells = header_row.find_all("th")
                header_texts = [cell.get_text(strip=True) for cell in header_cells]
                logging.debug(f"Header: {header_texts}")

            # Dump a sample of the data rows
            for i, row in enumerate(rows[:max_rows]):
                cells = row.find_all("td", class_="table-cell")
                cell_texts = [cell.get_text(strip=True) for cell in cells]
                logging.debug(f"Row {i}: {cell_texts}")

                # Also look at raw HTML for problematic cells
                for j, cell in enumerate(cells):
                    logging.debug(f"Row {i}, Cell {j} HTML: {cell}")

        except Exception as e:
            logging.error(f"Error dumping table structure: {e}")

    def get_payment_history_scrape(self, btc_price=None):
        """Scrape payout history from the stats page as a fallback."""
        base_url = "https://ocean.xyz"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
        }
        payments = []
        resp = None
        soup = None
        try:
            page = 0
            reached_limit = False
            while True:
                url = f"{base_url}/stats/{self.wallet}?ppage={page}#payouts-fulltable"
                resp = self.session.get(url, headers=headers, timeout=10)
                if not resp.ok:
                    if page == 0:
                        logging.error(f"Error fetching payout page: {resp.status_code}")
                        resp.close()
                        return None
                    resp.close()
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                try:
                    table = soup.find("tbody", id="payouts-tablerows") or soup.find("tbody", id="payout-tablerows")
                    if not table:
                        if page == 0:
                            logging.error("Payout table not found")
                            return None
                        break

                    rows = table.find_all("tr", class_="table-row")
                    if not rows:
                        break

                    for row in rows:
                        cells = row.find_all("td")
                        if len(cells) < 3:
                            continue
                        date_text = cells[0].get_text(strip=True)
                        link = cells[1].find("a")
                        txid = cells[1].get_text(strip=True)
                        lightning_txid = ""
                        if link and link.get("href"):
                            href = link["href"]
                            if "lightning" in href:
                                lightning_txid = href.rstrip("/").split("/")[-1]
                                txid = ""
                            else:
                                txid = href.rstrip("/").split("/")[-1]
                        amount_text = cells[-1].get_text(strip=True)
                        amount_clean = amount_text.replace("BTC", "").replace(",", "").strip()
                        try:
                            amount_btc = float(amount_clean)
                        except Exception:
                            continue
                        sats = int(round(amount_btc * self.sats_per_btc))
                        date_iso = None
                        date_str = date_text
                        try:
                            dt = datetime.strptime(date_text, "%Y-%m-%d %H:%M")
                            dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(get_timezone()))
                            date_iso = dt.isoformat()
                            date_str = dt.strftime("%Y-%m-%d %H:%M")
                        except Exception:
                            pass
                        payment = {
                            "date": date_str,
                            "txid": txid,
                            "lightning_txid": lightning_txid,
                            "amount_btc": amount_btc,
                            "amount_sats": sats,
                            "status": "confirmed",
                            "date_iso": date_iso,
                        }
                        if btc_price is not None:
                            payment["rate"] = btc_price
                            payment["fiat_value"] = amount_btc * btc_price
                        payments.append(payment)

                        if len(payments) >= MAX_PAYOUT_HISTORY_ENTRIES:
                            reached_limit = True
                            break

                    if reached_limit:
                        break
                    page += 1
                finally:
                    cleanup_soup(soup)
                    if resp:
                        try:
                            resp.close()
                        except Exception:
                            pass
            return payments[:MAX_PAYOUT_HISTORY_ENTRIES]
        except Exception as e:
            logging.error(f"Error scraping payment history: {e}")
            return None

    @ttl_cache(ttl_seconds=60, maxsize=1)
    def get_all_worker_rows(self):
        """Collect worker row data from the stats pages."""
        all_rows = []
        page_num = 0
        max_pages = 10  # Limit to 10 pages of worker data

        while page_num < max_pages:  # Only fetch up to max_pages
            url = f"https://ocean.xyz/stats/{self.wallet}?wpage={page_num}#workers-fulltable"
            logging.info(
                f"Fetching worker data from: {url} (page {page_num+1} of max {max_pages})"
            )
            response = None
            try:
                response = self.session.get(url, timeout=15)
                if not response.ok:
                    logging.error(
                        f"Error fetching page {page_num}: status code {response.status_code}"
                    )
                    break

                soup = BeautifulSoup(response.text, "html.parser")
                try:
                    workers_table = soup.find("tbody", id="workers-tablerows")
                    if not workers_table:
                        logging.debug(f"No workers table found on page {page_num}")
                        break

                    rows = workers_table.find_all("tr", class_="table-row")
                    if not rows:
                        logging.debug(
                            f"No worker rows found on page {page_num}, stopping pagination"
                        )
                        break

                    logging.info(f"Found {len(rows)} worker rows on page {page_num}")
                    for row in rows:
                        row_dict = {
                            "text": row.get_text(separator=" ", strip=True),
                            "cells": [c.get_text(strip=True) for c in row.find_all(["td", "th"])],
                            "attrs": dict(row.attrs),
                        }
                        all_rows.append(row_dict)
                    page_num += 1
                finally:
                    cleanup_soup(soup)
            except Exception as e:
                logging.error(f"Error fetching worker page {page_num}: {e}")
                break
            finally:
                if response:
                    try:
                        response.close()
                    except Exception:
                        pass
        if page_num >= max_pages:
            logging.info(
                f"Reached maximum page limit ({max_pages}). Collected {len(all_rows)} worker rows total."
            )
        else:
            msg = (
                "Completed fetching all available worker data. Collected "
                f"{len(all_rows)} worker rows from {page_num} pages."
            )
            logging.info(msg)

        return all_rows

    def get_worker_data(self):
        """
        Get worker data from Ocean.xyz using multiple parsing strategies.
        Tries different approaches to handle changes in the website structure.
        Validates worker names to ensure they're not status indicators.

        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        logging.info("Attempting to get worker data from Ocean.xyz")

        # First try the alternative method as it's more robust
        result = self.get_worker_data_alternative()

        # Check if alternative method succeeded and found workers with valid names
        if result and result.get("workers") and len(result["workers"]) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result["workers"]:
                name = worker.get("name", "").lower()
                if name and name not in ["online", "offline", "total", "worker", "status"]:
                    has_valid_workers = True
                    break

            if has_valid_workers:
                logging.info(
                    f"Alternative worker data method successful: {len(result['workers'])} workers with valid names"
                )
                return result
            else:
                logging.warning("Alternative method found workers but with invalid names")

        # If alternative method failed or found workers with invalid names, try the original method
        logging.info("Trying original worker data method")
        result = self.get_worker_data_original()

        # Check if original method succeeded and found workers with valid names
        if result and result.get("workers") and len(result["workers"]) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result["workers"]:
                name = worker.get("name", "").lower()
                if name and name not in ["online", "offline", "total", "worker", "status"]:
                    has_valid_workers = True
                    break

            if has_valid_workers:
                logging.info(
                    f"Original worker data method successful: {len(result['workers'])} workers with valid names"
                )
                return result
            else:
                logging.warning("Original method found workers but with invalid names")

        # If original method also failed, try fetching from the official API
        logging.info("Trying API worker data method")
        result = self.get_worker_data_api()

        if result and result.get("workers") and len(result["workers"]) > 0:
            has_valid_workers = False
            for worker in result["workers"]:
                name = worker.get("name", "").lower()
                if name and name not in ["online", "offline", "total", "worker", "status"]:
                    has_valid_workers = True
                    break

            if has_valid_workers:
                logging.info(f"API worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("API method found workers but with invalid names")

        # If both methods failed or found workers with invalid names, use fallback data
        logging.warning("Both worker data fetch methods failed to get valid names, using fallback data")

        # Try to get worker count from cached metrics
        workers_count = 0
        if hasattr(self, "cached_metrics") and self.cached_metrics:
            workers_count = self.cached_metrics.get("workers_hashing", 0)

        # If no cached metrics, try to get from somewhere else
        if workers_count <= 0 and result and result.get("workers_total"):
            workers_count = result.get("workers_total")

        # Ensure we have at least 1 worker
        workers_count = max(1, workers_count)

        logging.info(f"Using fallback data generation with {workers_count} workers")

        if self.worker_service:
            metrics = getattr(self, "cached_metrics", {}) or {
                "workers_hashing": workers_count,
                "hashrate_3hr": 0,
                "hashrate_3hr_unit": "TH/s",
            }
            return self.worker_service.generate_fallback_data(metrics)

        # Minimal fallback if no worker_service is available
        return {
            "workers": [],
            "workers_total": workers_count,
            "workers_online": 0,
            "workers_offline": workers_count,
            "total_hashrate": 0.0,
            "hashrate_unit": "TH/s",
            "total_earnings": 0.0,
            "daily_sats": 0,
            "total_power": 0,
            "hashrate_history": [],
            "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
        }

    # Rename the original method to get_worker_data_original
    def get_worker_data_original(self):
        """
        Original implementation to get worker data from Ocean.xyz.

        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        base_url = "https://ocean.xyz"
        stats_url = f"{base_url}/stats/{self.wallet}"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
        }

        soup = None
        response = None
        try:
            logging.info(f"Fetching worker data from {stats_url}")
            response = self.session.get(stats_url, headers=headers, timeout=15)
            if not response.ok:
                logging.error(f"Error fetching ocean worker data: status code {response.status_code}")
                return None

            soup = BeautifulSoup(response.text, "html.parser")

            # Parse worker data from the workers table
            workers = []
            total_hashrate = 0
            total_earnings = 0

            workers_table = soup.find("tbody", id="workers-tablerows")
            if not workers_table:
                logging.error("Workers table not found in Ocean.xyz page")
                return None

            # Debug: Dump table structure to help diagnose parsing issues
            self.debug_dump_table(workers_table)

            # Find total worker counts
            workers_online = 0
            workers_offline = 0

            # Iterate through worker rows in the table
            for row in workers_table.find_all("tr", class_="table-row"):
                cells = row.find_all("td", class_="table-cell")

                # Skip rows that don't have enough cells for basic info
                if len(cells) < 3:
                    logging.warning(f"Worker row has too few cells: {len(cells)}")
                    continue

                try:
                    # Extract worker name from the first cell
                    name_cell = cells[0]
                    name_text = name_cell.get_text(strip=True)

                    # Skip the total row
                    if name_text.lower() == "total":
                        logging.debug("Skipping total row")
                        continue

                    logging.debug(f"Processing worker: {name_text}")

                    # Create worker object with safer extraction
                    worker = {
                        "name": name_text.strip(),
                        "status": "offline",  # Default to offline
                        "type": "ASIC",  # Default type
                        "model": "Unknown",
                        "hashrate_60sec": 0,
                        "hashrate_60sec_unit": "TH/s",
                        "hashrate_3hr": 0,
                        "hashrate_3hr_unit": "TH/s",
                        "efficiency": 90.0,  # Default efficiency
                        "last_share": "N/A",
                        "earnings": 0,
                        "power_consumption": 0,
                        "temperature": 0,
                    }

                    # Parse status from second cell if available
                    if len(cells) > 1:
                        status_cell = cells[1]
                        status_text = status_cell.get_text(strip=True).lower()
                        worker["status"] = "online" if "online" in status_text else "offline"

                        # Update counter based on status
                        if worker["status"] == "online":
                            workers_online += 1
                        else:
                            workers_offline += 1

                    # Parse last share time
                    if len(cells) > 2:
                        last_share_cell = cells[2]
                        worker["last_share"] = last_share_cell.get_text(strip=True)

                    # Parse 60sec hashrate if available
                    if len(cells) > 3:
                        hashrate_60s_cell = cells[3]
                        hashrate_60s_text = hashrate_60s_cell.get_text(strip=True)

                        # Parse hashrate_60sec and unit with more robust handling
                        try:
                            parts = hashrate_60s_text.split()
                            if parts and len(parts) > 0:
                                # First part should be the number
                                try:
                                    numeric_value = float(parts[0])
                                    worker["hashrate_60sec"] = numeric_value

                                    # Second part should be the unit if it exists
                                    if len(parts) > 1 and "btc" not in parts[1].lower():
                                        worker["hashrate_60sec_unit"] = parts[1]
                                except ValueError:
                                    # If we can't convert to float, it might be a non-numeric value
                                    logging.warning(f"Could not parse 60s hashrate value: {parts[0]}")
                        except Exception as e:
                            logging.error(f"Error parsing 60s hashrate '{hashrate_60s_text}': {e}")

                    # Parse 3hr hashrate if available
                    if len(cells) > 4:
                        hashrate_3hr_cell = cells[4]
                        hashrate_3hr_text = hashrate_3hr_cell.get_text(strip=True)

                        # Parse hashrate_3hr and unit with more robust handling
                        try:
                            parts = hashrate_3hr_text.split()
                            if parts and len(parts) > 0:
                                # First part should be the number
                                try:
                                    numeric_value = float(parts[0])
                                    worker["hashrate_3hr"] = numeric_value

                                    # Second part should be the unit if it exists
                                    if len(parts) > 1 and "btc" not in parts[1].lower():
                                        worker["hashrate_3hr_unit"] = parts[1]

                                    # Add to total hashrate (normalized to TH/s for consistency)
                                    total_hashrate += convert_to_ths(
                                        worker["hashrate_3hr"], worker["hashrate_3hr_unit"]
                                    )
                                except ValueError:
                                    # If we can't convert to float, it might be a non-numeric value
                                    logging.warning(f"Could not parse 3hr hashrate value: {parts[0]}")
                        except Exception as e:
                            logging.error(f"Error parsing 3hr hashrate '{hashrate_3hr_text}': {e}")

                    # Parse earnings if available
                    if len(cells) > 5:
                        earnings_cell = cells[5]
                        earnings_text = earnings_cell.get_text(strip=True)

                        # Parse earnings with more robust handling
                        try:
                            # Remove BTC or other text, keep only the number
                            earnings_value = earnings_text.replace("BTC", "").strip()
                            try:
                                worker["earnings"] = float(earnings_value)
                                total_earnings += worker["earnings"]
                            except ValueError:
                                logging.warning(f"Could not parse earnings value: {earnings_value}")
                        except Exception as e:
                            logging.error(f"Error parsing earnings '{earnings_text}': {e}")

                    # Determine model specs from worker name
                    specs = parse_worker_name(worker["name"])
                    if specs:
                        worker["type"] = specs["type"]
                        worker["model"] = specs["model"]
                        worker["efficiency"] = specs["efficiency"]
                        hr_ths = convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                        worker["power_consumption"] = round(hr_ths * specs["efficiency"])
                    else:
                        lower_name = worker["name"].lower()
                        if "antminer" in lower_name:
                            worker["type"] = "ASIC"
                            worker["model"] = "Bitmain Antminer"
                        elif "whatsminer" in lower_name:
                            worker["type"] = "ASIC"
                            worker["model"] = "MicroBT Whatsminer"
                        elif "bitaxe" in lower_name or "nerdqaxe" in lower_name:
                            worker["type"] = "Bitaxe"
                            worker["model"] = "BitAxe Gamma 601"

                    workers.append(worker)

                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue

            # Get daily sats from the ocean data
            daily_sats = 0
            try:
                # Try to get this from the payoutsnap card
                payout_snap = soup.find("div", id="payoutsnap-statcards")
                if payout_snap:
                    for container in payout_snap.find_all("div", class_="blocks dashboard-container"):
                        label_div = container.find("div", class_="blocks-label")
                        if label_div and "earnings per day" in label_div.get_text(strip=True).lower():
                            value_span = label_div.find_next("span")
                            if value_span:
                                value_text = value_span.get_text(strip=True)
                                try:
                                    btc_per_day = float(value_text.split()[0])
                                    daily_sats = int(btc_per_day * self.sats_per_btc)
                                except (ValueError, IndexError):
                                    pass
            except Exception as e:
                logging.error(f"Error parsing daily sats: {e}")

            # Check if we found any workers
            if not workers:
                logging.warning("No workers found in the table, possibly a parsing issue")
                return None

            # Return worker stats dictionary
            result = {
                "workers": workers,
                "total_hashrate": total_hashrate,
                "hashrate_unit": "TH/s",  # Always use TH/s for consistent display
                "workers_total": len(workers),
                "workers_online": workers_online,
                "workers_offline": workers_offline,
                "total_earnings": total_earnings,
                "daily_sats": daily_sats,
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            }

            logging.info(f"Successfully retrieved worker data: {len(workers)} workers")
            return result

        except Exception as e:
            logging.error(f"Error fetching Ocean worker data: {e}")
            import traceback

            logging.error(traceback.format_exc())
            return None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass
            cleanup_soup(soup)

    def get_worker_data_alternative(self):
        """
        Alternative implementation to get worker data from Ocean.xyz.
        This version consolidates worker rows from all pages using the wpage parameter.

        Returns:
            dict: Worker data dictionary with stats and list of workers.
        """
        try:
            logging.info("Fetching worker data across multiple pages (alternative method)")
            # Get all worker rows from every page
            rows = self.get_all_worker_rows()
            if not rows:
                logging.error("No worker rows found across any pages")
                return None

            workers = []
            total_hashrate = 0
            total_earnings = 0
            workers_online = 0
            workers_offline = 0
            invalid_names = ["online", "offline", "status", "worker", "total"]

            # Process each row from all pages
            for row_idx, row in enumerate(rows):
                cells = row.get("cells", [])
                if not cells or len(cells) < 3:
                    continue

                first_cell_text = cells[0]
                if first_cell_text.lower() in invalid_names:
                    continue

                try:
                    worker_name = first_cell_text or f"Worker_{row_idx+1}"
                    worker = {
                        "name": worker_name,
                        "status": "online",  # Default assumption
                        "type": "ASIC",
                        "model": "Unknown",
                        "hashrate_60sec": 0,
                        "hashrate_60sec_unit": "TH/s",
                        "hashrate_3hr": 0,
                        "hashrate_3hr_unit": "TH/s",
                        "efficiency": 90.0,
                        "last_share": "N/A",
                        "earnings": 0,
                        "power_consumption": 0,
                        "temperature": 0,
                    }

                    # Extract status from second cell if available
                    if len(cells) > 1:
                        status_text = cells[1].lower()
                        worker["status"] = "online" if "online" in status_text else "offline"
                        if worker["status"] == "online":
                            workers_online += 1
                        else:
                            workers_offline += 1

                    # Parse last share from third cell if available
                    if len(cells) > 2:
                        worker["last_share"] = cells[2]

                    # Parse 60sec hashrate from fourth cell if available
                    if len(cells) > 3:
                        hashrate_60s_text = cells[3]
                        try:
                            parts = hashrate_60s_text.split()
                            if parts:
                                worker["hashrate_60sec"] = float(parts[0])
                                if len(parts) > 1:
                                    worker["hashrate_60sec_unit"] = parts[1]
                        except ValueError:
                            logging.warning(f"Could not parse 60-sec hashrate: {hashrate_60s_text}")

                    # Parse 3hr hashrate from fifth cell if available
                    if len(cells) > 4:
                        hashrate_3hr_text = cells[4]
                        try:
                            parts = hashrate_3hr_text.split()
                            if parts:
                                worker["hashrate_3hr"] = float(parts[0])
                                if len(parts) > 1:
                                    worker["hashrate_3hr_unit"] = parts[1]
                                # Normalize and add to total hashrate (using your convert_to_ths helper)
                                total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                        except ValueError:
                            logging.warning(f"Could not parse 3hr hashrate: {hashrate_3hr_text}")

                    # Look for earnings in any cell containing 'btc'
                    for cell_text in cells:
                        if "btc" in cell_text.lower():
                            try:
                                earnings_match = re.search(r"([\d\.]+)", cell_text)
                                if earnings_match:
                                    worker["earnings"] = float(earnings_match.group(1))
                                    total_earnings += worker["earnings"]
                            except Exception:
                                pass

                    # Determine model specs from worker name
                    specs = parse_worker_name(worker["name"])
                    if specs:
                        worker["type"] = specs["type"]
                        worker["model"] = specs["model"]
                        worker["efficiency"] = specs["efficiency"]
                        hr_ths = convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                        worker["power_consumption"] = round(hr_ths * specs["efficiency"])
                    else:
                        lower_name = worker["name"].lower()
                        if "antminer" in lower_name:
                            worker["type"] = "ASIC"
                            worker["model"] = "Bitmain Antminer"
                        elif "whatsminer" in lower_name:
                            worker["type"] = "ASIC"
                            worker["model"] = "MicroBT Whatsminer"
                        elif "bitaxe" in lower_name or "nerdqaxe" in lower_name:
                            worker["type"] = "Bitaxe"
                            worker["model"] = "BitAxe Gamma 601"

                    if worker["name"].lower() not in invalid_names:
                        workers.append(worker)

                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue

            if not workers:
                logging.error("No valid worker data parsed")
                return None

            result = {
                "workers": workers,
                "total_hashrate": total_hashrate,
                "hashrate_unit": "TH/s",
                "workers_total": len(workers),
                "workers_online": workers_online,
                "workers_offline": workers_offline,
                "total_earnings": total_earnings,
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            }
            logging.info(f"Successfully retrieved {len(workers)} workers across multiple pages")
            return result

        except Exception as e:
            logging.error(f"Error in alternative worker data fetch: {e}")
            return None
