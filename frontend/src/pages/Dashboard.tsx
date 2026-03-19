import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { fetchMetricHistory } from '../api/client';
import { useAppStore } from '../stores/store';
import { MetricCard } from '../components/MetricCard';
import { PayoutSummary } from '../components/PayoutSummary';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useBlockAnnotations } from '../hooks/useBlockAnnotations';
import { useCurrency } from '../hooks/useCurrency';
import { fmtHashrate, fmtSats, autoScaleHashrate } from '../utils/format';
import { LiveBlockTimer } from '../components/LiveBlockTimer';
import { HashrateNotices } from '../components/HashrateNotices';

const HashrateChart = lazy(() =>
  import('../components/HashrateChart').then((module) => ({ default: module.HashrateChart })),
);

// DATUM Gateway: pool_fees between 0.9% and 1.3% = connected via DATUM protocol
function isDatumConnected(poolFeesPct: number): boolean {
  return poolFeesPct >= 0.9 && poolFeesPct <= 1.3;
}

export const Dashboard: React.FC = () => {
  const { formatFiat, formatFiatSigned } = useCurrency();
  const metrics = useAppStore((s) => s.metrics);
  const prevMetrics = useAppStore((s) => s.prevMetrics);
  const chartData60s = useAppStore((s) => s.chartData60s);
  const chartData3hr = useAppStore((s) => s.chartData3hr);
  const addChartPoint = useAppStore((s) => s.addChartPoint);
  const chartHydrated = useAppStore((s) => s.chartHydrated);
  const hydrateChart = useAppStore((s) => s.hydrateChart);
  const { annotations: blockAnnotations } = useBlockAnnotations();
  const hydrationAttempted = useRef(false);

  // Hydrate chart from server history on first load
  useEffect(() => {
    if (hydrationAttempted.current || chartHydrated) return;
    hydrationAttempted.current = true;

    fetchMetricHistory(1)
      .then((points) => {
        hydrateChart(Array.isArray(points) ? points : []);
      })
      .catch(() => {});
  }, [chartHydrated, hydrateChart]);

  useEffect(() => {
    if (!metrics) return;
    // Skip chart points when hashrate is zero — likely a transient API failure,
    // not a real drop.  Avoids visual dips to 0 on the chart.
    if (metrics.hashrate_60sec > 0 || metrics.hashrate_3hr > 0) {
      addChartPoint(metrics.hashrate_60sec, metrics.hashrate_3hr);
    }
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
              title="Low hashrate device detected — chart uses 3hr average as primary, 60sec shown as secondary"
            >
              ⚠ LOW HASHRATE MODE
            </span>
          )}
        </div>
      </div>

      {/* Hashrate row — auto-scaled.  In low hashrate mode the 60-sec
          reading is unreliable (BitAxe / small miners submit shares
          infrequently), so we visually de-emphasise it and highlight
          the 3hr average instead. */}
      <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.05s both' }}>
        <MetricCard
          label={metrics.low_hashrate_mode ? '60 SEC ⚡' : '60 SEC'}
          value={hr60.display}
          unit={hr60.unit}
          current={metrics.hashrate_60sec}
          previous={prevMetrics?.hashrate_60sec}
          metricKey="hashrate_60sec"
          large={!metrics.low_hashrate_mode}
        />
        <MetricCard
          label="10 MIN"
          value={hr10.display}
          unit={hr10.unit}
          current={metrics.hashrate_10min}
          previous={prevMetrics?.hashrate_10min}
          metricKey="hashrate_10min"
          large
        />
        <MetricCard
          label={metrics.low_hashrate_mode ? '⭐ 3 HR AVG' : '3 HR AVG'}
          value={hr3.display}
          unit={hr3.unit}
          current={metrics.hashrate_3hr}
          previous={prevMetrics?.hashrate_3hr}
          metricKey="hashrate_3hr"
          large
        />
        <MetricCard
          label="24 HR AVG"
          value={hr24.display}
          unit={hr24.unit}
          current={metrics.hashrate_24hr}
          previous={prevMetrics?.hashrate_24hr}
          metricKey="hashrate_24hr"
          large
        />
      </div>

      {/* Hashrate notices — shown when hashrate drops or low-hashrate mode */}
      <HashrateNotices metrics={metrics} />

      {/* Chart — data from Zustand store, persists across route changes */}
      {chartData60s.length > 1 && (
        <div className="card" style={{ animation: 'stagger-in-scale 0.5s ease-out 0.15s both' }}>
          <div className="label" style={{ marginBottom: '12px' }}>
            HASHRATE HISTORY{metrics.low_hashrate_mode ? ' — 3HR PRIMARY (LOW HASHRATE MODE)' : ''}
          </div>
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
                lowHashrateMode={metrics.low_hashrate_mode}
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
          metricKey="workers_hashing"
          large
        />
        <MetricCard
          label="BTC PRICE"
          value={formatFiat(metrics.btc_price)}
          current={metrics.btc_price}
          previous={prevMetrics?.btc_price}
          metricKey="btc_price"
          large
        />
        <MetricCard
          label="DAILY MINED"
          value={fmtSats(metrics.daily_mined_sats)}
          unit="SATS"
          current={metrics.daily_mined_sats}
          previous={prevMetrics?.daily_mined_sats}
          metricKey="daily_mined_sats"
          large
        />
        <MetricCard
          label="UNPAID EARNINGS"
          value={`${(metrics.unpaid_earnings * 1e8).toFixed(0)}`}
          unit="SATS"
          large
          subtext={`≈ ${formatFiat(metrics.unpaid_earnings * metrics.btc_price)}`}
        />
      </div>

      {/* Bitcoin progress bar + payout */}
      <div className="grid-2" style={{ animation: 'stagger-in 0.4s ease-out 0.35s both' }}>
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>OCEAN POOL BLOCK TIMER</div>
          <BitcoinProgressBar lastBlockTime={metrics.last_block_time} />
          <div className="flex gap-2 mt-2">
            <div>
              <div className="label">LAST OCEAN BLOCK</div>
              <div className="value-sm glow">#{metrics.last_block_height.toLocaleString()}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <LiveBlockTimer lastBlockTime={metrics.last_block_time} />
                <span style={{ color: 'var(--text-dim)' }}>ago</span>
              </div>
            </div>
            <div>
              <div className="label">POOL BLOCKS FOUND</div>
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
          value={formatFiat(metrics.daily_revenue)}
          current={metrics.daily_revenue}
          previous={prevMetrics?.daily_revenue}
          metricKey="daily_revenue"
        />
        <MetricCard
          label="POWER COST/DAY"
          value={formatFiat(metrics.daily_power_cost)}
        />
        <MetricCard
          label="DAILY PROFIT"
          value={formatFiatSigned(metrics.daily_profit_usd)}
          current={metrics.daily_profit_usd}
          previous={prevMetrics?.daily_profit_usd}
          metricKey="daily_profit_usd"
        />
        <MetricCard
          label="MONTHLY PROFIT"
          value={formatFiatSigned(metrics.monthly_profit_usd)}
        />
      </div>
    </div>
  );
};
