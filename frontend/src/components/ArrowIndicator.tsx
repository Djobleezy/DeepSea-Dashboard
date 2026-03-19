/**
 * ArrowIndicator — per-metric change indicators for MetricCard
 *
 * Features:
 * - Per-metric thresholds matching v1 sophistication (hashrates 1-3%, prices 0.5%, earnings 2%)
 * - Double chevron (⇈/⇊) for big moves (>2× threshold), single (↑/↓) for normal
 * - 60s TTL auto-expiry via cleanup interval
 * - Bounce animation on appearance
 * - State tracked in module-level Map (not localStorage — avoids stale data across rebuilds)
 */

import React, { useEffect, useRef, useState } from 'react';

// ── Per-metric thresholds (fractional, e.g. 0.03 = 3%) ──────────────────────
const THRESHOLDS: Record<string, number> = {
  hashrate_60sec:      0.03,   // 3% — noisy
  hashrate_10min:      0.02,   // 2%
  hashrate_3hr:        0.01,   // 1%
  hashrate_24hr:       0.005,  // 0.5%
  pool_total_hashrate: 0.01,   // 1%
  network_hashrate:    0.005,  // 0.5%

  btc_price:           0.005,  // 0.5%
  daily_revenue:       0.02,   // 2%
  daily_power_cost:    0.02,   // 2%
  daily_profit_usd:    0.02,   // 2%
  monthly_profit_usd:  0.02,   // 2%

  daily_mined_sats:    0.02,   // 2%
  monthly_mined_sats:  0.02,   // 2%
  estimated_earnings_per_day_sats:       0.02,
  estimated_earnings_next_block_sats:    0.02,
  estimated_rewards_in_window_sats:      0.02,
  unpaid_earnings:     0.005,  // 0.5%

  block_number:        0,      // always show (integer jumps)
  workers_hashing:     0,      // always show
  difficulty:          0.001,  // 0.1%
};
const DEFAULT_THRESHOLD = 0.01; // 1%
const ARROW_TTL_MS      = 60_000; // 60 seconds
const BIG_MULTIPLIER    = 2;     // >2x threshold = double chevron

// ── Module-level state (outlives component re-mounts, scoped to JS session) ──
interface ArrowState {
  direction: 'up' | 'down';
  big: boolean;
  setAt: number;
}
const arrowMap  = new Map<string, ArrowState>();
const prevMap   = new Map<string, number>();

// Cleanup stale arrows every 10 s
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of arrowMap.entries()) {
    if (now - state.setAt > ARROW_TTL_MS) arrowMap.delete(key);
  }
}, 10_000);

// ── React component ──────────────────────────────────────────────────────────
interface Props {
  /** Numeric value for comparison */
  current: number;
  /** Previous value (from prevMetrics store) */
  previous?: number;
  /** Key used to look up per-metric threshold; falls back to defaultThreshold */
  metricKey?: string;
  /** Override threshold (ignores metricKey lookup) */
  threshold?: number;
}

export const ArrowIndicator: React.FC<Props> = ({
  current,
  previous,
  metricKey,
  threshold,
}) => {
  const [tick, setTick] = useState(0);
  const bounceClass = useRef('');
  const prevRendered = useRef<ArrowState | null>(null);

  // Resolve threshold
  const resolvedThreshold =
    threshold !== undefined
      ? threshold
      : metricKey !== undefined
        ? (THRESHOLDS[metricKey] ?? DEFAULT_THRESHOLD)
        : DEFAULT_THRESHOLD;

  // Compute and store arrow state whenever current/previous change
  useEffect(() => {
    if (previous === undefined || previous === null || isNaN(previous) || isNaN(current)) return;
    if (current === previous) return;

    const denom = previous !== 0 ? Math.abs(previous) : (current !== 0 ? 1 : 0);
    if (denom === 0) return;

    const pctChange = Math.abs((current - previous) / denom);

    // Only update arrowMap if threshold exceeded
    if (resolvedThreshold > 0 && pctChange <= resolvedThreshold) return;

    const key = metricKey ?? `__anon_${current}`;
    const big = pctChange > resolvedThreshold * BIG_MULTIPLIER;
    const direction: 'up' | 'down' = current > previous ? 'up' : 'down';

    arrowMap.set(key, { direction, big, setAt: Date.now() });
    // Force re-render so arrow appears
    setTick((t) => t + 1);
  }, [current, previous, resolvedThreshold, metricKey]);

  // Read current state from map
  const key = metricKey ?? `__anon_${current}`;
  const now = Date.now();
  const state = arrowMap.get(key);
  const valid = state && (now - state.setAt) <= ARROW_TTL_MS;

  if (!valid) return null;

  // Pick bounce class when arrow first appears or direction changes
  const isNew =
    !prevRendered.current ||
    prevRendered.current.direction !== state.direction ||
    prevRendered.current.big !== state.big ||
    prevRendered.current.setAt !== state.setAt;

  if (isNew) {
    bounceClass.current = state.direction === 'up' ? 'arrow-bounce-up' : 'arrow-bounce-down';
    prevRendered.current = { ...state };
  }

  const up    = state.direction === 'up';
  const color = up ? 'var(--color-success)' : 'var(--color-error)';
  const icon  = state.big
    ? (up ? '⇈' : '⇊')
    : (up ? '↑' : '↓');

  // Force re-render when TTL expires so the arrow disappears
  useEffect(() => {
    if (!state) return;
    const remaining = ARROW_TTL_MS - (Date.now() - state.setAt);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => {
      setTick((t) => t + 1);
    }, remaining + 10);
    return () => window.clearTimeout(timer);
  }, [state?.setAt, key]);

  void tick; // used to trigger rerender after TTL timeout

  return (
    <span
      key={`${key}-${state.setAt}`}
      className={bounceClass.current}
      style={{
        color,
        fontSize: state.big ? '20px' : '18px',
        marginLeft: '4px',
        verticalAlign: 'middle',
        textShadow: `0 0 6px ${color}`,
        display: 'inline-block',
        lineHeight: 1,
      }}
      title={`${up ? '+' : '-'}${(Math.abs((current - (previous ?? 0)) / (previous !== 0 ? Math.abs(previous ?? 1) : 1)) * 100).toFixed(2)}%`}
    >
      {icon}
    </span>
  );
};

// ── Export helper so MetricCard can pass metricKey ───────────────────────────
export { THRESHOLDS as ARROW_THRESHOLDS };

// ── Track previous values (called by SSE/store updates) ─────────────────────
export function updateArrowPrev(key: string, value: number): void {
  prevMap.set(key, value);
}

export function getArrowPrev(key: string): number | undefined {
  return prevMap.get(key);
}
