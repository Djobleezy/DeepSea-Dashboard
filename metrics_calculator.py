"""
Metrics calculator module — earnings, profit math, and block reward logic.
"""

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from models import convert_to_ths
from config import get_timezone
from cache_utils import ttl_cache


def parse_payment_date(payment):
    """Return a datetime for a payout entry using available date fields."""
    tz = ZoneInfo(get_timezone())
    dt = None
    if payment.get("date_iso"):
        try:
            dt = datetime.fromisoformat(payment["date_iso"])
        except Exception:
            dt = None
    if dt is None and payment.get("date"):
        try:
            dt = datetime.strptime(payment["date"], "%Y-%m-%d %H:%M")
            dt = dt.replace(tzinfo=tz)
        except Exception:
            dt = None
    return dt


class MetricsCalculatorMixin:
    """Mixin providing earnings/profit math and block reward methods."""

    def estimate_total_power(self, cached_metrics=None):
        """Estimate total power usage from worker data if available."""
        if not self.worker_service:
            return 0

        metrics = cached_metrics if cached_metrics is not None else (self.cached_metrics or {})
        try:
            data = self.worker_service.get_workers_data(metrics, force_refresh=False)
            if data:
                if "total_power" in data and data["total_power"]:
                    return data["total_power"]
                if data.get("workers"):
                    return sum(w.get("power_consumption", 0) for w in data["workers"])
        except Exception as e:
            logging.error(f"Error estimating power usage: {e}")
        return 0

    @ttl_cache(ttl_seconds=3600, maxsize=1)
    def get_block_reward(self):
        """Return the current block subsidy using mempool.guide."""
        try:
            url = "https://mempool.guide/api/blocks/tip/height"
            resp = self.fetch_url(url, timeout=10)
            if resp and resp.ok:
                height = int(resp.text)
                halvings = height // 210000
                reward = 50 / (2 ** halvings)
                return reward
        except Exception as e:
            logging.error(f"Error fetching block reward: {e}")
        # Default to the current known reward
        return 3.125

    @ttl_cache(ttl_seconds=3600, maxsize=1)
    def get_average_fee_per_block(self):
        """Return the average transaction fee per block from mempool.guide."""
        try:
            url = "https://mempool.guide/api/v1/mining/blocks/day"
            resp = self.fetch_url(url, timeout=10)
            if resp and resp.ok:
                data = resp.json()
                if isinstance(data, dict):
                    avg_fee = data.get("avgFee")
                    if avg_fee is not None:
                        return float(avg_fee) / self.sats_per_btc
        except Exception as e:
            logging.error(f"Error fetching average fee: {e}")
        return 0.0

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
                                "total_usd": 0.0,
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

            # Calculate average days between payouts using date_iso or date fields
            avg_days_between_payouts = None
            payout_dates = [parse_payment_date(p) for p in payments]
            payout_dates = [d for d in payout_dates if d is not None]
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
            unpaid_earnings_sats = (
                int(round(unpaid_earnings * self.sats_per_btc)) if unpaid_earnings is not None else None
            )

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
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
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

        except Exception:
            logging.exception("Error fetching earnings data")
            return {
                "payments": [],
                "total_payments": 0,
                "avg_days_between_payouts": None,
                "error": "internal server error",
                "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
            }

    def fetch_metrics(self):
        """
        Fetch metrics from Ocean.xyz and other sources.

        Returns:
            dict: Mining metrics data
        """
        if getattr(self, "_closed", False):
            raise RuntimeError("Cannot use closed service")
        # Add execution time tracking
        start_time = time.time()

        future_ocean = self.executor.submit(self.get_ocean_data)
        future_btc = self.executor.submit(self.get_bitcoin_stats)
        try:
            ocean_data = future_ocean.result(timeout=15)
            btc_stats = future_btc.result(timeout=15)
        except Exception as e:
            logging.error(f"Error fetching metrics concurrently: {e}")
            return None
        finally:
            for fut in (future_ocean, future_btc):
                try:
                    if fut and not fut.done():
                        fut.cancel()
                except Exception:
                    pass

        if ocean_data is None:
            logging.error("Failed to retrieve Ocean data")
            return None

        try:
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
            hr24 = ocean_data.hashrate_24hr or 0
            hr24_unit = (ocean_data.hashrate_24hr_unit or "th/s").lower()
            local_hashrate = convert_to_ths(hr24, hr24_unit) * 1e12  # Convert to H/s for calculation

            hash_proportion = local_hashrate / network_hashrate if network_hashrate else 0

            block_reward = self.get_block_reward()
            avg_fee_per_block = self.get_average_fee_per_block()
            reward_per_block = block_reward + avg_fee_per_block

            if network_hashrate and difficulty:
                seconds_per_block = difficulty * (2 ** 32) / network_hashrate
                blocks_per_day = 86400 / seconds_per_block if seconds_per_block else 144
            else:
                blocks_per_day = 86400 / 600

            daily_btc_gross = hash_proportion * reward_per_block * blocks_per_day

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
            logging.info(
                f"Earnings calculation using pool fee: {pool_fee_percent}% + network fee: {network_fee_percent}%"
            )
            logging.info(
                f"Total fee rate: {total_fee_rate}, Daily BTC gross: {daily_btc_gross}, Daily BTC net: {daily_btc_net}"
            )

            daily_revenue = round(daily_btc_net * btc_price, 2) if btc_price is not None else None

            power_usage_for_calc = self.power_usage
            power_cost_for_calc = self.power_cost
            power_usage_estimated = False

            if power_usage_for_calc is None or power_usage_for_calc <= 0:
                metrics_for_estimate = self.cached_metrics or {}
                if not metrics_for_estimate:
                    metrics_for_estimate = {
                        "workers_hashing": ocean_data.workers_hashing,
                        "hashrate_24hr": ocean_data.hashrate_24hr,
                        "hashrate_24hr_unit": ocean_data.hashrate_24hr_unit,
                    }
                estimated_power = self.estimate_total_power(metrics_for_estimate)
                if estimated_power:
                    power_usage_for_calc = estimated_power
                    # Consider it an estimate only if worker data was simulated
                    if self.worker_service and getattr(self.worker_service, "last_fetch_was_real", False):
                        power_usage_estimated = False
                    else:
                        power_usage_estimated = True
                    if power_cost_for_calc is None or power_cost_for_calc <= 0:
                        power_cost_for_calc = 0.07

            daily_power_cost = round((power_usage_for_calc / 1000) * power_cost_for_calc * 24, 2)
            daily_profit_usd = round(daily_revenue - daily_power_cost, 2) if daily_revenue is not None else None
            monthly_profit_usd = round(daily_profit_usd * 30, 2) if daily_profit_usd is not None else None

            # Calculate break-even electricity price in $/kWh
            daily_energy_kwh = (power_usage_for_calc / 1000) * 24
            break_even_electricity_price = round(daily_revenue / daily_energy_kwh, 4) if daily_energy_kwh > 0 else None

            daily_mined_sats = int(round(daily_btc_net * self.sats_per_btc))
            monthly_mined_sats = daily_mined_sats * 30

            # Use default 0 for earnings if scraping returned None.
            estimated_earnings_per_day = (
                ocean_data.estimated_earnings_per_day if ocean_data.estimated_earnings_per_day is not None else 0
            )
            estimated_earnings_next_block = (
                ocean_data.estimated_earnings_next_block if ocean_data.estimated_earnings_next_block is not None else 0
            )
            estimated_rewards_in_window = (
                ocean_data.estimated_rewards_in_window if ocean_data.estimated_rewards_in_window is not None else 0
            )

            metrics = {
                "pool_total_hashrate": ocean_data.pool_total_hashrate,
                "pool_total_hashrate_unit": ocean_data.pool_total_hashrate_unit,
                "hashrate_24hr": ocean_data.hashrate_24hr,
                "hashrate_24hr_unit": ocean_data.hashrate_24hr_unit,
                "hashrate_3hr": ocean_data.hashrate_3hr,
                "hashrate_3hr_unit": ocean_data.hashrate_3hr_unit,
                "hashrate_10min": ocean_data.hashrate_10min,
                "hashrate_10min_unit": ocean_data.hashrate_10min_unit,
                "hashrate_5min": ocean_data.hashrate_5min,
                "hashrate_5min_unit": ocean_data.hashrate_5min_unit,
                "hashrate_60sec": ocean_data.hashrate_60sec,
                "hashrate_60sec_unit": ocean_data.hashrate_60sec_unit,
                "workers_hashing": ocean_data.workers_hashing,
                "btc_price": btc_price,
                "block_number": block_count,
                "network_hashrate": (network_hashrate / 1e18) if network_hashrate else None,
                "difficulty": difficulty,
                "avg_fee_per_block": avg_fee_per_block,
                "daily_btc_gross": daily_btc_gross,
                "daily_btc_net": daily_btc_net,
                "pool_fee_percent": pool_fee_percent,
                "network_fee_percent": network_fee_percent,
                "total_fee_rate": total_fee_rate,
                "estimated_earnings_per_day": estimated_earnings_per_day,
                "daily_revenue": daily_revenue,
                "daily_power_cost": daily_power_cost,
                "daily_profit_usd": daily_profit_usd,
                "monthly_profit_usd": monthly_profit_usd,
                "break_even_electricity_price": break_even_electricity_price,
                "power_usage_estimated": power_usage_estimated,
                "daily_mined_sats": daily_mined_sats,
                "monthly_mined_sats": monthly_mined_sats,
                "estimated_earnings_next_block": estimated_earnings_next_block,
                "estimated_rewards_in_window": estimated_rewards_in_window,
                "unpaid_earnings": ocean_data.unpaid_earnings,
                "est_time_to_payout": ocean_data.est_time_to_payout,
                "last_block_height": ocean_data.last_block_height,
                "last_block_time": ocean_data.last_block_time,
                "total_last_share": ocean_data.total_last_share,
                "blocks_found": ocean_data.blocks_found or "0",
                "last_block_earnings": ocean_data.last_block_earnings,
                "pool_fees_percentage": ocean_data.pool_fees_percentage,
            }
            # Override pool-wide workers_hashing with actual per-user count from scraper
            if self.worker_service:
                try:
                    wd = self.worker_service.get_workers_data(metrics, force_refresh=False)
                    if wd and "workers" in wd and isinstance(wd["workers"], list):
                        scraped_count = len(wd["workers"])
                        if scraped_count > 0 and scraped_count < metrics.get("workers_hashing", 0):
                            metrics["workers_hashing"] = scraped_count
                except Exception:
                    pass

            metrics["estimated_earnings_per_day_sats"] = int(round(estimated_earnings_per_day * self.sats_per_btc))
            metrics["estimated_earnings_next_block_sats"] = int(
                round(estimated_earnings_next_block * self.sats_per_btc)
            )
            metrics["estimated_rewards_in_window_sats"] = int(round(estimated_rewards_in_window * self.sats_per_btc))

            # --- Add server timestamps to the response in Los Angeles Time ---
            metrics["server_timestamp"] = datetime.now(ZoneInfo(get_timezone())).isoformat()
            metrics["server_start_time"] = self.server_start_time.astimezone(
                ZoneInfo(get_timezone())
            ).isoformat()

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
                    metrics["break_even_electricity_price"] = round(metrics["break_even_electricity_price"] * rate, 4)
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

            self.cached_metrics = metrics
            return metrics

        except Exception as e:
            logging.error(f"Unexpected error in fetch_metrics: {e}")
            return None
