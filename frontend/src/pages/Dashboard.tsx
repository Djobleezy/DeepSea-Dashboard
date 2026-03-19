import React, { Suspense, lazy, useEffect } from 'react';
import { useAppStore } from '../stores/store';
import { MetricCard } from '../components/MetricCard';
import { PayoutSummary } from '../components/PayoutSummary';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';
import { Sparkline } from '../components/Sparkline';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useBlockAnnotations } from '../hooks/useBlockAnnotations';
import { fmtHashrate, fmtSats, autoScaleHashrate } from '../utils/format';
import type { DashboardMetrics } from '../types';

// Rolling sparkline history (in-memory, survives re-renders but not full reload)
const HashrateChart = lazy(() =>
  import('../components/HashrateChart').then((module) => ({ default: module.HashrateChart })),
);

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

// DATUM Gateway: pool_fees between 0.9% and 1.3% = connected via DATUM protocol
function isDatumConnected(poolFeesPct: number): boolean {
  return poolFeesPct >= 0.9 && poolFeesPct <= 1.3;
}

export const Dashboard: React.FC = () => {
  const metrics = useAppStore((s) => s.metrics);
  const prevMetrics = useAppStore((s) => s.prevMetrics);
  const chartData60s = useAppStore((s) => s.chartData60s);
  const chartData3hr = useAppStore((s) => s.chartData3hr);
  const addChartPoint = useAppStore((s) => s.addChartPoint);
  const { annotations: blockAnnotations } = useBlockAnnotations();

  useEffect(() => {
    if (!metrics) return;
    addHistory(metrics);
    addChartPoint(metrics.hashrate_60sec, metrics.hashrate_3hr);
  }, [metrics, addChartPoint]);

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

  const datumActive = isDatumConnected(metrics.pool_fees_percentage);
  const hr60 = autoScaleHashrate(metrics.hashrate_60sec, metrics.hashrate_60sec_unit);
  const hr10 = autoScaleHashrate(metrics.hashrate_10min, metrics.hashrate_10min_unit);
  const hr3 = autoScaleHashrate(metrics.hashrate_3hr, metrics.hashrate_3hr_unit);
  const hr24 = autoScaleHashrate(metrics.hashrate_24hr, metrics.hashrate_24hr_unit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Page title + status badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>MINING DASHBOARD</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* DATUM Gateway badge */}
          <span
            className={`badge ${datumActive ? 'badge-online' : 'badge-offline'}`}
            style={{ fontSize: '12px', padding: '4px 12px' }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: datumActive ? 'var(--color-success)' : 'var(--color-error)',
                display: 'inline-block',
                boxShadow: datumActive ? '0 0 6px var(--color-success)' : 'none',
                animation: datumActive ? 'pulse-glow 2s infinite' : 'none',
                marginRight: '6px',
              }}
            />
            DATUM {datumActive ? 'CONNECTED' : 'OFFLINE'}
          </span>
          {metrics.low_hashrate_mode && (
            <span
              className="badge badge-warning"
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              ⚠ LOW HASHRATE
            </span>
          )}
        </div>
      </div>

      {/* Hashrate row — auto-scaled */}
      <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.05s both' }}>
        <MetricCard
          label="60 SEC"
          value={hr60.display}
          unit={hr60.unit}
          current={metrics.hashrate_60sec}
          previous={prevMetrics?.hashrate_60sec}
          large
        >
          <Sparkline data={[...hrHistory]} width={120} height={24} />
        </MetricCard>
        <MetricCard
          label="10 MIN"
          value={hr10.display}
          unit={hr10.unit}
          current={metrics.hashrate_10min}
          previous={prevMetrics?.hashrate_10min}
          large
        />
        <MetricCard
          label="3 HR AVG"
          value={hr3.display}
          unit={hr3.unit}
          current={metrics.hashrate_3hr}
          previous={prevMetrics?.hashrate_3hr}
          large
        />
        <MetricCard
          label="24 HR AVG"
          value={hr24.display}
          unit={hr24.unit}
          current={metrics.hashrate_24hr}
          previous={prevMetrics?.hashrate_24hr}
          large
        />
      </div>

      {/* Chart — data from Zustand store, persists across route changes */}
      {chartData60s.length > 1 && (
        <div className="card" style={{ animation: 'stagger-in-scale 0.5s ease-out 0.15s both' }}>
          <div className="label" style={{ marginBottom: '12px' }}>HASHRATE HISTORY</div>
          <ErrorBoundary>
            <Suspense
              fallback={
                <div
                  className="text-center"
                  style={{ padding: '32px', color: 'var(--text-dim)', fontSize: '13px' }}
                >
                  LOADING CHART...
                </div>
              }
            >
              <HashrateChart
                data60s={chartData60s}
                data3hr={chartData3hr}
                avg24hr={metrics.hashrate_24hr}
                blockAnnotations={blockAnnotations}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Second row: workers, BTC price, daily sats, unpaid */}
      <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.25s both' }}>
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
      <div className="grid-2" style={{ animation: 'stagger-in 0.4s ease-out 0.35s both' }}>
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>BITCOIN BLOCK TIMER</div>
          <BitcoinProgressBar lastBlockTime={metrics.last_block_time} />
          <div className="flex gap-2 mt-2">
            <div>
              <div className="label">LAST BLOCK</div>
              <div className="value-sm glow">#{metrics.last_block_height.toLocaleString()}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-dim)' }}>{metrics.last_block_time}</div>
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
      <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.45s both' }}>
        <MetricCard
          label="NETWORK HASHRATE"
          value={fmtHashrate(metrics.network_hashrate, metrics.network_hashrate_unit)}
        />
        <MetricCard
          label="DIFFICULTY"
          value={(metrics.difficulty / 1e12).toFixed(2)}
          unit="T"
        />
        <MetricCard
          label="POOL HASHRATE"
          value={fmtHashrate(metrics.pool_total_hashrate, metrics.pool_total_hashrate_unit)}
        />
        <MetricCard
          label="POOL FEES"
          value={`${metrics.pool_fees_percentage.toFixed(2)}%`}
        />
      </div>

      {/* Profitability row */}
      <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.55s both' }}>
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
