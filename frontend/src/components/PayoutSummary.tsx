import React, { useState } from 'react';
import type { DashboardMetrics } from '../types';
import { usePayoutTracking } from '../hooks/usePayoutTracking';
import { useCurrency } from '../hooks/useCurrency';
import { formatBtc } from '../utils/format';

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

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? 'just now' : `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type ViewMode = 'next' | 'last';

export const PayoutSummary: React.FC<Props> = ({ metrics }) => {
  const [view, setView] = useState<ViewMode>('next');
  const { lastPayout, avgDaysBetweenPayouts, newPayoutDetected } = usePayoutTracking(metrics);
  const { formatFiat } = useCurrency();

  const unpaidBtc = metrics.unpaid_earnings || 0;
  const unpaidSats = Math.round(unpaidBtc * SATS_PER_BTC);
  const unpaidFiat = unpaidBtc * (metrics.btc_price || 0);
  const payoutPct = Math.min(100, (unpaidBtc / PAYOUT_THRESHOLD_BTC) * 100);
  const estTime = estimatePayoutTime(unpaidBtc, metrics.daily_mined_sats);

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* PAYOUT DETECTED flash overlay */}
      {newPayoutDetected && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
            zIndex: 10,
            animation: 'fade-in-out 5s ease forwards',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-vt323)',
              fontSize: '28px',
              color: 'var(--color-success)',
              textShadow: '0 0 16px var(--color-success)',
              letterSpacing: '4px',
              animation: 'pulse 0.5s ease-in-out infinite alternate',
            }}
          >
            ₿ PAYOUT DETECTED!
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div className="label">PAYOUT STATUS</div>
        {/* Toggle between Next Payout / Last Payout views */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className={`btn${view === 'next' ? ' btn-primary' : ''}`}
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              ...(view === 'next' ? {
                background: 'var(--primary)',
                color: 'var(--bg)',
                border: '1px solid var(--primary)',
              } : {}),
            }}
            onClick={() => setView('next')}
          >
            NEXT
          </button>
          <button
            className={`btn${view === 'last' ? ' btn-primary' : ''}`}
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              ...(view === 'last' ? {
                background: 'var(--primary)',
                color: 'var(--bg)',
                border: '1px solid var(--primary)',
              } : {}),
            }}
            onClick={() => setView('last')}
          >
            LAST
          </button>
        </div>
      </div>

      {/* Progress bar toward 0.01 BTC threshold (always shown) */}
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

      {/* Conditional view content */}
      {view === 'next' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <div className="label">UNPAID EARNINGS</div>
            <div className="value-sm glow">{unpaidSats.toLocaleString()}</div>
            <div className="unit">SATS</div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              ≈ {formatFiat(unpaidFiat)}
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
              {metrics.daily_profit_usd >= 0 ? '+' : ''}{formatFiat(metrics.daily_profit_usd)}
            </div>
          </div>
        </div>
      ) : (
        /* Last payout view */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {lastPayout ? (
            <>
              <div>
                <div className="label">LAST PAYOUT</div>
                <div className="value-sm glow" style={{ color: 'var(--color-success)', fontSize: '14px' }}>
                  {formatRelativeDate(lastPayout.timestamp)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  {new Date(lastPayout.timestamp).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="label">AMOUNT</div>
                <div className="value-sm glow" style={{ color: '#f7931a', fontSize: '13px' }}>
                  {formatBtc(lastPayout.amountBtc)}
                </div>
                {lastPayout.fiatValueUsd !== null && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    ≈ {formatFiat(lastPayout.fiatValueUsd)}
                  </div>
                )}
              </div>
              <div>
                <div className="label">AVG INTERVAL</div>
                <div className="value-sm glow" style={{ fontSize: '14px' }}>
                  {avgDaysBetweenPayouts !== null
                    ? `${avgDaysBetweenPayouts.toFixed(1)} days`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="label">STATUS</div>
                <div
                  className="value-sm"
                  style={{
                    color: lastPayout.verified ? 'var(--color-success)' : 'var(--color-warning, #f7931a)',
                    fontSize: '13px',
                  }}
                >
                  {lastPayout.verified ? '✓ CONFIRMED' : '⏳ PENDING'}
                </div>
              </div>
            </>
          ) : (
            <div style={{ gridColumn: '1 / -1', color: 'var(--text-dim)', fontSize: '13px', textAlign: 'center', padding: '12px 0' }}>
              <span style={{ fontFamily: 'var(--font-vt323)', fontSize: '16px' }}>
                NO PAYOUT HISTORY YET
              </span>
              <div style={{ fontSize: '11px', marginTop: '4px' }}>
                Payouts auto-detected from earnings drops
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
