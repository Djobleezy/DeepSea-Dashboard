import React from 'react';
import type { DashboardMetrics } from '../types';

interface Props {
  metrics: DashboardMetrics;
}

const SATS_PER_BTC = 100_000_000;
const PAYOUT_THRESHOLD_BTC = 0.01; // Ocean.xyz minimum payout

function estimatePayoutTime(unpaidBtc: number, dailySats: number): string {
  if (dailySats <= 0) return 'N/A';

  const remaining = PAYOUT_THRESHOLD_BTC - unpaidBtc;
  if (remaining <= 0) return 'Next block';

  const dailyBtc = dailySats / SATS_PER_BTC;
  if (dailyBtc <= 0) return 'N/A';

  const daysLeft = remaining / dailyBtc;

  if (daysLeft < 1) {
    const hours = Math.round(daysLeft * 24);
    return hours <= 1 ? '~1 hour' : `~${hours} hours`;
  }
  if (daysLeft < 2) return '~1 day';
  if (daysLeft < 30) return `~${Math.round(daysLeft)} days`;
  if (daysLeft < 60) return '~1 month';
  return `~${Math.round(daysLeft / 30)} months`;
}

export const PayoutSummary: React.FC<Props> = ({ metrics }) => {
  const unpaidBtc = metrics.unpaid_earnings || 0;
  const unpaidSats = Math.round(unpaidBtc * SATS_PER_BTC);
  const unpaidFiat = unpaidBtc * (metrics.btc_price || 0);
  const payoutPct = Math.min(100, (unpaidBtc / PAYOUT_THRESHOLD_BTC) * 100);
  const estTime = estimatePayoutTime(unpaidBtc, metrics.daily_mined_sats);

  return (
    <div className="card">
      <div className="label" style={{ marginBottom: '10px' }}>PAYOUT STATUS</div>

      {/* Progress bar toward 0.01 BTC threshold */}
      <div style={{ marginBottom: '14px' }}>
        <div className="flex justify-between" style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px' }}>
          <span>{unpaidBtc.toFixed(8)} BTC</span>
          <span>{PAYOUT_THRESHOLD_BTC} BTC</span>
        </div>
        <div style={{
          height: '8px',
          background: 'var(--border)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${payoutPct}%`,
            background: payoutPct >= 90 ? 'var(--color-success)' : 'var(--primary)',
            borderRadius: '4px',
            boxShadow: payoutPct >= 90 ? '0 0 8px var(--color-success)' : '0 0 6px var(--primary-glow)',
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '3px', textAlign: 'center' }}>
          {payoutPct.toFixed(1)}% to payout
        </div>
      </div>

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
          <div className="value-sm glow" style={{
            color: estTime === 'Next block' ? 'var(--color-success)' : 'var(--text)',
          }}>
            {estTime}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>
            Based on {metrics.daily_mined_sats.toLocaleString()} sats/day
          </div>
        </div>
        <div>
          <div className="label">DAILY EARNINGS</div>
          <div className="value-sm glow" style={{ color: 'var(--color-success)' }}>
            {metrics.daily_mined_sats.toLocaleString()}
          </div>
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
