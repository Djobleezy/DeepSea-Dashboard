import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { fetchDatumStatus, fetchHealth, fetchMetricHistory } from '../api/client';
import type { DatumStatus, HealthStatus as HealthStatusType } from '../types';
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

// Legacy fee-only DATUM signal.  We keep this as a fallback so users
// who never configure a DATUM_GATEWAY_URL still get the old badge
// behaviour — no regression.
//
// IMPORTANT: this signal LAGS reality.  pool_fees_percentage is an
// average of historical work as reported by Ocean's stats page, so a
// user who just enabled DATUM may not see their fee % land in the
// 0.9%-1.3% band for hours or days.  During that window the badge
// will say OFFLINE even though DATUM is fully operational.  This is
// the bug that motivated the live /api/datum/status endpoint — see
// backend/app/routers/datum.py.
//
// Keep these bounds in sync with DATUM_FEE_BAND_LOW/HIGH in datum.py.
function isDatumFeeInBand(poolFeesPct: number): boolean {
  return poolFeesPct >= 0.9 && poolFeesPct <= 1.3;
}

// Poll the live DATUM probe at the same rough cadence as the metrics
// refresh so the badge stays current without piling on requests.
const DATUM_POLL_MS = 30_000;

type DatumBadgeState = {
  label: string;
  className: 'badge-online' | 'badge-offline' | 'badge-warning';
  dotColor: string;
  glow: boolean;
  tooltip: string;
};

function deriveDatumBadge(
  health: HealthStatusType | null,
  datum: DatumStatus | null,
  poolFeesPct: number,
): DatumBadgeState {
  // 1) Live probe is configured — trust it as the primary signal and
  //    use the fee-band as the secondary signal that nuances the label.
  if (health?.datum_gateway_configured && datum) {
    if (datum.status === 'connected') {
      return {
        label: 'DATUM CONNECTED',
        className: 'badge-online',
        dotColor: 'var(--color-success)',
        glow: true,
        tooltip: datum.explanation,
      };
    }
    if (datum.status === 'transitioning') {
      // Headline UX fix for the bug report: gateway is up, fees just
      // haven't caught up yet.  Show a distinct "warming up" state so
      // the user knows it's expected.
      return {
        label: datum.probe_reachable ? 'DATUM ACTIVE (fees settling)' : 'DATUM FEES ONLY',
        className: 'badge-warning',
        dotColor: 'var(--color-warning, #f0a020)',
        glow: true,
        tooltip: datum.explanation,
      };
    }
    if (datum.status === 'offline') {
      return {
        label: 'DATUM OFFLINE',
        className: 'badge-offline',
        dotColor: 'var(--color-error)',
        glow: false,
        tooltip: datum.explanation,
      };
    }
    // 'unknown' — the probe couldn't say one way or the other.  Fall
    // through to the legacy fee check so we still show *something*.
  }

  // 2) No live probe configured (or probe returned 'unknown') —
  //    legacy fee-only behaviour.  Note the tooltip nudges the user
  //    toward configuring the probe if their fees aren't in band.
  const feeBand = isDatumFeeInBand(poolFeesPct);
  if (feeBand) {
    return {
      label: 'DATUM CONNECTED',
      className: 'badge-online',
      dotColor: 'var(--color-success)',
      glow: true,
      tooltip:
        'Pool fees in the DATUM range (0.9%–1.3%). For a real-time status, set DATUM_GATEWAY_URL.',
    };
  }
  return {
    label: 'DATUM OFFLINE',
    className: 'badge-offline',
    dotColor: 'var(--color-error)',
    glow: false,
    tooltip:
      'Pool fees are outside the DATUM range. If you just enabled DATUM, this can take hours\u2014 ' +
      'Ocean averages over historical work. Set DATUM_GATEWAY_URL to see a live status.',
  };
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
  const [health, setHealth] = useState<HealthStatusType | null>(null);
  const [datum, setDatum] = useState<DatumStatus | null>(null);

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

  // Fetch /health once to find out whether DATUM_GATEWAY_URL is set.
  // If it isn't, we don't poll /api/datum/status at all — the legacy
  // fee-only badge is enough for users who never configured a probe.
  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll /api/datum/status whenever a gateway URL is configured.  The
  // backend caches the underlying probe for ~15s, so this is cheap.
  useEffect(() => {
    if (!health?.datum_gateway_configured) return;
    let cancelled = false;

    const tick = () => {
      fetchDatumStatus()
        .then((s) => {
          if (!cancelled) setDatum(s);
        })
        .catch(() => {
          // Swallow — next tick will retry.  We don't want a probe blip
          // to take down the dashboard.
        });
    };
    tick();
    const id = window.setInterval(tick, DATUM_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [health?.datum_gateway_configured]);

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

  const datumBadge = deriveDatumBadge(health, datum, metrics.pool_fees_percentage);
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
          {/* DATUM Gateway badge — derived from the live probe when a
              gateway URL is configured, otherwise falls back to the
              legacy pool_fees_percentage band check. */}
          <span
            className={`badge ${datumBadge.className}`}
            style={{ fontSize: '12px', padding: '4px 12px' }}
            title={datumBadge.tooltip}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: datumBadge.dotColor,
                display: 'inline-block',
                boxShadow: datumBadge.glow ? `0 0 6px ${datumBadge.dotColor}` : 'none',
                animation: datumBadge.glow ? 'pulse-glow 2s infinite' : 'none',
                marginRight: '6px',
              }}
            />
            {datumBadge.label}
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
