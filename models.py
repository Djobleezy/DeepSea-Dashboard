"""
Data models for the Bitcoin Mining Dashboard.
"""

from dataclasses import dataclass
from typing import Dict, Any
from functools import lru_cache
import logging
import re


@dataclass
class OceanData:
    """Data structure for Ocean.xyz pool mining data."""

    # Keep original definitions with None default to maintain backward compatibility
    pool_total_hashrate: float = None
    pool_total_hashrate_unit: str = None
    hashrate_24hr: float = None
    hashrate_24hr_unit: str = None
    hashrate_3hr: float = None
    hashrate_3hr_unit: str = None
    hashrate_10min: float = None
    hashrate_10min_unit: str = None
    hashrate_5min: float = None
    hashrate_5min_unit: str = None
    hashrate_60sec: float = None
    hashrate_60sec_unit: str = None
    estimated_earnings_per_day: float = None
    estimated_earnings_next_block: float = None
    estimated_rewards_in_window: float = None
    workers_hashing: int = None
    unpaid_earnings: float = None
    est_time_to_payout: str = None
    last_block: str = None
    last_block_height: str = None
    last_block_time: str = None
    blocks_found: str = None
    total_last_share: str = "N/A"
    last_block_earnings: str = None
    pool_fees_percentage: float = None  # Added missing attribute

    def get_normalized_hashrate(self, timeframe: str = "3hr") -> float:
        """
        Get a normalized hashrate value in TH/s regardless of original units.

        Args:
            timeframe: The timeframe to get ("24hr", "3hr", "10min", "5min", "60sec")

        Returns:
            float: Normalized hashrate in TH/s
        """
        if timeframe == "24hr" and self.hashrate_24hr is not None:
            return convert_to_ths(self.hashrate_24hr, self.hashrate_24hr_unit)
        elif timeframe == "3hr" and self.hashrate_3hr is not None:
            return convert_to_ths(self.hashrate_3hr, self.hashrate_3hr_unit)
        elif timeframe == "10min" and self.hashrate_10min is not None:
            return convert_to_ths(self.hashrate_10min, self.hashrate_10min_unit)
        elif timeframe == "5min" and self.hashrate_5min is not None:
            return convert_to_ths(self.hashrate_5min, self.hashrate_5min_unit)
        elif timeframe == "60sec" and self.hashrate_60sec is not None:
            return convert_to_ths(self.hashrate_60sec, self.hashrate_60sec_unit)
        return 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert the OceanData object to a dictionary."""
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OceanData":
        """Create an OceanData instance from a dictionary."""
        filtered_data = {}
        for k, v in data.items():
            if k in cls.__annotations__:
                filtered_data[k] = v
        return cls(**filtered_data)


@dataclass
class WorkerData:
    """Data structure for individual worker information."""

    name: str = None
    status: str = "offline"
    type: str = "ASIC"  # ASIC or Bitaxe
    model: str = "Unknown"
    hashrate_60sec: float = 0
    hashrate_60sec_unit: str = "TH/s"
    hashrate_3hr: float = 0
    hashrate_3hr_unit: str = "TH/s"
    efficiency: float = 0
    last_share: str = "N/A"
    earnings: float = 0
    acceptance_rate: float = 0
    power_consumption: float = 0
    temperature: float = 0

    def __post_init__(self):
        """
        Validate worker data after initialization.
        Ensures values are within acceptable ranges and formats.
        """
        # Ensure hashrates are non-negative
        if self.hashrate_60sec is not None and self.hashrate_60sec < 0:
            self.hashrate_60sec = 0

        if self.hashrate_3hr is not None and self.hashrate_3hr < 0:
            self.hashrate_3hr = 0

        # Ensure status is valid, but don't raise exceptions for backward compatibility
        if self.status not in ["online", "offline"]:
            logging.warning(f"Worker {self.name}: Invalid status '{self.status}', using 'offline'")
            self.status = "offline"

        # Ensure type is valid, but don't raise exceptions for backward compatibility
        if self.type not in ["ASIC", "Bitaxe"]:
            logging.warning(f"Worker {self.name}: Invalid type '{self.type}', using 'ASIC'")
            self.type = "ASIC"

    def get_normalized_hashrate(self, timeframe: str = "3hr") -> float:
        """
        Get normalized hashrate in TH/s.

        Args:
            timeframe: The timeframe to get ("3hr" or "60sec")

        Returns:
            float: Normalized hashrate in TH/s
        """
        if timeframe == "3hr":
            return convert_to_ths(self.hashrate_3hr, self.hashrate_3hr_unit)
        elif timeframe == "60sec":
            return convert_to_ths(self.hashrate_60sec, self.hashrate_60sec_unit)
        return 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert the WorkerData object to a dictionary."""
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkerData":
        """Create a WorkerData instance from a dictionary."""
        filtered_data = {}
        for k, v in data.items():
            if k in cls.__annotations__:
                filtered_data[k] = v
        return cls(**filtered_data)


class HashRateConversionError(Exception):
    """Exception raised for errors in hashrate unit conversion."""

    pass


@lru_cache(maxsize=128)
def convert_to_ths(value, unit):
    """
    Convert any hashrate unit to TH/s equivalent.

    Args:
        value (float): The numerical value of the hashrate
        unit (str): The unit of measurement (e.g., 'PH/s', 'EH/s', etc.)

    Returns:
        float: The hashrate value in TH/s
    """
    if value is None:
        return 0

    try:
        if isinstance(value, str):
            cleaned = value.replace(",", "").strip()
            match = re.match(r"[-+]?\d*\.?\d+", cleaned)
            value = float(match.group(0)) if match else 0
        value = float(value)
        if value <= 0:
            return 0

        unit = unit.lower() if unit else "th/s"

        if "ph/s" in unit:
            return value * 1000  # 1 PH/s = 1000 TH/s
        elif "eh/s" in unit:
            return value * 1000000  # 1 EH/s = 1,000,000 TH/s
        elif "gh/s" in unit:
            return value / 1000  # 1 TH/s = 1000 GH/s
        elif "mh/s" in unit:
            return value / 1000000  # 1 TH/s = 1,000,000 MH/s
        elif "kh/s" in unit:
            return value / 1000000000  # 1 TH/s = 1,000,000,000 KH/s
        elif "h/s" in unit and not any(prefix in unit for prefix in ["th/s", "ph/s", "eh/s", "gh/s", "mh/s", "kh/s"]):
            return value / 1000000000000  # 1 TH/s = 1,000,000,000,000 H/s
        elif "th/s" in unit:
            return value
        else:
            # Log unexpected unit
            logging.warning(f"Unexpected hashrate unit: {unit}, defaulting to treating as TH/s")
            return value
    except Exception as e:
        logging.error(f"Error in convert_to_ths: {e}")
        return value  # Return original value as fallback
