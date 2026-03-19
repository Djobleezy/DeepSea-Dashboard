import React, { useEffect, useState, useCallback } from 'react';
import { fetchEarnings } from '../api/client';
import { useAppStore } from '../stores/store';
import type { EarningsResponse } from '../types';

const SATS_PER_BTC = 100_000_000;

export const Earnings: React.FC = () => {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const metrics = useAppStore((s) => s.metrics);
  const btcPrice = metrics?.btc_price ?? 0;

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetchEarnings(d);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load earnings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const txLink = (txid: string, lightning_txid: string) => {
    if (txid) return `https://mempool.space/tx/${txid}`;
    if (lightning_txid) return `https://mempool.space/tx/${lightning_txid}`;
    return null;
  };

  const payments = data?.payments ?? [];
  const totalSats = data?.total_sats ?? 0;
  const totalBtc = data?.total_btc ?? 0;
  const avgPerPayment = payments.length > 0 ? Math.round(totalSats / payments.length) : 0;
  const avgPerDay = days > 0 ? Math.round(totalSats / days) : 0;

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
          <button className="btn" onClick={() => load(days)}>⟳</button>
        </div>
      </div>

      {/* Summary cards — always show, even while loading new period */}
      {data && (
        <div className="grid-4">
          <div className="card">
            <div className="label">TOTAL EARNED</div>
            <div className="value glow" style={{ color: 'var(--color-success)' }}>
              {totalSats.toLocaleString()}
            </div>
            <div className="unit">SATS</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
              ₿ {totalBtc.toFixed(8)}
              {btcPrice > 0 && (
                <span> · ${(totalBtc * btcPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="label">PAYMENTS ({days}D)</div>
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
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>MONTHLY BREAKDOWN</div>
          <div style={{ overflowX: 'auto' }}>
            <table>
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
                  const maxSats = Math.max(...data.monthly_summary.map((x) => x.sats));
                  const barPct = maxSats > 0 ? (m.sats / maxSats) * 100 : 0;
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
                        {m.fiat > 0 ? `$${m.fiat.toFixed(2)}` : '—'}
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
      <div className="card">
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
              NO PAYMENTS IN {days}-DAY WINDOW
            </span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>AMOUNT (SATS)</th>
                  <th>BTC</th>
                  <th style={{ textAlign: 'right' }}>FIAT VALUE</th>
                  <th>TRANSACTION</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const link = txLink(p.txid, p.lightning_txid);
                  return (
                    <tr key={i} style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {p.date}
                      </td>
                      <td style={{ color: 'var(--color-success)', fontFamily: 'var(--font-vt323)', fontSize: '16px' }}>
                        {p.amount_sats.toLocaleString()}
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{p.amount_btc.toFixed(8)}</td>
                      <td style={{ textAlign: 'right', color: '#f7931a' }}>
                        {p.fiat_value ? `$${p.fiat_value.toFixed(2)}` : '—'}
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
                            {p.lightning_txid && !p.txid && ' ⚡'}
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
