"""
Data service module for fetching and processing mining data.
"""
import logging
import re
import time
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

from models import OceanData, convert_to_ths
from config import get_timezone
from miner_specs import parse_worker_name

class MiningDashboardService:
    """Service for fetching and processing mining dashboard data."""
    
    def __init__(self, power_cost, power_usage, wallet, network_fee=0.0, worker_service=None):
        """
        Initialize the mining dashboard service.
    
        Args:
            power_cost (float): Cost of power in $ per kWh
            power_usage (float): Power usage in watts
            wallet (str): Bitcoin wallet address for Ocean.xyz
            network_fee (float): Additional network fee percentage
        """
        self.power_cost = power_cost
        self.power_usage = power_usage
        self.wallet = wallet
        self.network_fee = network_fee
        self.worker_service = worker_service
        self.cache = {}
        self.sats_per_btc = 100_000_000
        self.previous_values = {}
        self.session = requests.Session()
        # Persistent executor for concurrent tasks
        self.executor = ThreadPoolExecutor(max_workers=6)
        # Cache for storing fetched currency exchange rates
        self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
        # Time-to-live (TTL) for exchange rate cache in seconds (~2 hours)
        self.exchange_rate_ttl = 7200

    def set_worker_service(self, worker_service):
        """Associate a WorkerService instance for power estimation."""
        self.worker_service = worker_service

    def estimate_total_power(self):
        """Estimate total power usage from worker data if available."""
        if not self.worker_service:
            return 0
        try:
            data = self.worker_service.get_workers_data({}, force_refresh=False)
            if data:
                if "total_power" in data and data["total_power"]:
                    return data["total_power"]
                if data.get("workers"):
                    return sum(w.get("power_consumption", 0) for w in data["workers"])
        except Exception as e:
            logging.error(f"Error estimating power usage: {e}")
        return 0

    def close(self):
        """Close any open network resources."""
        try:
            self.session.close()
            self.executor.shutdown(wait=False)
        except Exception as e:
            logging.error(f"Error closing session: {e}")

    def fetch_metrics(self):
        """
        Fetch metrics from Ocean.xyz and other sources.
    
        Returns:
            dict: Mining metrics data
        """
        # Add execution time tracking
        start_time = time.time()
    
        try:
            future_ocean = self.executor.submit(self.get_ocean_data)
            future_btc = self.executor.submit(self.get_bitcoin_stats)
            try:
                ocean_data = future_ocean.result(timeout=15)
                btc_stats = future_btc.result(timeout=15)
            except Exception as e:
                logging.error(f"Error fetching metrics concurrently: {e}")
                return None

            if ocean_data is None:
                logging.error("Failed to retrieve Ocean data")
                return None
                
            difficulty, network_hashrate, btc_price, block_count = btc_stats
        
            # If we failed to get network hashrate, use a reasonable default to prevent division by zero
            if network_hashrate is None:
                logging.warning("Using default network hashrate")
                network_hashrate = 500e18  # ~500 EH/s as a reasonable fallback
            
            # If we failed to get BTC price, use a reasonable default
            if btc_price is None:
                logging.warning("Using default BTC price")
                btc_price = 75000  # $75,000 as a reasonable fallback

            # Convert hashrates to a common unit (TH/s) for consistency
            hr3 = ocean_data.hashrate_3hr or 0
            hr3_unit = (ocean_data.hashrate_3hr_unit or 'th/s').lower()
            local_hashrate = convert_to_ths(hr3, hr3_unit) * 1e12  # Convert to H/s for calculation

            hash_proportion = local_hashrate / network_hashrate if network_hashrate else 0
            block_reward = 3.125
            blocks_per_day = 86400 / 600
            daily_btc_gross = hash_proportion * block_reward * blocks_per_day
        
            # Use actual pool fees instead of hardcoded values
            # Get the pool fee percentage from ocean_data, default to 2.0% if not available
            pool_fee_percent = ocean_data.pool_fees_percentage if ocean_data.pool_fees_percentage is not None else 2.0
        
            # Get the network fee from the configuration (default to 0.0% if not set)
            from config import load_config
            config = load_config()
            network_fee_percent = config.get("network_fee", 0.0)
        
            # Calculate total fee percentage (converting from percentage to decimal)
            total_fee_rate = (pool_fee_percent + network_fee_percent) / 100.0
        
            # Calculate net BTC accounting for actual fees
            daily_btc_net = daily_btc_gross * (1 - total_fee_rate)
        
            # Log the fee calculations for transparency
            logging.info(f"Earnings calculation using pool fee: {pool_fee_percent}% + network fee: {network_fee_percent}%")
            logging.info(f"Total fee rate: {total_fee_rate}, Daily BTC gross: {daily_btc_gross}, Daily BTC net: {daily_btc_net}")

            daily_revenue = round(daily_btc_net * btc_price, 2) if btc_price is not None else None

            power_usage_for_calc = self.power_usage
            power_cost_for_calc = self.power_cost
            power_usage_estimated = False

            if power_usage_for_calc is None or power_usage_for_calc <= 0:
                estimated_power = self.estimate_total_power()
                if estimated_power:
                    power_usage_for_calc = estimated_power
                    power_usage_estimated = True
                    if power_cost_for_calc is None or power_cost_for_calc <= 0:
                        power_cost_for_calc = 0.07

            daily_power_cost = round((power_usage_for_calc / 1000) * power_cost_for_calc * 24, 2)
            daily_profit_usd = round(daily_revenue - daily_power_cost, 2) if daily_revenue is not None else None
            monthly_profit_usd = round(daily_profit_usd * 30, 2) if daily_profit_usd is not None else None

            # Calculate break-even electricity price in $/kWh
            daily_energy_kwh = (power_usage_for_calc / 1000) * 24
            break_even_electricity_price = round(
                daily_revenue / daily_energy_kwh, 4
            ) if daily_energy_kwh > 0 else None

            daily_mined_sats = int(round(daily_btc_net * self.sats_per_btc))
            monthly_mined_sats = daily_mined_sats * 30

            # Use default 0 for earnings if scraping returned None.
            estimated_earnings_per_day = ocean_data.estimated_earnings_per_day if ocean_data.estimated_earnings_per_day is not None else 0
            estimated_earnings_next_block = ocean_data.estimated_earnings_next_block if ocean_data.estimated_earnings_next_block is not None else 0
            estimated_rewards_in_window = ocean_data.estimated_rewards_in_window if ocean_data.estimated_rewards_in_window is not None else 0

            metrics = {
                'pool_total_hashrate': ocean_data.pool_total_hashrate,
                'pool_total_hashrate_unit': ocean_data.pool_total_hashrate_unit,
                'hashrate_24hr': ocean_data.hashrate_24hr,
                'hashrate_24hr_unit': ocean_data.hashrate_24hr_unit,
                'hashrate_3hr': ocean_data.hashrate_3hr,
                'hashrate_3hr_unit': ocean_data.hashrate_3hr_unit,
                'hashrate_10min': ocean_data.hashrate_10min,
                'hashrate_10min_unit': ocean_data.hashrate_10min_unit,
                'hashrate_5min': ocean_data.hashrate_5min,
                'hashrate_5min_unit': ocean_data.hashrate_5min_unit,
                'hashrate_60sec': ocean_data.hashrate_60sec,
                'hashrate_60sec_unit': ocean_data.hashrate_60sec_unit,
                'workers_hashing': ocean_data.workers_hashing,
                'btc_price': btc_price,
                'block_number': block_count,
                'network_hashrate': (network_hashrate / 1e18) if network_hashrate else None,
                'difficulty': difficulty,
                'daily_btc_gross': daily_btc_gross,
                'daily_btc_net': daily_btc_net,
                'pool_fee_percent': pool_fee_percent,
                'network_fee_percent': network_fee_percent, 
                'total_fee_rate': total_fee_rate,
                'estimated_earnings_per_day': estimated_earnings_per_day,
                'daily_revenue': daily_revenue,
                'daily_power_cost': daily_power_cost,
                'daily_profit_usd': daily_profit_usd,
                'monthly_profit_usd': monthly_profit_usd,
                'break_even_electricity_price': break_even_electricity_price,
                'power_usage_estimated': power_usage_estimated,
                'daily_mined_sats': daily_mined_sats,
                'monthly_mined_sats': monthly_mined_sats,
                'estimated_earnings_next_block': estimated_earnings_next_block,
                'estimated_rewards_in_window': estimated_rewards_in_window,
                'unpaid_earnings': ocean_data.unpaid_earnings,
                'est_time_to_payout': ocean_data.est_time_to_payout,
                'last_block_height': ocean_data.last_block_height,
                'last_block_time': ocean_data.last_block_time,
                'total_last_share': ocean_data.total_last_share,
                'blocks_found': ocean_data.blocks_found or "0",
                'last_block_earnings': ocean_data.last_block_earnings,
                'pool_fees_percentage': ocean_data.pool_fees_percentage,
            }
            metrics['estimated_earnings_per_day_sats'] = int(round(estimated_earnings_per_day * self.sats_per_btc))
            metrics['estimated_earnings_next_block_sats'] = int(round(estimated_earnings_next_block * self.sats_per_btc))
            metrics['estimated_rewards_in_window_sats'] = int(round(estimated_rewards_in_window * self.sats_per_btc))

            # --- Add server timestamps to the response in Los Angeles Time ---
            metrics["server_timestamp"] = datetime.now(ZoneInfo(get_timezone())).isoformat()
            metrics["server_start_time"] = datetime.now(ZoneInfo(get_timezone())).isoformat()

            # Get the configured currency
            from config import get_currency
            selected_currency = get_currency()

            # Add currency to metrics
            metrics["currency"] = selected_currency

            if selected_currency != "USD":
                exchange_rates = self.fetch_exchange_rates()
                rate = exchange_rates.get(selected_currency, 1.0)
                metrics["btc_price"] = round(metrics["btc_price"] * rate, 2)
                metrics["daily_revenue"] = round(metrics["daily_revenue"] * rate, 2)
                metrics["daily_power_cost"] = round(metrics["daily_power_cost"] * rate, 2)
                metrics["daily_profit_usd"] = round(metrics["daily_profit_usd"] * rate, 2)
                metrics["monthly_profit_usd"] = round(metrics["monthly_profit_usd"] * rate, 2)
                if metrics["break_even_electricity_price"] is not None:
                    metrics["break_even_electricity_price"] = round(
                        metrics["break_even_electricity_price"] * rate, 4
                    )
                metrics["exchange_rates"] = exchange_rates
            else:
                metrics["exchange_rates"] = {}

            # Log execution time
            execution_time = time.time() - start_time
            metrics["execution_time"] = execution_time
            if execution_time > 10:
                logging.warning(f"Metrics fetch took {execution_time:.2f} seconds")
            else:
                logging.info(f"Metrics fetch completed in {execution_time:.2f} seconds")

            return metrics
            
        except Exception as e:
            logging.error(f"Unexpected error in fetch_metrics: {e}")
            return None

    def get_ocean_api_data(self):
        """Fetch mining data using the official Ocean.xyz API."""
        api_base = "https://api.ocean.xyz/v1"
        result = {}

        # Fetch hashrate info
        try:
            url = f"{api_base}/user_hashrate/{self.wallet}"
            resp = self.session.get(url, timeout=10)
            if resp.ok:
                hr_data = resp.json()
                result["hashrate_60sec"] = hr_data.get("hashrate_60s")
                result["hashrate_5min"] = hr_data.get("hashrate_300s")
                result["hashrate_10min"] = hr_data.get("hashrate_600s")
                result["hashrate_24hr"] = hr_data.get("hashrate_86400")
                # Try several keys for a ~3hr interval
                result["hashrate_3hr"] = hr_data.get("hashrate_10800") or hr_data.get("hashrate_7200") or hr_data.get("hashrate_3600")
                result["hashrate_60sec_unit"] = "H/s"
                result["hashrate_5min_unit"] = "H/s"
                result["hashrate_10min_unit"] = "H/s"
                result["hashrate_24hr_unit"] = "H/s"
                result["hashrate_3hr_unit"] = "H/s"
        except Exception as e:
            logging.error(f"Error fetching user_hashrate API: {e}")

        # Fetch latest statsnap data
        try:
            url = f"{api_base}/statsnap/{self.wallet}"
            resp = self.session.get(url, timeout=10)
            if resp.ok:
                snap = resp.json()
                result["unpaid_earnings"] = snap.get("unpaid")
                result["estimated_earnings_next_block"] = snap.get("estimated_earn_next_block")
                result["estimated_rewards_in_window"] = snap.get("shares_in_tides")
                ts = snap.get("lastest_share_ts")
                if ts:
                    dt = datetime.fromtimestamp(ts, tz=ZoneInfo("UTC")).astimezone(ZoneInfo(get_timezone()))
                    result["total_last_share"] = dt.strftime("%Y-%m-%d %I:%M %p")
        except Exception as e:
            logging.error(f"Error fetching statsnap API: {e}")

        # Merge additional data from other endpoints
        result.update(self.get_pool_stat_api())

        # Pull latest block information using /blocks
        blocks = self.get_blocks_api(page=0, page_size=1)
        if blocks:
            block = blocks[0]
            result["last_block_height"] = block.get("height")
            ts = block.get("time") or block.get("timestamp")
            if ts:
                dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("UTC")).astimezone(ZoneInfo(get_timezone()))
                result["last_block_time"] = dt.strftime("%Y-%m-%d %I:%M %p")

        return result

    def get_pool_stat_api(self):
        """Fetch overall pool statistics using /pool_stat."""
        api_base = "https://api.ocean.xyz/v1"
        data = {}
        try:
            url = f"{api_base}/pool_stat"
            resp = self.session.get(url, timeout=10)
            if resp.ok:
                stat = resp.json()
                data["pool_total_hashrate"] = stat.get("hashrate_60s") or stat.get("hashrate")
                data["pool_total_hashrate_unit"] = "H/s"
                data["workers_hashing"] = stat.get("workers") or stat.get("active_workers")
                data["blocks_found"] = stat.get("blocks") or stat.get("blocks_found")
        except Exception as e:
            logging.error(f"Error fetching pool_stat API: {e}")
        return data

    def get_blocks_api(self, page=0, page_size=20, include_legacy=0):
        """Fetch recent block data using /blocks."""
        api_base = "https://api.ocean.xyz/v1"
        try:
            url = f"{api_base}/blocks/{page}/{page_size}/{include_legacy}"
            resp = self.session.get(url, timeout=10)
            if resp.ok:
                data = resp.json()
                blocks = data.get("blocks")
                if blocks is None:
                    result = data.get("result")
                    if isinstance(result, dict):
                        blocks = result.get("blocks")
                    elif isinstance(result, list):
                        blocks = result
                if isinstance(blocks, list):
                    return blocks
        except Exception as e:
            logging.error(f"Error fetching blocks API: {e}")
        return []

    def get_ocean_data(self):
        """
        Get mining data from Ocean.xyz.
        
        Returns:
            OceanData: Ocean.xyz mining data
        """
        base_url = "https://ocean.xyz"
        stats_url = f"{base_url}/stats/{self.wallet}"
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache'
        }
        
        # Create an empty data object to populate
        data = OceanData()

        # First attempt to populate using the official API
        api_data = self.get_ocean_api_data()
        for key, value in api_data.items():
            if hasattr(data, key) and value is not None:
                setattr(data, key, value)

        try:
            response = self.session.get(stats_url, headers=headers, timeout=10)
            if not response.ok:
                logging.error(f"Error fetching ocean data: status code {response.status_code}")
                return None
                
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Safely extract pool status information
            try:
                pool_status = soup.find("p", id="pool-status-item")
                if pool_status:
                    text = pool_status.get_text(strip=True)
                    m_total = re.search(r'HASHRATE:\s*([\d\.]+)\s*(\w+/s)', text, re.IGNORECASE)
                    if m_total:
                        raw_val = float(m_total.group(1))
                        unit = m_total.group(2)
                        data.pool_total_hashrate = raw_val
                        data.pool_total_hashrate_unit = unit
                    span = pool_status.find("span", class_="pool-status-newline")
                    if span:
                        last_block_text = span.get_text(strip=True)
                        m_block = re.search(r'LAST BLOCK:\s*(\d+\s*\(.*\))', last_block_text, re.IGNORECASE)
                        if m_block:
                            full_last_block = m_block.group(1)
                            data.last_block = full_last_block
                            match = re.match(r'(\d+)\s*\((.*?)\)', full_last_block)
                            if match:
                                data.last_block_height = match.group(1)
                                data.last_block_time = match.group(2)
                            else:
                                data.last_block_height = full_last_block
                                data.last_block_time = ""
            except Exception as e:
                logging.error(f"Error parsing pool status: {e}")
            
            # Parse the earnings value from the earnings table and convert to sats.
            try:
                earnings_table = soup.find('tbody', id='earnings-tablerows')
                if earnings_table:
                    latest_row = earnings_table.find('tr', class_='table-row')
                    if latest_row:
                        cells = latest_row.find_all('td', class_='table-cell')
                        if len(cells) >= 4:  # Ensure there are enough cells for earnings and pool fees
                            earnings_text = cells[2].get_text(strip=True)
                            pool_fees_text = cells[3].get_text(strip=True)
                
                            # Parse earnings and pool fees
                            earnings_value = earnings_text.replace('BTC', '').strip()
                            pool_fees_value = pool_fees_text.replace('BTC', '').strip()
                
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

            # Parse hashrate data from the hashrates table
            try:
                time_mapping = {
                    '24 hrs': ('hashrate_24hr', 'hashrate_24hr_unit'),
                    '3 hrs': ('hashrate_3hr', 'hashrate_3hr_unit'),
                    '10 min': ('hashrate_10min', 'hashrate_10min_unit'),
                    '5 min': ('hashrate_5min', 'hashrate_5min_unit'),
                    '60 sec': ('hashrate_60sec', 'hashrate_60sec_unit')
                }
                hashrate_table = soup.find('tbody', id='hashrates-tablerows')
                if hashrate_table:
                    for row in hashrate_table.find_all('tr', class_='table-row'):
                        cells = row.find_all('td', class_='table-cell')
                        if len(cells) >= 2:
                            period_text = cells[0].get_text(strip=True).lower()
                            hashrate_str = cells[1].get_text(strip=True).lower()
                            try:
                                parts = hashrate_str.split()
                                hashrate_val = float(parts[0])
                                unit = parts[1] if len(parts) > 1 else 'th/s'
                                for key, (attr, unit_attr) in time_mapping.items():
                                    if key.lower() in period_text:
                                        setattr(data, attr, hashrate_val)
                                        setattr(data, unit_attr, unit)
                                        break
                            except Exception as e:
                                logging.error(f"Error parsing hashrate '{hashrate_str}': {e}")
            except Exception as e:
                logging.error(f"Error parsing hashrate table: {e}")
            
            # Parse lifetime stats data
            try:
                lifetime_snap = soup.find('div', id='lifetimesnap-statcards')
                if lifetime_snap:
                    for container in lifetime_snap.find_all('div', class_='blocks dashboard-container'):
                        label_div = container.find('div', class_='blocks-label')
                        if label_div:
                            label_text = label_div.get_text(strip=True).lower()
                            earnings_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                            if earnings_span:
                                span_text = earnings_span.get_text(strip=True)
                                try:
                                    earnings_value = float(span_text.split()[0].replace(',', ''))
                                    if "earnings" in label_text and "day" in label_text:
                                        data.estimated_earnings_per_day = earnings_value
                                except Exception:
                                    pass
            except Exception as e:
                logging.error(f"Error parsing lifetime stats: {e}")
            
            # Parse payout stats data
            try:
                payout_snap = soup.find('div', id='payoutsnap-statcards')
                if payout_snap:
                    for container in payout_snap.find_all('div', class_='blocks dashboard-container'):
                        label_div = container.find('div', class_='blocks-label')
                        if label_div:
                            label_text = label_div.get_text(strip=True).lower()
                            earnings_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                            if earnings_span:
                                span_text = earnings_span.get_text(strip=True)
                                try:
                                    earnings_value = float(span_text.split()[0].replace(',', ''))
                                    if "earnings" in label_text and "block" in label_text:
                                        data.estimated_earnings_next_block = earnings_value
                                    elif "rewards" in label_text and "window" in label_text:
                                        data.estimated_rewards_in_window = earnings_value
                                except Exception:
                                    pass
            except Exception as e:
                logging.error(f"Error parsing payout stats: {e}")
            
            # Parse user stats data
            try:
                usersnap = soup.find('div', id='usersnap-statcards')
                if usersnap:
                    for container in usersnap.find_all('div', class_='blocks dashboard-container'):
                        label_div = container.find('div', class_='blocks-label')
                        if label_div:
                            label_text = label_div.get_text(strip=True).lower()
                            value_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                            if value_span:
                                span_text = value_span.get_text(strip=True)
                                if "workers currently hashing" in label_text:
                                    try:
                                        data.workers_hashing = int(span_text.replace(",", ""))
                                    except Exception:
                                        pass
                                elif "unpaid earnings" in label_text and "btc" in span_text.lower():
                                    try:
                                        data.unpaid_earnings = float(span_text.split()[0].replace(',', ''))
                                    except Exception:
                                        pass
                                elif "estimated time until minimum payout" in label_text:
                                    data.est_time_to_payout = span_text
            except Exception as e:
                logging.error(f"Error parsing user stats: {e}")
            
            # Parse blocks found data
            try:
                blocks_container = soup.find(lambda tag: tag.name == "div" and "blocks found" in tag.get_text(strip=True).lower())
                if blocks_container:
                    span = blocks_container.find_next_sibling("span")
                    if span:
                        num_match = re.search(r'(\d+)', span.get_text(strip=True))
                        if num_match:
                            data.blocks_found = num_match.group(1)
            except Exception as e:
                logging.error(f"Error parsing blocks found: {e}")
            
            # Parse last share time data
            try:
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
            except Exception as e:
                logging.error(f"Error parsing last share time: {e}")
                
            return data
        except Exception as e:
            logging.error(f"Error fetching Ocean data: {e}")
            return None

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
            rows = table_element.find_all('tr', class_='table-row')
            logging.debug(f"Found {len(rows)} rows in table")
            
            # Dump header row if present
            header_row = table_element.find_parent('table').find('thead')
            if header_row:
                header_cells = header_row.find_all('th')
                header_texts = [cell.get_text(strip=True) for cell in header_cells]
                logging.debug(f"Header: {header_texts}")
            
            # Dump a sample of the data rows
            for i, row in enumerate(rows[:max_rows]):
                cells = row.find_all('td', class_='table-cell')
                cell_texts = [cell.get_text(strip=True) for cell in cells]
                logging.debug(f"Row {i}: {cell_texts}")
                
                # Also look at raw HTML for problematic cells
                for j, cell in enumerate(cells):
                    logging.debug(f"Row {i}, Cell {j} HTML: {cell}")
                    
        except Exception as e:
            logging.error(f"Error dumping table structure: {e}")

    def fetch_url(self, url: str, timeout: int = 5):
        """
        Fetch URL with error handling.
        
        Args:
            url (str): URL to fetch
            timeout (int): Timeout in seconds
            
        Returns:
            Response: Request response or None if failed
        """
        try:
            return self.session.get(url, timeout=timeout)
        except Exception as e:
            logging.error(f"Error fetching {url}: {e}")
            return None

    # Add the fetch_exchange_rates method after the fetch_url method
    def fetch_exchange_rates(self, base_currency="USD"):
        """
        Fetch currency exchange rates from ExchangeRate API using API key.
    
        Args:
            base_currency (str): Base currency for rates (default: USD)
    
        Returns:
            dict: Exchange rates for supported currencies
        """
        now = time.time()
        # Return cached rates if they are still fresh
        if (
            self.exchange_rates_cache["rates"]
            and now - self.exchange_rates_cache["timestamp"] < self.exchange_rate_ttl
        ):
            return self.exchange_rates_cache["rates"]

        # Get the configured currency and API key
        from config import get_currency, get_exchange_rate_api_key
        selected_currency = get_currency()
        api_key = get_exchange_rate_api_key()

        if not api_key:
            logging.error("Exchange rate API key not configured")
            return {}
        
        try:
            # Use the configured API key with the v6 exchangerate-api endpoint
            url = f"https://v6.exchangerate-api.com/v6/{api_key}/latest/{base_currency}"
            response = self.session.get(url, timeout=5)
        
            if response.ok:
                data = response.json()
                if data.get("result") == "success":
                    logging.info(
                        f"Successfully fetched exchange rates for {selected_currency}"
                    )
                    rates = data.get("conversion_rates", {})
                    # Update cache on success
                    self.exchange_rates_cache = {"rates": rates, "timestamp": now}
                    return rates
                else:
                    logging.error(
                        f"Exchange rate API returned unsuccessful result: {data.get('error_type', 'Unknown error')}"
                    )
                    # Clear cache on failure
                    self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
                    return {}
            else:
                logging.error(
                    f"Failed to fetch exchange rates: {response.status_code}"
                )
                # Clear cache on failure
                self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
                return {}
        except Exception as e:
            logging.error(f"Error fetching exchange rates: {e}")
            self.exchange_rates_cache = {"rates": {}, "timestamp": 0.0}
            return {}
          
    def get_payment_history_api(self, days=360, btc_price=None):
        """Fetch payout history using the Ocean.xyz API."""
        api_base = "https://api.ocean.xyz/v1"
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)

        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        url = f"{api_base}/earnpay/{self.wallet}/{start_str}/{end_str}"
        payments = []

        try:
            resp = self.session.get(url, timeout=10)
            if not resp.ok:
                logging.error(f"API earnpay request failed: {resp.status_code}")
                return None

            data = resp.json()
            result_obj = data.get("result", {})
            payouts = result_obj.get("payouts", [])

            for item in payouts:
                ts = item.get("ts")
                txid = item.get("on_chain_txid", "")
                lightning_txid = item.get("lightning_txid", "")
                sats = item.get("total_satoshis_net_paid", 0) or 0
                amount_btc = sats / self.sats_per_btc

                date_iso = None
                date_str = ""
                if ts is not None:
                    try:
                        if isinstance(ts, (int, float)):
                            dt = datetime.fromtimestamp(ts, tz=ZoneInfo("UTC"))
                        else:
                            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                        local_dt = dt.astimezone(ZoneInfo(get_timezone()))
                        date_iso = local_dt.isoformat()
                        date_str = local_dt.strftime("%Y-%m-%d %H:%M")
                    except Exception as e:
                        logging.warning(f"Could not parse payout timestamp '{ts}': {e}")

                payment = {
                    "date": date_str,
                    "txid": txid,
                    "lightning_txid": lightning_txid,
                    "amount_btc": amount_btc,
                    "amount_sats": int(sats),
                    "status": "confirmed",
                    "date_iso": date_iso,
                }

                if btc_price is not None:
                    payment["rate"] = btc_price
                    payment["fiat_value"] = amount_btc * btc_price

                payments.append(payment)

            return payments

        except Exception as e:
            logging.error(f"Error fetching payment history from API: {e}")
            return None

    def get_payment_history_scrape(self, btc_price=None):
        """Scrape payout history from the stats page as a fallback."""
        base_url = "https://ocean.xyz"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache"
        }
        payments = []
        try:
            page = 0
            while True:
                url = f"{base_url}/stats/{self.wallet}?ppage={page}#payouts-fulltable"
                resp = self.session.get(url, headers=headers, timeout=10)
                if not resp.ok:
                    if page == 0:
                        logging.error(f"Error fetching payout page: {resp.status_code}")
                        return None
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                table = (soup.find("tbody", id="payouts-tablerows") or soup.find("tbody", id="payout-tablerows"))
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
                    link = cells[1].find('a')
                    txid = cells[1].get_text(strip=True)
                    lightning_txid = ""
                    if link and link.get('href'):
                        href = link['href']
                        if 'lightning' in href:
                            lightning_txid = href.rstrip('/').split('/')[-1]
                            txid = ""
                        else:
                            txid = href.rstrip('/').split('/')[-1]
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

                page += 1

            return payments
        except Exception as e:
            logging.error(f"Error scraping payment history: {e}")
            return None

    def get_earnings_data(self):
        """
        Get comprehensive earnings data from Ocean.xyz with improved error handling.

        Returns:
            dict: Earnings data including payment history and statistics
        """
        try:
            # Fetch latest BTC price with fallback
            try:
                _, _, btc_price, _ = self.get_bitcoin_stats()
                if not btc_price:
                    btc_price = 85000
            except Exception as e:
                logging.error(f"Error getting BTC price: {e}")
                btc_price = 85000

            # Prefer the official API for payout history
            payments = self.get_payment_history_api(days=360, btc_price=btc_price)
            if not payments:
                logging.info("Falling back to scraping payout history")
                payments = self.get_payment_history_scrape(btc_price=btc_price) or []
    
            # Get basic Ocean data for summary metrics (with timeout handling)
            try:
                ocean_data = self.get_ocean_data()
            except Exception as e:
                logging.error(f"Error fetching ocean data for earnings: {e}")
                ocean_data = None
    
            # Calculate summary statistics
            total_paid = sum(payment["amount_btc"] for payment in payments)
            total_paid_sats = sum(payment["amount_sats"] for payment in payments)
    
            # Calculate USD value
            total_paid_usd = round(total_paid * btc_price, 2)
    
            # Organize payments by month
            payments_by_month = {}
            for payment in payments:
                if payment.get("date_iso"):
                    try:
                        month_key = payment["date_iso"][:7]  # YYYY-MM format
                        month_name = datetime.strptime(month_key, "%Y-%m").strftime("%B %Y")
                
                        if month_key not in payments_by_month:
                            payments_by_month[month_key] = {
                                "month": month_key,
                                "month_name": month_name,
                                "payments": [],
                                "total_btc": 0.0,
                                "total_sats": 0,
                                "total_usd": 0.0
                            }
                        payments_by_month[month_key]["payments"].append(payment)
                        payments_by_month[month_key]["total_btc"] += payment["amount_btc"]
                        payments_by_month[month_key]["total_sats"] += payment["amount_sats"]
                        payments_by_month[month_key]["total_usd"] = round(
                            payments_by_month[month_key]["total_btc"] * btc_price, 2
                        )
                    except Exception as e:
                        logging.error(f"Error processing payment for monthly grouping: {e}")
    
            # Convert to list and sort by month (newest first)
            monthly_summaries = list(payments_by_month.values())
            monthly_summaries.sort(key=lambda x: x["month"], reverse=True)
    
            # Calculate additional statistics
            avg_payment = total_paid / len(payments) if payments else 0
            avg_payment_sats = int(round(avg_payment * self.sats_per_btc)) if avg_payment else 0

            # Calculate average days between payouts using date_iso fields
            avg_days_between_payouts = None
            payout_dates = [
                datetime.fromisoformat(p["date_iso"]) for p in payments
                if p.get("date_iso")
            ]
            payout_dates.sort(reverse=True)
            if len(payout_dates) >= 2:
                deltas = [
                    (payout_dates[i] - payout_dates[i + 1]).total_seconds() / 86400
                    for i in range(len(payout_dates) - 1)
                ]
                if deltas:
                    avg_days_between_payouts = round(sum(deltas) / len(deltas), 2)
    
            # Get unpaid earnings from Ocean data
            unpaid_earnings = ocean_data.unpaid_earnings if ocean_data else None
            unpaid_earnings_sats = int(round(unpaid_earnings * self.sats_per_btc)) if unpaid_earnings is not None else None
    
            # Create result dictionary
            result = {
                "payments": payments,
                "total_payments": len(payments),
                "total_paid_btc": total_paid,
                "total_paid_sats": total_paid_sats,
                "total_paid_usd": total_paid_usd,
                "avg_payment_btc": avg_payment,
                "avg_payment_sats": avg_payment_sats,
                "btc_price": btc_price,
                "monthly_summaries": monthly_summaries,
                "unpaid_earnings": unpaid_earnings,
                "unpaid_earnings_sats": unpaid_earnings_sats,
                "est_time_to_payout": ocean_data.est_time_to_payout if ocean_data else None,
                "avg_days_between_payouts": avg_days_between_payouts,
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat()
            }
            if payments:
                result["last_payment_date"] = payments[0]["date"]
                result["last_payment_amount_btc"] = payments[0]["amount_btc"]
                result["last_payment_amount_sats"] = payments[0]["amount_sats"]

            from config import get_currency
            selected_currency = get_currency()
            result["currency"] = selected_currency
            if selected_currency != "USD":
                exchange_rates = self.fetch_exchange_rates()
                rate = exchange_rates.get(selected_currency, 1.0)
                result["btc_price"] = round(result["btc_price"] * rate, 2)
                result["total_paid_fiat"] = round(total_paid_usd * rate, 2)
                for payment in result["payments"]:
                    if "fiat_value" in payment:
                        payment["fiat_value"] = round(payment["fiat_value"] * rate, 2)
                for month in result["monthly_summaries"]:
                    month["total_fiat"] = round(month["total_usd"] * rate, 2)
                result["exchange_rates"] = exchange_rates
            else:
                result["total_paid_fiat"] = total_paid_usd
                for month in result["monthly_summaries"]:
                    month["total_fiat"] = month["total_usd"]
                result["exchange_rates"] = {}

            return result
    
        except Exception as e:
            logging.error(f"Error fetching earnings data: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return {
                "payments": [],
                "total_payments": 0,
                "avg_days_between_payouts": None,
                "error": str(e),
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat()
            }

    def get_bitcoin_stats(self):
        """
        Fetch Bitcoin network statistics with improved error handling and caching.
        Uses mempool.guide APIs for more accurate network hashrate, block height, and multi-currency price data.

        Returns:
            tuple: (difficulty, network_hashrate, btc_price, block_count)
        """
        # Base URLs for API endpoints
        blockchain_info_urls = {
            "difficulty": "https://blockchain.info/q/getdifficulty",
            "hashrate": "https://blockchain.info/q/hashrate",  # Keep as fallback
            "ticker": "https://blockchain.info/ticker",  # Keep as fallback
            "blockcount": "https://blockchain.info/q/getblockcount"  # Keep as fallback
        }

        # Add mempool.guide APIs
        mempool_urls = {
            "hashrate": "https://mempool.guide/api/v1/mining/hashrate/3d",  # Includes network difficulty
            "prices": "https://mempool.guide/api/v1/prices",
            "block_height": "https://mempool.guide/api/blocks/tip/height"  # New API endpoint for block height
        }

        # Fallback mempool.space APIs (same format as mempool.guide)
        mempool_space_urls = {
            "hashrate": "https://mempool.space/api/v1/mining/hashrate/3d",
            "prices": "https://mempool.space/api/v1/prices",
            "block_height": "https://mempool.space/api/blocks/tip/height"
        }

        # Use previous cached values as defaults if available
        difficulty = self.cache.get("difficulty")
        network_hashrate = self.cache.get("network_hashrate")
        btc_price = self.cache.get("btc_price")
        block_count = self.cache.get("block_count")

        try:
            # Add all API endpoints to futures using the shared executor
            futures = {}

            # Add blockchain.info endpoints
            for key, url in blockchain_info_urls.items():
                futures[key] = self.executor.submit(self.fetch_url, url)

            # Add mempool.guide endpoints
            for key, url in mempool_urls.items():
                futures[f"mempool_{key}"] = self.executor.submit(self.fetch_url, url)

            # Get all responses
            responses = {key: futures[key].result(timeout=5) for key in futures}

            # Fallback to mempool.space if any mempool.guide request failed
            for key, url in mempool_space_urls.items():
                mempool_key = f"mempool_{key}"
                resp = responses.get(mempool_key)
                if not resp or not resp.ok:
                    logging.warning(
                        f"mempool.guide {key} API failed, falling back to mempool.space"
                    )
                    responses[mempool_key] = self.fetch_url(url)

            # Process mempool.guide price data (primary source)
            price_data = {}
            mempool_price_response = responses.get("mempool_prices")
            if mempool_price_response and mempool_price_response.ok:
                try:
                    price_data = mempool_price_response.json()
                    if "USD" in price_data:
                        btc_price = float(price_data.get("USD"))
                        self.cache["btc_price"] = btc_price
                        self.cache["btc_price_USD"] = btc_price
                        logging.info(f"Successfully fetched USD price from mempool.guide: {btc_price}")
                    for curr, value in price_data.items():
                        if curr != "time":
                            self.cache[f"btc_price_{curr}"] = float(value)

                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing mempool.guide price data: {e}")
            else:
                logging.warning(
                    "Could not fetch price data from mempool.guide or mempool.space, falling back to blockchain.info"
                )

            # Fall back to blockchain.info for price if mempool.guide failed or currency not available
            if btc_price is None and responses["ticker"] and responses["ticker"].ok:
                try:
                    ticker_data = responses["ticker"].json()
                    btc_price = float(ticker_data.get("USD", {}).get("last", 0))
                    self.cache["btc_price"] = btc_price
                    self.cache["btc_price_USD"] = btc_price
                    logging.info(f"Using blockchain.info price: {btc_price}")
                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing blockchain.info price: {e}")
            block_height_response = responses.get("mempool_block_height")
            if block_height_response and block_height_response.ok:
                try:
                    # The API returns just the block height as a simple integer value
                    block_count = int(block_height_response.text)
                    self.cache["block_count"] = block_count
                    logging.info(f"Successfully fetched latest block height from mempool.guide: {block_count}")
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing block height from mempool.guide: {e}")
                    # Will fall back to blockchain.info below if this fails
            else:
                logging.warning(
                    "Could not fetch block height from mempool.guide or mempool.space, falling back to blockchain.info"
                )

            # Process mempool.guide hashrate data (primary source)
            mempool_hashrate_response = responses.get("mempool_hashrate")
            if mempool_hashrate_response and mempool_hashrate_response.ok:
                try:
                    hashrate_data = mempool_hashrate_response.json()
                    # Use currentHashrate from the API (already in H/s)
                    network_hashrate = hashrate_data.get("currentHashrate")

                    # Also update difficulty if available in the response
                    if "currentDifficulty" in hashrate_data:
                        difficulty = hashrate_data.get("currentDifficulty")

                    # Cache the updated values
                    self.cache["network_hashrate"] = network_hashrate
                    self.cache["difficulty"] = difficulty

                    logging.info(f"Successfully fetched network hashrate from mempool.guide: {network_hashrate/1e18:.2f} EH/s")
                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing mempool.guide hashrate data: {e}")
            else:
                logging.warning(
                    "Could not fetch hashrate from mempool.guide or mempool.space, falling back to blockchain.info"
                )
    
                # Process blockchain.info hashrate as fallback
            if network_hashrate is None and responses["hashrate"] and responses["hashrate"].ok:
                try:
                    # blockchain.info returns hashrate in GH/s, convert to H/s for consistency
                    network_hashrate = float(responses["hashrate"].text) * 1e9
                    self.cache["network_hashrate"] = network_hashrate
                    logging.info(f"Using blockchain.info network hashrate: {network_hashrate/1e18:.2f} EH/s")
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing network hashrate from blockchain.info: {e}")

            # Handle difficulty (if not already set by mempool.guide)
            if difficulty is None and responses["difficulty"] and responses["difficulty"].ok:
                try:
                    difficulty = float(responses["difficulty"].text)
                    self.cache["difficulty"] = difficulty
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing difficulty: {e}")

            # Handle blockchain.info block count as fallback if mempool.guide failed
            if block_count is None and responses["blockcount"] and responses["blockcount"].ok:
                try:
                    block_count = int(responses["blockcount"].text)
                    self.cache["block_count"] = block_count
                    logging.info(f"Using blockchain.info block height: {block_count}")
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing block count: {e}")
            
        except Exception as e:
            logging.error(f"Error fetching Bitcoin stats: {e}")

        return difficulty, network_hashrate, btc_price, block_count

    def get_all_worker_rows(self):
        """
        Iterate through wpage parameter values to collect all worker table rows.
        Limited to 10 pages to balance between showing enough workers and maintaining performance.

        Returns:
            list: A list of BeautifulSoup row elements containing worker data.
        """
        all_rows = []
        page_num = 0
        max_pages = 10  # Limit to 10 pages of worker data
    
        while page_num < max_pages:  # Only fetch up to max_pages
            url = f"https://ocean.xyz/stats/{self.wallet}?wpage={page_num}#workers-fulltable"
            logging.info(f"Fetching worker data from: {url} (page {page_num+1} of max {max_pages})")
            response = self.session.get(url, timeout=15)
            if not response.ok:
                logging.error(f"Error fetching page {page_num}: status code {response.status_code}")
                break

            soup = BeautifulSoup(response.text, 'html.parser')
            workers_table = soup.find('tbody', id='workers-tablerows')
            if not workers_table:
                logging.debug(f"No workers table found on page {page_num}")
                break

            rows = workers_table.find_all("tr", class_="table-row")
            if not rows:
                logging.debug(f"No worker rows found on page {page_num}, stopping pagination")
                break

            logging.info(f"Found {len(rows)} worker rows on page {page_num}")
            all_rows.extend(rows)
            page_num += 1

        if page_num >= max_pages:
            logging.info(f"Reached maximum page limit ({max_pages}). Collected {len(all_rows)} worker rows total.")
        else:
            logging.info(f"Completed fetching all available worker data. Collected {len(all_rows)} worker rows from {page_num} pages.")

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
        if result and result.get('workers') and len(result['workers']) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result['workers']:
                name = worker.get('name', '').lower()
                if name and name not in ['online', 'offline', 'total', 'worker', 'status']:
                    has_valid_workers = True
                    break
                    
            if has_valid_workers:
                logging.info(f"Alternative worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("Alternative method found workers but with invalid names")
        
        # If alternative method failed or found workers with invalid names, try the original method
        logging.info("Trying original worker data method")
        result = self.get_worker_data_original()
        
        # Check if original method succeeded and found workers with valid names
        if result and result.get('workers') and len(result['workers']) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result['workers']:
                name = worker.get('name', '').lower()
                if name and name not in ['online', 'offline', 'total', 'worker', 'status']:
                    has_valid_workers = True
                    break
                    
            if has_valid_workers:
                logging.info(f"Original worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("Original method found workers but with invalid names")

        # If original method also failed, try fetching from the official API
        logging.info("Trying API worker data method")
        result = self.get_worker_data_api()

        if result and result.get('workers') and len(result['workers']) > 0:
            has_valid_workers = False
            for worker in result['workers']:
                name = worker.get('name', '').lower()
                if name and name not in ['online', 'offline', 'total', 'worker', 'status']:
                    has_valid_workers = True
                    break

            if has_valid_workers:
                logging.info(f"API worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("API method found workers but with invalid names")
                
        # If both methods failed or found workers with invalid names, use fallback data
        logging.warning(
            "Both worker data fetch methods failed to get valid names, using fallback data"
        )

        # Try to get worker count from cached metrics
        workers_count = 0
        if hasattr(self, 'cached_metrics') and self.cached_metrics:
            workers_count = self.cached_metrics.get('workers_hashing', 0)

        # If no cached metrics, try to get from somewhere else
        if workers_count <= 0 and result and result.get('workers_total'):
            workers_count = result.get('workers_total')

        # Ensure we have at least 1 worker
        workers_count = max(1, workers_count)

        logging.info(f"Using fallback data generation with {workers_count} workers")

        if self.worker_service:
            metrics = getattr(self, 'cached_metrics', {}) or {
                'workers_hashing': workers_count,
                'hashrate_3hr': 0,
                'hashrate_3hr_unit': 'TH/s'
            }
            return self.worker_service.generate_fallback_data(metrics)

        # Minimal fallback if no worker_service is available
        return {
            'workers': [],
            'workers_total': workers_count,
            'workers_online': 0,
            'workers_offline': workers_count,
            'total_hashrate': 0.0,
            'hashrate_unit': 'TH/s',
            'total_earnings': 0.0,
            'daily_sats': 0,
            'total_power': 0,
            'hashrate_history': [],
            'timestamp': datetime.now(ZoneInfo(get_timezone())).isoformat()
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
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache'
        }
        
        try:
            logging.info(f"Fetching worker data from {stats_url}")
            response = self.session.get(stats_url, headers=headers, timeout=15)
            if not response.ok:
                logging.error(f"Error fetching ocean worker data: status code {response.status_code}")
                return None
                
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Parse worker data from the workers table
            workers = []
            total_hashrate = 0
            total_earnings = 0
            
            workers_table = soup.find('tbody', id='workers-tablerows')
            if not workers_table:
                logging.error("Workers table not found in Ocean.xyz page")
                return None
                
            # Debug: Dump table structure to help diagnose parsing issues
            self.debug_dump_table(workers_table)
            
            # Find total worker counts
            workers_online = 0
            workers_offline = 0
            
            # Iterate through worker rows in the table
            for row in workers_table.find_all('tr', class_='table-row'):
                cells = row.find_all('td', class_='table-cell')
                
                # Skip rows that don't have enough cells for basic info
                if len(cells) < 3:
                    logging.warning(f"Worker row has too few cells: {len(cells)}")
                    continue
                    
                try:
                    # Extract worker name from the first cell
                    name_cell = cells[0]
                    name_text = name_cell.get_text(strip=True)
                    
                    # Skip the total row
                    if name_text.lower() == 'total':
                        logging.debug("Skipping total row")
                        continue
                    
                    logging.debug(f"Processing worker: {name_text}")
                    
                    # Create worker object with safer extraction
                    worker = {
                        "name": name_text.strip(),
                        "status": "offline",  # Default to offline
                        "type": "ASIC",      # Default type
                        "model": "Unknown",
                        "hashrate_60sec": 0,
                        "hashrate_60sec_unit": "TH/s",
                        "hashrate_3hr": 0,
                        "hashrate_3hr_unit": "TH/s",
                        "efficiency": 90.0,   # Default efficiency
                        "last_share": "N/A",
                        "earnings": 0,
                        "power_consumption": 0,
                        "temperature": 0
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
                                    if len(parts) > 1 and 'btc' not in parts[1].lower():
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
                                    if len(parts) > 1 and 'btc' not in parts[1].lower():
                                        worker["hashrate_3hr_unit"] = parts[1]
                                        
                                    # Add to total hashrate (normalized to TH/s for consistency)
                                    total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
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
                            earnings_value = earnings_text.replace('BTC', '').strip()
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
                        if 'antminer' in lower_name:
                            worker["type"] = 'ASIC'
                            worker["model"] = 'Bitmain Antminer'
                        elif 'whatsminer' in lower_name:
                            worker["type"] = 'ASIC'
                            worker["model"] = 'MicroBT Whatsminer'
                        elif 'bitaxe' in lower_name or 'nerdqaxe' in lower_name:
                            worker["type"] = 'Bitaxe'
                            worker["model"] = 'BitAxe Gamma 601'
                    
                    workers.append(worker)
                    
                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue
                
            # Get daily sats from the ocean data
            daily_sats = 0
            try:
                # Try to get this from the payoutsnap card
                payout_snap = soup.find('div', id='payoutsnap-statcards')
                if payout_snap:
                    for container in payout_snap.find_all('div', class_='blocks dashboard-container'):
                        label_div = container.find('div', class_='blocks-label')
                        if label_div and "earnings per day" in label_div.get_text(strip=True).lower():
                            value_span = label_div.find_next('span')
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
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',  # Always use TH/s for consistent display
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': total_earnings,
                'daily_sats': daily_sats,
                'timestamp': datetime.now(ZoneInfo(get_timezone())).isoformat()
            }
            
            logging.info(f"Successfully retrieved worker data: {len(workers)} workers")
            return result
                
        except Exception as e:
            logging.error(f"Error fetching Ocean worker data: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return None

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
            invalid_names = ['online', 'offline', 'status', 'worker', 'total']

            # Process each row from all pages
            for row_idx, row in enumerate(rows):
                cells = row.find_all(['td', 'th'])
                if not cells or len(cells) < 3:
                    continue

                first_cell_text = cells[0].get_text(strip=True)
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
                        "temperature": 0
                    }
                
                    # Extract status from second cell if available
                    if len(cells) > 1:
                        status_text = cells[1].get_text(strip=True).lower()
                        worker["status"] = "online" if "online" in status_text else "offline"
                        if worker["status"] == "online":
                            workers_online += 1
                        else:
                            workers_offline += 1

                    # Parse last share from third cell if available
                    if len(cells) > 2:
                        worker["last_share"] = cells[2].get_text(strip=True)

                    # Parse 60sec hashrate from fourth cell if available
                    if len(cells) > 3:
                        hashrate_60s_text = cells[3].get_text(strip=True)
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
                        hashrate_3hr_text = cells[4].get_text(strip=True)
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
                    for cell in cells:
                        cell_text = cell.get_text(strip=True)
                        if "btc" in cell_text.lower():
                            try:
                                earnings_match = re.search(r'([\d\.]+)', cell_text)
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
                        if 'antminer' in lower_name:
                            worker["type"] = 'ASIC'
                            worker["model"] = 'Bitmain Antminer'
                        elif 'whatsminer' in lower_name:
                            worker["type"] = 'ASIC'
                            worker["model"] = 'MicroBT Whatsminer'
                        elif 'bitaxe' in lower_name or 'nerdqaxe' in lower_name:
                            worker["type"] = 'Bitaxe'
                            worker["model"] = 'BitAxe Gamma 601'

                    if worker["name"].lower() not in invalid_names:
                        workers.append(worker)

                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue

            if not workers:
                logging.error("No valid worker data parsed")
                return None

            result = {
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': total_earnings,
                'timestamp': datetime.now(ZoneInfo(get_timezone())).isoformat()
            }
            logging.info(f"Successfully retrieved {len(workers)} workers across multiple pages")
            return result

        except Exception as e:
            logging.error(f"Error in alternative worker data fetch: {e}")
            return None

    def get_worker_data_api(self):
        """Fetch worker data using the Ocean.xyz API."""
        api_base = "https://api.ocean.xyz/v1"
        try:
            url = f"{api_base}/user_hashrate_full/{self.wallet}"
            logging.info(f"Fetching worker data from API: {url}")
            resp = self.session.get(url, timeout=10)
            if not resp.ok:
                logging.error(f"API user_hashrate_full request failed: {resp.status_code}")
                return None

            data = resp.json()
            workers_obj = data.get("workers") or data.get("result", {}).get("workers")
            if not workers_obj:
                # Some API responses may store workers inside 'user_hashrate'
                workers_obj = data.get("user_hashrate", {}).get("workers")

            if not workers_obj:
                # If still empty, maybe the response is a list
                if isinstance(data, list):
                    workers_iter = [(w.get("workername") or w.get("name"), w) for w in data]
                else:
                    logging.warning("No worker info returned from API")
                    return None
            else:
                workers_iter = workers_obj.items() if isinstance(workers_obj, dict) else [
                    (w.get("workername") or w.get("name"), w) for w in workers_obj
                ]

            workers = []
            total_hashrate = 0
            workers_online = 0
            workers_offline = 0
            invalid_names = ['online', 'offline', 'status', 'worker', 'total']

            for name, info in workers_iter:
                if not name or name.lower() in invalid_names:
                    continue

                hr3 = info.get("hashrate_10800") or info.get("hashrate_7200") or info.get("hashrate_3600") or info.get("hashrate_300s")
                hr60 = info.get("hashrate_60s") or 0

                status = "online" if (hr60 or hr3) else "offline"

                worker = {
                    "name": name,
                    "status": status,
                    "type": "ASIC",
                    "model": "Unknown",
                    "hashrate_60sec": hr60 or 0,
                    "hashrate_60sec_unit": "H/s",
                    "hashrate_3hr": hr3 or 0,
                    "hashrate_3hr_unit": "H/s",
                    "efficiency": 0,
                    "last_share": "N/A",
                    "earnings": 0,
                    "power_consumption": 0,
                    "temperature": 0,
                }

                if status == "online":
                    workers_online += 1
                else:
                    workers_offline += 1

                specs = parse_worker_name(worker["name"])
                if specs:
                    worker["type"] = specs["type"]
                    worker["model"] = specs["model"]
                    worker["efficiency"] = specs["efficiency"]
                    hr_ths = convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                    worker["power_consumption"] = round(hr_ths * specs["efficiency"])

                total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                workers.append(worker)

            if not workers:
                logging.warning("API worker data returned no valid workers")
                return None

            result = {
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': 0,
                'timestamp': datetime.now(ZoneInfo(get_timezone())).isoformat()
            }

            return result
        except Exception as e:
            logging.error(f"Error in API worker data fetch: {e}")
            return None
