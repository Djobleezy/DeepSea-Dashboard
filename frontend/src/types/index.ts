// DeepSea Dashboard — TypeScript Types

export interface DashboardMetrics {
  hashrate_60sec: number;
  hashrate_60sec_unit: string;
  hashrate_10min: number;
  hashrate_10min_unit: string;
  hashrate_3hr: number;
  hashrate_3hr_unit: string;
  hashrate_24hr: number;
  hashrate_24hr_unit: string;
  workers_hashing: number;
  btc_price: number;
  daily_mined_sats: number;
  monthly_mined_sats: number;
  daily_revenue: number;
  daily_power_cost: number;
  daily_profit_usd: number;
  monthly_profit_usd: number;
  unpaid_earnings: number;
  est_time_to_payout: string;
  last_block_height: number;
  last_block_time: string;
  network_hashrate: number;
  network_hashrate_unit: string;
  difficulty: number;
  pool_total_hashrate: number;
  pool_total_hashrate_unit: string;
  pool_fees_percentage: number;
  blocks_found: number;
  server_timestamp: number;
  // Extended
  estimated_earnings_per_day?: number;
  estimated_earnings_next_block?: number;
  estimated_rewards_in_window?: number;
  total_last_share?: string;
  low_hashrate_mode?: boolean;
}

export type WorkerStatus = 'online' | 'offline';

export interface Worker {
  name: string;
  status: WorkerStatus;
  type: string;
  model: string;
  hashrate_60sec: number;
  hashrate_60sec_unit: string;
  hashrate_3hr: number;
  hashrate_3hr_unit: string;
  efficiency: number;
  last_share: string;
  earnings: number;
  power_consumption: number;
  acceptance_rate: number;
}

export interface WorkerSummary {
  workers: Worker[];
  total_hashrate: number;
  hashrate_unit: string;
  workers_total: number;
  workers_online: number;
  workers_offline: number;
  total_earnings: number;
  timestamp: string;
}

export interface Block {
  height: number;
  hash: string;
  timestamp: string;
  time_ago: string;
  tx_count: number;
  fees_btc: number;
  reward_btc: number;
  pool: string;
  miner_earnings_sats: number;
  pool_fees_percentage: number;
}

export interface BlocksResponse {
  blocks: Block[];
  page: number;
  page_size: number;
  total: number;
}

export interface Payment {
  date: string;
  date_iso?: string;
  txid: string;
  lightning_txid: string;
  amount_btc: number;
  amount_sats: number;
  fiat_value?: number;
  rate?: number;
  status: string;
}

export interface MonthlySummary {
  month: string;
  sats: number;
  btc: number;
  fiat: number;
  count: number;
}

export interface EarningsResponse {
  payments: Payment[];
  total_btc: number;
  total_sats: number;
  monthly_summary: MonthlySummary[];
  currency: string;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
export type NotificationCategory =
  | 'hashrate'
  | 'block'
  | 'worker'
  | 'earnings'
  | 'system';

export interface Notification {
  id: string;
  message: string;
  category: NotificationCategory;
  level: NotificationLevel;
  timestamp: string;
  read: boolean;
  is_block: boolean;
  metadata: Record<string, unknown>;
}

export interface AppConfig {
  wallet: string;
  power_cost: number;
  power_usage: number;
  currency: string;
  timezone: string;
  network_fee: number;
  extended_history: boolean;
}

export type Theme = 'deepsea' | 'bitcoin' | 'matrix';

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface HealthStatus {
  status: string;
  version: string;
  wallet_configured: boolean;
  redis_connected: boolean;
  last_refresh?: number;
  uptime_seconds: number;
  server_timestamp?: number;
}
