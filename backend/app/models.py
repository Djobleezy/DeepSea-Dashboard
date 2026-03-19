"""Pydantic v2 data models for the DeepSea Dashboard API.

All models use Pydantic v2 syntax.  Key design decisions:

- **Defensive defaults**: every field has a safe default so partially-populated
  dicts can be unpacked into models without raising validation errors.
- **Strict numeric bounds**: ``AppConfig`` / ``ConfigUpdate`` fields carry ``Field``
  constraints (``ge``/``le``) that match the validation rules enforced at the API
  layer.
- **Hashrate units**: hashrate values are stored as raw floats alongside a
  companion ``*_unit`` string (e.g. ``hashrate_3hr`` + ``hashrate_3hr_unit``).
  Use :func:`convert_to_ths` and :func:`format_hashrate` for unit arithmetic.

Model groups:

- :class:`DashboardMetrics` — aggregated mining snapshot served by ``/api/metrics``
- :class:`Worker` / :class:`WorkerSummary` — per-worker data and fleet summary
- :class:`Block` / :class:`BlocksResponse` — Bitcoin block data
- :class:`Payment` / :class:`EarningsResponse` — payout history
- :class:`Notification` / :class:`NotificationCreate` — in-app event log
- :class:`AppConfig` / :class:`ConfigUpdate` — user configuration
- :class:`HealthStatus` — ``/api/health`` response
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Dashboard Metrics
# ---------------------------------------------------------------------------

class DashboardMetrics(BaseModel):
    """Complete mining metrics snapshot served by ``GET /api/metrics``.

    Aggregated from the Ocean REST API (hashrates, earnings, pool stats) and
    Bitcoin network sources (BTC price, network hashrate, difficulty).  All
    hashrate fields are normalised to TH/s; financial fields are in USD.
    """

    hashrate_60sec: float = 0.0
    hashrate_60sec_unit: str = "TH/s"
    hashrate_10min: float = 0.0
    hashrate_10min_unit: str = "TH/s"
    hashrate_3hr: float = 0.0
    hashrate_3hr_unit: str = "TH/s"
    hashrate_24hr: float = 0.0
    hashrate_24hr_unit: str = "TH/s"
    workers_hashing: int = 0
    btc_price: float = 0.0
    daily_mined_sats: int = 0
    monthly_mined_sats: int = 0
    daily_revenue: float = 0.0
    daily_power_cost: float = 0.0
    daily_profit_usd: float = 0.0
    monthly_profit_usd: float = 0.0
    unpaid_earnings: float = 0.0
    est_time_to_payout: str = "N/A"
    last_block_height: int = 0
    last_block_time: str = "N/A"
    network_hashrate: float = 0.0
    network_hashrate_unit: str = "EH/s"
    difficulty: float = 0.0
    pool_total_hashrate: float = 0.0
    pool_total_hashrate_unit: str = "PH/s"
    pool_fees_percentage: float = 0.0
    blocks_found: int = 0
    server_timestamp: float = Field(default_factory=time.time)

    # Extended fields
    estimated_earnings_per_day: float = 0.0
    estimated_earnings_next_block: float = 0.0
    estimated_rewards_in_window: float = 0.0
    total_last_share: str = "N/A"
    low_hashrate_mode: bool = False


# ---------------------------------------------------------------------------
# Worker Models
# ---------------------------------------------------------------------------

class WorkerStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"


class Worker(BaseModel):
    """A single mining worker (ASIC or BitAxe) with enriched metadata.

    Raw data from the Ocean API is enriched by
    :mod:`app.services.worker_service` to add ASIC model detection,
    efficiency (J/TH), and estimated power consumption.
    """

    name: str
    status: WorkerStatus = WorkerStatus.OFFLINE
    type: str = "ASIC"
    model: str = "Unknown"
    hashrate_60sec: float = 0.0
    hashrate_60sec_unit: str = "TH/s"
    hashrate_3hr: float = 0.0
    hashrate_3hr_unit: str = "TH/s"
    efficiency: float = 0.0
    last_share: str = "N/A"
    earnings: float = 0.0
    power_consumption: float = 0.0
    acceptance_rate: float = 100.0


class WorkerSummary(BaseModel):
    """Fleet-level worker summary returned by ``GET /api/workers``."""

    workers: list[Worker] = Field(default_factory=list)
    total_hashrate: float = 0.0
    hashrate_unit: str = "TH/s"
    workers_total: int = 0
    workers_online: int = 0
    workers_offline: int = 0
    total_earnings: float = 0.0
    timestamp: str = ""


# ---------------------------------------------------------------------------
# Block Models
# ---------------------------------------------------------------------------

class Block(BaseModel):
    """A single Bitcoin block with pool-attribution and miner earnings data."""

    height: int = 0
    hash: str = ""
    timestamp: str = ""
    time_ago: str = ""
    tx_count: int = 0
    fees_btc: float = 0.0
    reward_btc: float = 0.0
    pool: str = "Ocean.xyz"
    miner_earnings_sats: int = 0
    pool_fees_percentage: float = 0.0


class BlocksResponse(BaseModel):
    blocks: list[Block] = Field(default_factory=list)
    page: int = 0
    page_size: int = 20
    total: int = 0


# ---------------------------------------------------------------------------
# Earnings / Payout Models
# ---------------------------------------------------------------------------

class Payment(BaseModel):
    date: str = ""
    date_iso: Optional[str] = None
    txid: str = ""
    lightning_txid: str = ""
    amount_btc: float = 0.0
    amount_sats: int = 0
    fiat_value: Optional[float] = None
    rate: Optional[float] = None
    status: str = "confirmed"


class EarningsResponse(BaseModel):
    payments: list[Payment] = Field(default_factory=list)
    total_btc: float = 0.0
    total_sats: int = 0
    monthly_summary: list[dict] = Field(default_factory=list)
    currency: str = "USD"


# ---------------------------------------------------------------------------
# Notification Models
# ---------------------------------------------------------------------------

class NotificationLevel(str, Enum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class NotificationCategory(str, Enum):
    HASHRATE = "hashrate"
    BLOCK = "block"
    WORKER = "worker"
    EARNINGS = "earnings"
    SYSTEM = "system"


class Notification(BaseModel):
    id: str = ""
    message: str = ""
    category: NotificationCategory = NotificationCategory.SYSTEM
    level: NotificationLevel = NotificationLevel.INFO
    timestamp: str = ""
    read: bool = False
    is_block: bool = False
    metadata: dict = Field(default_factory=dict)


class NotificationCreate(BaseModel):
    message: str
    category: NotificationCategory = NotificationCategory.SYSTEM
    level: NotificationLevel = NotificationLevel.INFO
    is_block: bool = False
    metadata: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Config Models
# ---------------------------------------------------------------------------

class AppConfig(BaseModel):
    """Full application configuration model (``GET /api/config`` response).

    Reflects the persisted ``config.json`` values with validated types and
    bounds.  See ``CONFIG.md`` in the repository root for field descriptions.
    """

    wallet: str = ""
    power_cost: float = Field(default=0.12, ge=0, le=10)
    power_usage: float = Field(default=3450.0, ge=0, le=100000)
    currency: str = Field(default="USD", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    timezone: str = "America/Los_Angeles"
    network_fee: float = Field(default=0.5, ge=0, le=100)
    extended_history: bool = False

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return str(value).upper()


class ConfigUpdate(BaseModel):
    """Partial configuration update payload for ``POST /api/config``.

    All fields are optional — only supplied fields are written to
    ``config.json``.  Validation constraints mirror :class:`AppConfig`.
    """

    wallet: Optional[str] = None
    power_cost: Optional[float] = Field(default=None, ge=0, le=10)
    power_usage: Optional[float] = Field(default=None, ge=0, le=100000)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    timezone: Optional[str] = None
    network_fee: Optional[float] = Field(default=None, ge=0, le=100)
    extended_history: Optional[bool] = None

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value).upper()


# ---------------------------------------------------------------------------
# Health Model
# ---------------------------------------------------------------------------

class HealthStatus(BaseModel):
    """Response model for ``GET /api/health``.

    Includes service-level liveness indicators for the Redis cache and the
    Ocean API data refresh loop.
    """

    status: str = "ok"
    version: str = "2.0.0"
    wallet_configured: bool = False
    redis_connected: bool = False
    last_refresh: Optional[float] = None
    uptime_seconds: float = 0.0


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def convert_to_ths(value: float, unit: str) -> float:
    """Convert any hashrate unit to TH/s."""
    if value is None:
        return 0.0
    unit_lower = unit.lower().replace("/s", "").replace(" ", "")
    multipliers = {
        "h": 1e-12,
        "kh": 1e-9,
        "mh": 1e-6,
        "gh": 1e-3,
        "th": 1.0,
        "ph": 1e3,
        "eh": 1e6,
        "zh": 1e9,
    }
    return float(value) * multipliers.get(unit_lower, 1.0)


def format_hashrate(ths: float) -> tuple[float, str]:
    """Auto-scale a TH/s value to the most readable unit."""
    if ths >= 1e6:
        return round(ths / 1e6, 2), "EH/s"
    if ths >= 1e3:
        return round(ths / 1e3, 2), "PH/s"
    if ths >= 1:
        return round(ths, 2), "TH/s"
    if ths >= 1e-3:
        return round(ths * 1e3, 2), "GH/s"
    return round(ths * 1e6, 2), "MH/s"
