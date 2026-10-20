import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchEarnings } from '../api/client';
import { useAppStore } from '../stores/store';
import { useCurrency } from '../hooks/useCurrency';
import type { EarningsResponse } from '../types';

export const Earnings: React.FC = () => {
  const [days, setDays] = useState(90);
  const [snapshot, setSnapshot] = useState<{ data: EarningsResponse; days: number; scope: number } | null>(null);
  const walletEpoch = useAppStore((s) => s.walletEpoch);
  const data = snapshot?.scope === walletEpoch ? snapshot.data : null;
  const displayedDays = snapshot?.scope === walletEpoch ? snapshot.days : days;
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const metrics = useAppStore((s) => s.metrics);
  const btcPrice = metrics?.btc_price ?? 0;
  const { formatFiat } = useCurrency();

  const load = useCallback(async (d: number) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetchEarnings(d);
      if (id !== requestId.current || walletEpoch !== useAppStore.getState().walletEpoch) return;
      setSnapshot({ data: res, days: d, scope: walletEpoch });
      setError(null);
    } catch (e) {
      if (id === requestId.current && walletEpoch === useAppStore.getState().walletEpoch) setError(e instanceof Error ? e.message : 'Failed to load earnings');
    } finally {
      if (id === requestId.current && walletEpoch === useAppStore.getState().walletEpoch) setLoading(false);
    }
  }, [walletEpoch]);

  useEffect(() => {
    const pendingRequest = requestId;
    void load(days);
    return () => { pendingRequest.current++; };
  }, [days, load]);

  const txLink = (txid: string, lightning_txid: string) => {
    if (txid) return `https://mempool.space/tx/${txid}`;
    if (lightning_txid) return `https://ocean.xyz/info/tx/lightning/${lightning_txid}`;
    return null;
  };

  const payments = data?.payments ?? [];
  const maxMonthlySats = data?.monthly_summary.length
    ? Math.max(...data.monthly_summary.map((m) => m.sats))
    : 0;
  const totalSats = data?.total_sats ?? 0;
  const totalBtc = data?.total_btc ?? 0;
  const avgPerPayment = payments.length > 0 ? Math.round(totalSats / payments.length) : 0;
  const avgPerDay = displayedDays > 0 ? Math.round(totalSats / displayedDays) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>₿ EARNINGS</h1>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : ''}`}
              onClick={() => setDays(d)}
              style={days === d ? {
                background: 'var(--primary)',
                color: 'var(--bg)',
                boxShadow: '0 0 10px var(--primary-glow)',
                border: '1px solid var(--primary)',
              } : {}}
            >
              {d}D
            </button>
          ))}
          <button className="btn" aria-label="Refresh earnings" onClick={() => load(days)}>⟳</button>
        </div>
      </div>

      {loading && data && (
        <div role="status" style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
          Loading {days}-day history. Showing the last completed {displayedDays}-day result.
        </div>
      )}
      {data?.data_status === 'partial' && (
        <div role="status" className="status-panel" style={{ color: 'var(--color-warning)' }}>
          {data.data_error || 'Some payouts may be missing. Refresh to try loading the complete history.'}
        </div>
      )}
      {/* Retain the old range label until the replacement dataset arrives. */}
      {data && (
        <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.05s both' }}>
          <div className="card">
            <div className="label">{data.data_status === 'partial' ? 'TOTAL LOADED' : 'TOTAL EARNED'}</div>
            <div className="value glow" style={{ color: 'var(--color-success)' }}>
              {totalSats.toLocaleString()}
            </div>
            <div className="unit">SATS</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
              ₿ {totalBtc.toFixed(8)}
              {btcPrice > 0 && (
                <span> · {formatFiat(totalBtc * btcPrice)}</span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="label">{data.data_status === 'partial' ? 'PAYMENTS LOADED' : 'PAYMENTS'} ({displayedDays}D)</div>
            <div className="value glow" style={{ color: 'var(--primary)' }}>{payments.length}</div>
          </div>
          <div className="card">
            <div className="label">AVG PER PAYOUT</div>
            <div className="value glow" style={{ color: '#f7931a' }}>
              {avgPerPayment > 0 ? avgPerPayment.toLocaleString() : '—'}
            </div>
            <div className="unit">SATS</div>
          </div>
          <div className="card">
            <div className="label">AVG DAILY RATE</div>
            <div className="value glow" style={{ color: '#00cc66' }}>
              {avgPerDay > 0 ? avgPerDay.toLocaleString() : '—'}
            </div>
            <div className="unit">SATS/DAY</div>
          </div>
        </div>
      )}

      {/* Monthly summary */}
      {data && data.monthly_summary.length > 0 && (
        <div className="card" style={{ animation: 'stagger-in 0.4s ease-out 0.15s both' }}>
          <div className="label" style={{ marginBottom: '12px' }}>MONTHLY BREAKDOWN</div>
          <div className="table-scroll" role="region" aria-label="Monthly earnings" tabIndex={0}>
            <table style={{ minWidth: '560px', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th>MONTH</th>
                  <th>PAYOUTS</th>
                  <th>SATS</th>
                  <th>BTC</th>
                  <th style={{ textAlign: 'right' }}>FIAT ({data.currency})</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_summary.map((m, i) => {
                  const barPct = maxMonthlySats > 0 ? (m.sats / maxMonthlySats) * 100 : 0;
                  return (
                    <tr key={m.month}>
                      <td style={{ color: 'var(--primary)', fontFamily: 'var(--font-vt323)', fontSize: '16px' }}>
                        {m.month}
                      </td>
                      <td>{m.count}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: 'var(--color-success)', minWidth: '80px' }}>
                            {m.sats.toLocaleString()}
                          </span>
                          <div style={{
                            height: '6px',
                            width: `${barPct}%`,
                            maxWidth: '120px',
                            background: i === 0 ? 'var(--primary)' : 'var(--color-success)',
                            borderRadius: '3px',
                            boxShadow: `0 0 4px ${i === 0 ? 'var(--primary-glow)' : 'rgba(0,204,102,0.3)'}`,
                            opacity: 0.7,
                          }} />
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{m.btc.toFixed(8)}</td>
                      <td style={{ textAlign: 'right', color: '#f7931a' }}>
                        {m.fiat > 0 ? formatFiat(m.fiat) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="card" style={{ animation: 'stagger-in 0.4s ease-out 0.25s both' }}>
        <div className="label" style={{ marginBottom: '12px' }}>PAYMENT HISTORY</div>
        {loading && !data ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
            <span className="glow" style={{ fontFamily: 'var(--font-vt323)', fontSize: '20px' }}>
              LOADING EARNINGS DATA...▌
            </span>
          </div>
        ) : error ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
            ERROR: {error}
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
            <span style={{ fontFamily: 'var(--font-vt323)', fontSize: '18px' }}>
              {data?.data_status === 'partial' ? 'NO PAYMENTS LOADED — HISTORY IS INCOMPLETE' : `NO PAYMENTS IN ${displayedDays}-DAY WINDOW`}
            </span>
          </div>
        ) : (
          <div className="table-scroll" role="region" aria-label="Payment history" tabIndex={0}>
            <table style={{ minWidth: '800px', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>AMOUNT (SATS)</th>
                  <th>BTC</th>
                  <th style={{ textAlign: 'right' }}>FIAT VALUE</th>
                  <th>TYPE</th>
                  <th>TRANSACTION</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const link = txLink(p.txid, p.lightning_txid);
                  const isLightning = Boolean(p.lightning_txid && !p.txid);
                  return (
                    <tr
                      key={p.txid || p.lightning_txid || `${p.date}-${i}`}
                      style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
                    >
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {p.date}
                      </td>
                      <td style={{ color: 'var(--color-success)', fontFamily: 'var(--font-vt323)', fontSize: '16px' }}>
                        {p.amount_sats.toLocaleString()}
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{p.amount_btc.toFixed(8)}</td>
                      <td style={{ textAlign: 'right', color: '#f7931a' }}>
                        {p.fiat_value ? formatFiat(p.fiat_value) : '—'}
                      </td>
                      <td style={{ fontSize: '11px', whiteSpace: 'nowrap', color: isLightning ? '#ffd700' : 'var(--text-dim)' }}>
                        {isLightning ? '⚡ LIGHTNING' : '⛓ ON-CHAIN'}
                      </td>
                      <td>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--primary)',
                              textDecoration: 'none',
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {(p.txid || p.lightning_txid).slice(0, 8)}…{(p.txid || p.lightning_txid).slice(-6)}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {loading && data && (
          <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-dim)', fontSize: '11px' }}>
            Refreshing...
          </div>
        )}
      </div>
    </div>
  );
};
