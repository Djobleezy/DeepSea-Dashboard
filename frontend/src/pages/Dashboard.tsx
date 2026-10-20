import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMetricHistory } from '../api/client';
import { useDatumStatus } from '../hooks/useDatumStatus';
import { deriveDatumBadge } from '../utils/datum';
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
import { estimatePoolIntervalMinutes } from '../utils/pool';

const HashrateChart = lazy(() => import('../components/HashrateChart').then((module) => ({ default: module.HashrateChart })));

function freshnessLabel(updatedAt: number | null | undefined, now: number) {
  if (!updatedAt) return 'Waiting for the first successful update';
  const age = Math.max(0, Math.floor(now / 1000 - updatedAt));
  if (age < 60) return `Updated ${age}s ago`;
  if (age < 3600) return `Updated ${Math.floor(age / 60)}m ago`;
  return `Updated ${Math.floor(age / 3600)}h ago`;
}

export const Dashboard: React.FC = () => {
  const { formatFiat, formatFiatSigned } = useCurrency();
  const metrics = useAppStore((s) => s.metrics);
  const prevMetrics = useAppStore((s) => s.prevMetrics);
  const metricsLoading = useAppStore((s) => s.metricsLoading);
  const metricsError = useAppStore((s) => s.metricsError);
  const wallet = useAppStore((s) => s.wallet);
  const walletEpoch = useAppStore((s) => s.walletEpoch);
  const retry = useAppStore((s) => s.requestMetricsRefresh);
  const chartData60s = useAppStore((s) => s.chartData60s);
  const chartData3hr = useAppStore((s) => s.chartData3hr);
  const addChartPoint = useAppStore((s) => s.addChartPoint);
  const chartHydrated = useAppStore((s) => s.chartHydrated);
  const hydrateChart = useAppStore((s) => s.hydrateChart);
  const { annotations: blockAnnotations } = useBlockAnnotations();
  const hydrationAttempted = useRef<number | null>(null);
  const { health, datum } = useDatumStatus();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!wallet || hydrationAttempted.current === walletEpoch || chartHydrated) return;
    hydrationAttempted.current = walletEpoch;
    let cancelled = false;
    fetchMetricHistory(1).then((points) => {
      if (!cancelled) hydrateChart(Array.isArray(points) ? points : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [wallet, walletEpoch, chartHydrated, hydrateChart]);

  useEffect(() => {
    if (!metrics || metrics.data_status === 'stale' || metrics.data_status === 'unavailable' || metrics.data_status === 'unconfigured') return;
    addChartPoint(metrics.hashrate_60sec, metrics.hashrate_3hr, metrics.data_updated_at);
  }, [metrics, addChartPoint]);

  if (wallet === '' || metrics?.data_status === 'unconfigured') {
    return <section className="card dashboard-setup">
      <p className="eyebrow">Welcome to DeepSea</p>
      <h1>Connect your mining wallet</h1>
      <p>Add your Ocean payout address to see your workers, hashrate, and earnings. Until then, there is no mining data to display.</p>
      <Link className="btn btn-primary" to="/config">Set up your dashboard →</Link>
    </section>;
  }

  if (!metrics || metrics.data_status === 'unavailable') {
    return <section className="status-panel" role={metricsError || metrics?.data_error ? 'alert' : 'status'}>
      <div>
        <h1>{metricsError || metrics?.data_error ? 'Mining data is unavailable' : 'Loading your mining data'}</h1>
        <p>{metricsError || metrics?.data_error ? 'We could not get a current snapshot. Check the connection and try again.' : 'Connecting to your configured wallet. Your first update will appear here.'}</p>
      </div>
      {(metricsError || metrics?.data_error || !metricsLoading) && <button className="btn" onClick={retry}>Retry</button>}
      <Link to="/config">Check configuration</Link>
    </section>;
  }

  const datumBadge = deriveDatumBadge(health, datum, metrics.pool_fees_percentage);
  const isStale = metrics.data_status === 'stale' || Boolean(metricsError);
  const poolIntervalMinutes = estimatePoolIntervalMinutes(
    metrics.network_hashrate, metrics.network_hashrate_unit,
    metrics.pool_total_hashrate, metrics.pool_total_hashrate_unit,
  );
  const hashrates = [
    { label: metrics.low_hashrate_mode ? '60 sec · variable' : '60 sec', value: metrics.hashrate_60sec, unit: metrics.hashrate_60sec_unit, previous: prevMetrics?.hashrate_60sec, key: 'hashrate_60sec' },
    { label: '10 min', value: metrics.hashrate_10min, unit: metrics.hashrate_10min_unit, previous: prevMetrics?.hashrate_10min, key: 'hashrate_10min' },
    { label: metrics.low_hashrate_mode ? '3 hr · primary average' : '3 hr average', value: metrics.hashrate_3hr, unit: metrics.hashrate_3hr_unit, previous: prevMetrics?.hashrate_3hr, key: 'hashrate_3hr' },
    { label: '24 hr average', value: metrics.hashrate_24hr, unit: metrics.hashrate_24hr_unit, previous: prevMetrics?.hashrate_24hr, key: 'hashrate_24hr' },
  ];

  return <div className="dashboard-stack">
    <div className="page-heading">
      <div><p className="eyebrow">Your fleet at a glance</p><h1>Mining dashboard</h1></div>
      <div className="dashboard-subtitle">
        <span className={`badge ${datumBadge.className}`} title={datumBadge.tooltip}>{datumBadge.label}</span>
        <span className="field-help" style={{ margin: 0 }}>{freshnessLabel(metrics.data_updated_at, now)}</span>
      </div>
    </div>
    {isStale && <div className="status-panel status-warning" role="alert"><p>Updates are interrupted. These are the last available readings, not current mining status.</p><button className="btn" onClick={retry}>Retry update</button></div>}
    <div className="grid-4">
      <MetricCard label="Workers hashing" value={metrics.workers_hashing} current={metrics.workers_hashing} previous={prevMetrics?.workers_hashing} metricKey="workers_hashing" large />
      <MetricCard label="Est. daily profit" value={formatFiatSigned(metrics.daily_profit_usd)} current={metrics.daily_profit_usd} previous={prevMetrics?.daily_profit_usd} metricKey="daily_profit_usd" valueColor={metrics.daily_profit_usd < 0 ? 'var(--color-error)' : 'var(--color-success)'} large subtext="Revenue estimate less electricity" />
      <MetricCard label="Unpaid balance" value={fmtSats(metrics.unpaid_earnings * 1e8)} unit="SATS" large subtext={`≈ ${formatFiat(metrics.unpaid_earnings * metrics.btc_price)}`} />
      <MetricCard label="BTC price" value={formatFiat(metrics.btc_price)} current={metrics.btc_price} previous={prevMetrics?.btc_price} metricKey="btc_price" large />
    </div>
    {!isStale && <HashrateNotices metrics={metrics} />}
    <section aria-labelledby="hashrate-heading">
      <h2 id="hashrate-heading" className="label dashboard-section-title">Hashrate averages</h2>
      <div className="grid-4">{hashrates.map((reading) => {
        const rate = autoScaleHashrate(reading.value, reading.unit);
        return <MetricCard key={reading.key} label={reading.label} value={rate.display} unit={rate.unit} current={reading.value} previous={reading.previous} metricKey={reading.key} large />;
      })}</div>
    </section>
    <section className="card" aria-labelledby="history-heading">
      <h2 className="label dashboard-section-title" id="history-heading">Hashrate history{metrics.low_hashrate_mode ? ' · 3 hr primary average' : ''}</h2>
      {chartData60s.length > 1 ? <ErrorBoundary><Suspense fallback={<p className="field-help">Loading chart…</p>}>
        <HashrateChart data60s={chartData60s} data3hr={chartData3hr} avg24hr={metrics.hashrate_24hr} blockAnnotations={blockAnnotations} lowHashrateMode={metrics.low_hashrate_mode} />
      </Suspense></ErrorBoundary> : <p className="field-help">Your history will appear as readings arrive. Valid zero readings are included.</p>}
    </section>
    <div className="grid-2">
      <section className="card">
        <h2 className="label dashboard-section-title">Estimated cash flow</h2>
        <dl className="dashboard-detail-list">
          <div><dt>Revenue / day</dt><dd>{formatFiat(metrics.daily_revenue)}</dd></div>
          <div><dt>Electricity / day</dt><dd>{formatFiat(metrics.daily_power_cost)}</dd></div>
          <div><dt>Estimated sats / day</dt><dd>{fmtSats(metrics.daily_mined_sats)}</dd></div>
          <div><dt>Profit / month</dt><dd>{formatFiatSigned(metrics.monthly_profit_usd)}</dd></div>
        </dl>
        <p className="field-help">Projections use current mining and price data. Actual payouts and future prices will vary.</p>
      </section>
      <PayoutSummary metrics={metrics} />
    </div>
    <section className="card">
      <h2 className="label dashboard-section-title">Ocean pool block timer</h2>
      {metrics.last_block_height > 0 ? <>
        <BitcoinProgressBar lastBlockTime={metrics.last_block_time} targetMinutes={poolIntervalMinutes} targetLabel="estimated pool interval" />
        <p className="field-help">Pool blocks arrive irregularly. The interval estimate uses Ocean’s share of network hashrate and is not a deadline.</p>
        <div className="dashboard-detail-list" style={{ marginTop: 20 }}>
          <div><div className="label">Last Ocean block</div><div className="value-sm">#{metrics.last_block_height.toLocaleString()}</div><LiveBlockTimer lastBlockTime={metrics.last_block_time} targetMinutes={poolIntervalMinutes} /> <span className="field-help" style={{ display: 'inline' }}>ago</span></div>
          <div><div className="label">Pool blocks found</div><div className="value-sm">{metrics.blocks_found}</div></div>
        </div>
      </> : <p className="field-help">No pool block timing is available yet.</p>}
    </section>
    <details className="network-details">
      <summary>Network and pool details</summary>
      <div className="grid-4">
        <MetricCard label="Network hashrate" value={fmtHashrate(metrics.network_hashrate, metrics.network_hashrate_unit)} />
        <MetricCard label="Difficulty" value={(metrics.difficulty / 1e12).toFixed(2)} unit="T" />
        <MetricCard label="Pool hashrate" value={fmtHashrate(metrics.pool_total_hashrate, metrics.pool_total_hashrate_unit)} />
        <MetricCard label="Pool fees" value={`${metrics.pool_fees_percentage.toFixed(2)}%`} />
      </div>
    </details>
  </div>;
};
