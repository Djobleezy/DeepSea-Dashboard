import React from 'react';
import type { DashboardMetrics } from '../types';

interface Props {
  metrics: DashboardMetrics;
}

const SATS_PER_BTC = 100_000_000;

export const PayoutSummary: React.FC<Props> = ({ metrics }) => {
  const unpaidBtc = metrics.unpaid_earnings || 0;
  const unpaidSats = Math.round(unpaidBtc * SATS_PER_BTC);
  const unpaidFiat = unpaidBtc * (metrics.btc_price || 0);

  return (
    <div className="card">
      <div className="label" style={{ marginBottom: '10px' }}>PAYOUT STATUS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <div className="label">UNPAID EARNINGS</div>
          <div className="value-sm glow">{unpaidSats.toLocaleString()}</div>
          <div className="unit">SATS</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            ≈ ${unpaidFiat.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="label">EST. TIME TO PAYOUT</div>
          <div className="value-sm glow">{metrics.est_time_to_payout || 'N/A'}</div>
        </div>
        <div>
          <div className="label">DAILY EARNINGS</div>
          <div className="value-sm glow">{metrics.daily_mined_sats.toLocaleString()}</div>
          <div className="unit">SATS/DAY</div>
        </div>
        <div>
          <div className="label">DAILY PROFIT</div>
          <div
            className="value-sm"
            style={{ color: metrics.daily_profit_usd >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}
          >
            {metrics.daily_profit_usd >= 0 ? '+' : ''}${metrics.daily_profit_usd.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
};
