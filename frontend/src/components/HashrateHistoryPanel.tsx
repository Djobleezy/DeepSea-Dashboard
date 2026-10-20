import { Suspense, lazy, useEffect, useState } from 'react';
import { useAppStore } from '../stores/store';
import { useHashrateHistory } from '../hooks/useHashrateHistory';
import { useBlockAnnotations } from '../hooks/useBlockAnnotations';
import { getServerTime } from '../utils/serverClock';
import { autoScaleHashrate } from '../utils/format';
import { ErrorBoundary } from './ErrorBoundary';

const HashrateChart = lazy(() => import('./HashrateChart').then((module) => ({ default: module.HashrateChart })));

/** History remains available when the current upstream snapshot is unavailable. */
export function HashrateHistoryPanel() {
  const metrics = useAppStore((s) => s.metrics);
  const chartData60s = useAppStore((s) => s.chartData60s);
  const chartData3hr = useAppStore((s) => s.chartData3hr);
  const sseConnected = useAppStore((s) => s.sseConnected);
  const metricsError = useAppStore((s) => s.metricsError);
  const history = useHashrateHistory();
  const { annotations: blockAnnotations } = useBlockAnnotations(Math.min(history.hours, 72) * 60);
  const [now, setNow] = useState(getServerTime);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(getServerTime()), 30000);
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  const hasCurrent = !!metrics && metrics.data_status !== 'unavailable' && metrics.data_status !== 'unconfigured';
  const isStale = !hasCurrent || metrics?.data_status === 'stale' || Boolean(metricsError);
  const renderNow = getServerTime();
  const sourceTime = (metrics?.data_updated_at ?? 0) * 1000;
  const chartNow = Math.max(now, renderNow, Number.isFinite(sourceTime) && sourceTime <= renderNow + 5000 ? sourceTime : 0);
  const hashrates = hasCurrent && metrics ? [
    { label: metrics.low_hashrate_mode ? '60 sec · variable' : '60 sec', value: metrics.hashrate_60sec, unit: metrics.hashrate_60sec_unit, key: 'hashrate_60sec' },
    { label: '10 min', value: metrics.hashrate_10min, unit: metrics.hashrate_10min_unit, key: 'hashrate_10min' },
    { label: metrics.low_hashrate_mode ? '3 hr · primary average' : '3 hr average', value: metrics.hashrate_3hr, unit: metrics.hashrate_3hr_unit, key: 'hashrate_3hr' },
    { label: '24 hr average', value: metrics.hashrate_24hr, unit: metrics.hashrate_24hr_unit, key: 'hashrate_24hr' },
  ] : [];
  return <section className="card hashrate-card" aria-labelledby="history-heading">
      <div className="hashrate-header">
        <div><p className="eyebrow">Mining performance</p><h2 id="history-heading">Hashrate history</h2></div>
        <div className="hashrate-ranges" role="group" aria-label="Hashrate time range">
          {([1, 6, 24, 168] as const).map((hours) => <button type="button" key={hours} aria-pressed={history.hours === hours} onClick={() => history.setHours(hours)}>{hours === 168 ? '7D' : `${hours}H`}</button>)}
        </div>
      </div>
      {hasCurrent ? <dl className="hashrate-readings">{hashrates.map((reading) => {
        const rate = autoScaleHashrate(reading.value, reading.unit);
        const primary = reading.key === (metrics?.low_hashrate_mode ? 'hashrate_3hr' : 'hashrate_60sec');
        return <div key={reading.key} className={primary ? 'hashrate-reading-primary' : ''}><dt>{reading.label}</dt><dd>{rate.display}<span>{rate.unit}</span></dd></div>;
      })}</dl> : <p className="field-help">Current readings are unavailable. Your saved history is shown below.</p>}
      <div className="hashrate-context">
        <span className={isStale || !online || !sseConnected ? 'hashrate-status hashrate-status-stale' : 'hashrate-status'}><i aria-hidden="true" />{!hasCurrent ? 'Current reading unavailable · saved history' : !online ? 'Offline · showing saved readings' : isStale ? 'Updates paused · showing saved readings' : !sseConnected ? 'Reconnecting · last received readings' : 'Live history'}</span>
        <span>Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>
      {history.error && <div className="hashrate-history-error" role="alert"><span>{history.error}</span><button type="button" className="btn" onClick={history.retry}>Retry history</button></div>}
      {history.loading && <p className="hashrate-loading" role="status">Loading saved history…</p>}
      {chartData60s.some((point) => point.ts >= chartNow - history.hours * 3_600_000 && point.ts <= chartNow + 5000) ? <ErrorBoundary><Suspense fallback={<p className="field-help">Loading chart…</p>}>
        <HashrateChart data60s={chartData60s} data3hr={chartData3hr} avg24hr={hasCurrent ? metrics?.hashrate_24hr : undefined} blockAnnotations={blockAnnotations} lowHashrateMode={metrics?.low_hashrate_mode} hours={history.hours} now={chartNow} />
      </Suspense></ErrorBoundary> : <div className="hashrate-empty"><span aria-hidden="true">↗</span><p>{history.loading ? 'Fetching your saved readings' : 'Your history starts here'}</p><small>{history.loading ? 'Live updates continue while history loads.' : 'New readings appear automatically. Longer ranges fill as your dashboard runs.'}</small></div>}
    </section>;
}
