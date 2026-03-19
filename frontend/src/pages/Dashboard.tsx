import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/store';
import { MetricCard } from '../components/MetricCard';
import { HashrateChart } from '../components/HashrateChart';
import { PayoutSummary } from '../components/PayoutSummary';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';
import { Sparkline } from '../components/Sparkline';
import { useBlockAnnotations } from '../hooks/useBlockAnnotations';
import type { DashboardMetrics } from '../types';

// Rolling sparkline history (in-memory)
const MAX_HISTORY = 60;
const hrHistory: number[] = [];
const priceHistory: number[] = [];
const satsHistory: number[] = [];

function addHistory(metrics: DashboardMetrics) {
  hrHistory.push(metrics.hashrate_60sec);
  priceHistory.push(metrics.btc_price);
  satsHistory.push(metrics.daily_mined_sats);
  if (hrHistory.length > MAX_HISTORY) hrHistory.shift();
  if (priceHistory.length > MAX_HISTORY) priceHistory.shift();
  if (satsHistory.length > MAX_HISTORY) satsHistory.shift();
}

function fmtSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return String(sats);
}

function fmtHashrate(ths: number, unit: string): string {
  return `${ths.toFixed(2)} ${unit.toUpperCase()}`;
}

export const Dashboard: React.FC = () => {
  const metrics = useAppStore((s) => s.metrics);
  const prevMetrics = useAppStore((s) => s.prevMetrics);
  const [chartData60s, setChartData60s] = useState<{ label: string; value: number }[]>([]);
  const [chartData3hr, setChartData3hr] = useState<{ label: string; value: number }[]>([]);
  const { annotations: blockAnnotations } = useBlockAnnotations();

  useEffect(() => {
    if (!metrics) return;
    addHistory(metrics);
    const ts = new Date().toLocaleTimeString();
    setChartData60s((prev) => [
      ...prev.slice(-60),
      { label: ts, value: metrics.hashrate_60sec },
    ]);
    setChartData3hr((prev) => [
      ...prev.slice(-60),
      { label: ts, value: metrics.hashrate_3hr },
    ]);
  }, [metrics]);

  if (!metrics) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}
      >
        <span className="glow" style={{ fontFamily: 'var(--font-vt323)', fontSize: '24px' }}>
          LOADING METRICS...▌
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Page title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>MINING DASHBOARD</h1>
        {metrics.low_hashrate_mode && (
          <span
            className="badge badge-warning"
            style={{ fontSize: '12px', padding: '4px 12px' }}
          >
            ⚠ LOW HASHRATE MODE
          </span>
        )}
      </div>

      {/* Hashrate row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MetricCard
          label="60 SEC"
          value={metrics.hashrate_60sec.toFixed(2)}
          unit={metrics.hashrate_60sec_unit}
          current={metrics.hashrate_60sec}
          previous={prevMetrics?.hashrate_60sec}
          large
        >
          <Sparkline data={[...hrHistory]} width={120} height={24} />
        </MetricCard>
        <MetricCard
          label="10 MIN"
          value={metrics.hashrate_10min.toFixed(2)}
          unit={metrics.hashrate_10min_unit}
          current={metrics.hashrate_10min}
          previous={prevMetrics?.hashrate_10min}
          large
        />
        <MetricCard
          label="3 HR AVG"
          value={metrics.hashrate_3hr.toFixed(2)}
          unit={metrics.hashrate_3hr_unit}
          current={metrics.hashrate_3hr}
          previous={prevMetrics?.hashrate_3hr}
          large
        />
        <MetricCard
          label="24 HR AVG"
          value={metrics.hashrate_24hr.toFixed(2)}
          unit={metrics.hashrate_24hr_unit}
          current={metrics.hashrate_24hr}
          previous={prevMetrics?.hashrate_24hr}
          large
        />
      </div>

      {/* Chart */}
      {chartData60s.length > 1 && (
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>HASHRATE HISTORY</div>
          <HashrateChart
            data60s={chartData60s}
            data3hr={chartData3hr}
            avg24hr={metrics.hashrate_24hr}
            blockAnnotations={blockAnnotations}
          />
        </div>
      )}

      {/* Second row: workers, BTC price, unpaid, workers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MetricCard
          label="WORKERS HASHING"
          value={metrics.workers_hashing}
          current={metrics.workers_hashing}
          previous={prevMetrics?.workers_hashing}
          large
        />
        <MetricCard
          label="BTC PRICE"
          value={`$${metrics.btc_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          current={metrics.btc_price}
          previous={prevMetrics?.btc_price}
          large
        >
          <Sparkline data={[...priceHistory]} width={120} height={24} />
        </MetricCard>
        <MetricCard
          label="DAILY MINED"
          value={fmtSats(metrics.daily_mined_sats)}
          unit="SATS"
          current={metrics.daily_mined_sats}
          previous={prevMetrics?.daily_mined_sats}
          large
        >
          <Sparkline data={[...satsHistory]} width={120} height={24} />
        </MetricCard>
        <MetricCard
          label="UNPAID EARNINGS"
          value={`${(metrics.unpaid_earnings * 1e8).toFixed(0)}`}
          unit="SATS"
          large
          subtext={`≈ $${(metrics.unpaid_earnings * metrics.btc_price).toFixed(2)}`}
        />
      </div>

      {/* Bitcoin progress bar + payout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>BITCOIN BLOCK TIMER</div>
          <BitcoinProgressBar lastBlockTime={metrics.last_block_time} />
          <div className="flex gap-2 mt-2">
            <div>
              <div className="label">LAST BLOCK</div>
              <div className="value-sm glow">#{metrics.last_block_height.toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{metrics.last_block_time}</div>
            </div>
            <div>
              <div className="label">BLOCKS FOUND</div>
              <div className="value-sm glow">{metrics.blocks_found}</div>
            </div>
          </div>
        </div>
        <PayoutSummary metrics={metrics} />
      </div>

      {/* Network stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MetricCard
          label="NETWORK HASHRATE"
          value={metrics.network_hashrate.toFixed(2)}
          unit={metrics.network_hashrate_unit}
        />
        <MetricCard
          label="DIFFICULTY"
          value={(metrics.difficulty / 1e12).toFixed(2)}
          unit="T"
        />
        <MetricCard
          label="POOL HASHRATE"
          value={metrics.pool_total_hashrate.toFixed(2)}
          unit={metrics.pool_total_hashrate_unit}
        />
        <MetricCard
          label="POOL FEES"
          value={`${metrics.pool_fees_percentage.toFixed(2)}%`}
        />
      </div>

      {/* Profitability row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MetricCard
          label="DAILY REVENUE"
          value={`$${metrics.daily_revenue.toFixed(2)}`}
          current={metrics.daily_revenue}
          previous={prevMetrics?.daily_revenue}
        />
        <MetricCard
          label="POWER COST/DAY"
          value={`$${metrics.daily_power_cost.toFixed(2)}`}
        />
        <MetricCard
          label="DAILY PROFIT"
          value={`${metrics.daily_profit_usd >= 0 ? '+' : ''}$${metrics.daily_profit_usd.toFixed(2)}`}
          current={metrics.daily_profit_usd}
          previous={prevMetrics?.daily_profit_usd}
        />
        <MetricCard
          label="MONTHLY PROFIT"
          value={`${metrics.monthly_profit_usd >= 0 ? '+' : ''}$${metrics.monthly_profit_usd.toFixed(0)}`}
        />
      </div>
    </div>
  );
};
