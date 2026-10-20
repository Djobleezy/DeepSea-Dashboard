import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HashrateHistoryPanel } from '../components/HashrateHistoryPanel';
import { getServerTime } from '../utils/serverClock';
import { useDatumStatus } from '../hooks/useDatumStatus';
import { deriveDatumBadge } from '../utils/datum';
import { useAppStore } from '../stores/store';
import { MetricCard } from '../components/MetricCard';
import { PayoutSummary } from '../components/PayoutSummary';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';
import { useCurrency } from '../hooks/useCurrency';
import { fmtHashrate, fmtSats } from '../utils/format';
import { LiveBlockTimer } from '../components/LiveBlockTimer';
import { HashrateNotices } from '../components/HashrateNotices';
import { estimatePoolIntervalMinutes } from '../utils/pool';

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
  const retry = useAppStore((s) => s.requestMetricsRefresh);
  const { health, datum } = useDatumStatus();
  const [now, setNow] = useState(getServerTime);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getServerTime()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (wallet === '' || metrics?.data_status === 'unconfigured') {
    return <section className="card dashboard-setup">
      <p className="eyebrow">Welcome to DeepSea</p>
      <h1>Connect your mining wallet</h1>
      <p>Add your Ocean payout address to see your workers, hashrate, and earnings. Until then, there is no mining data to display.</p>
      <Link className="btn btn-primary" to="/config">Set up your dashboard →</Link>
    </section>;
  }

  if (!metrics || metrics.data_status === 'unavailable') {
    return <><section className="status-panel" role={metricsError || metrics?.data_error ? 'alert' : 'status'}>
      <div>
        <h1>{metricsError || metrics?.data_error ? 'Mining data is unavailable' : 'Loading your mining data'}</h1>
        <p>{metricsError || metrics?.data_error ? 'We could not get a current snapshot. Check the connection and try again.' : 'Connecting to your configured wallet. Your first update will appear here.'}</p>
      </div>
      {(metricsError || metrics?.data_error || !metricsLoading) && <button className="btn" onClick={retry}>Retry</button>}
      <Link to="/config">Check configuration</Link>
    </section>{wallet && <HashrateHistoryPanel />}</>;
  }

  const datumBadge = deriveDatumBadge(health, datum, metrics.pool_fees_percentage);
  const isStale = metrics.data_status === 'stale' || Boolean(metricsError);
  const poolIntervalMinutes = estimatePoolIntervalMinutes(
    metrics.network_hashrate, metrics.network_hashrate_unit,
    metrics.pool_total_hashrate, metrics.pool_total_hashrate_unit,
  );


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
    <HashrateHistoryPanel />
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
        <BitcoinProgressBar key={metrics.last_block_height} lastBlockTime={metrics.last_block_time} targetMinutes={poolIntervalMinutes} targetLabel="estimated pool interval" />
        <p className="field-help">Pool blocks arrive irregularly. The interval estimate uses Ocean’s share of network hashrate and is not a deadline.</p>
        <div className="dashboard-detail-list" style={{ marginTop: 20 }}>
          <div><div className="label">Last Ocean block</div><div className="value-sm">#{metrics.last_block_height.toLocaleString()}</div><LiveBlockTimer key={metrics.last_block_height} lastBlockTime={metrics.last_block_time} targetMinutes={poolIntervalMinutes} /> <span className="field-help" style={{ display: 'inline' }}>ago</span></div>
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
