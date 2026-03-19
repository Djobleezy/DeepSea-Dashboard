/**
 * HashrateNotices — contextual warnings when hashrate drops or is in low-hashrate mode.
 *
 * Displays inline notice banners in the metrics area of the dashboard:
 *   - "⚠ Hashrate below 24hr average" when 60s hash is significantly below 24hr avg
 *   - "⛏ Mining at reduced capacity" when in low_hashrate_mode
 *   - "⚠ No active workers" when workers_hashing === 0
 *   - "⚠ Hashrate variance high" when 60s is far from 3hr average
 *
 * Uses CSS custom properties for theming — no hardcoded colors.
 */

import React from 'react';
import type { DashboardMetrics } from '../types';

interface Props {
  metrics: DashboardMetrics;
}

interface Notice {
  message: string;
  type: 'warning' | 'error' | 'info';
}

function buildNotices(metrics: DashboardMetrics): Notice[] {
  const notices: Notice[] = [];

  // No workers online
  if (metrics.workers_hashing === 0) {
    notices.push({ message: '⚠ No active workers — mining offline', type: 'error' });
    return notices; // offline = no need for further hashrate notices
  }

  // Low hashrate mode notice
  if (metrics.low_hashrate_mode) {
    notices.push({
      message: '⛏ Low hashrate device detected — using 3hr average for chart accuracy',
      type: 'info',
    });
  }

  // 60s hashrate vs 24hr average — flag if 60s is significantly below avg
  const hr60  = metrics.hashrate_60sec;
  const hr24  = metrics.hashrate_24hr;
  const hr3   = metrics.hashrate_3hr;

  if (hr24 > 0 && hr60 > 0) {
    const dropVs24 = (hr24 - hr60) / hr24;
    if (dropVs24 > 0.20) {
      // >20% below 24hr average
      const pct = Math.round(dropVs24 * 100);
      notices.push({
        message: `⚠ Hashrate ${pct}% below 24hr average — possible worker issue`,
        type: 'warning',
      });
    }
  }

  // 60s vs 3hr — flag high variance even if not below 24hr avg
  if (hr3 > 0 && hr60 > 0) {
    const variance = Math.abs(hr60 - hr3) / hr3;
    if (variance > 0.30 && hr60 < hr3) {
      // 60s is >30% below 3hr avg — sudden drop
      notices.push({
        message: '⚠ Hashrate variance high — 60s reading well below 3hr avg',
        type: 'warning',
      });
    }
  }

  return notices;
}

const noticeStyles: Record<Notice['type'], string> = {
  warning: '',
  error:   'hashrate-notice-error',
  info:    '',
};

export const HashrateNotices: React.FC<Props> = ({ metrics }) => {
  const notices = buildNotices(metrics);
  if (notices.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {notices.map((n, i) => (
        <div
          key={i}
          className={`hashrate-notice ${noticeStyles[n.type]}`}
          role="alert"
        >
          {n.message}
        </div>
      ))}
    </div>
  );
};
