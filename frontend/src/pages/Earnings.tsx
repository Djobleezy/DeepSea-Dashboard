import React, { useEffect, useState } from 'react';
import { fetchEarnings } from '../api/client';
import type { EarningsResponse } from '../types';

const SATS_PER_BTC = 100_000_000;

export const Earnings: React.FC = () => {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchEarnings(days);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load earnings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days]);

  const txLink = (txid: string, lightning_txid: string) => {
    if (txid) return `https://mempool.guide/tx/${txid}`;
    if (lightning_txid) return `https://mempool.guide/tx/${lightning_txid}`;
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>EARNINGS</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : ''}`}
              onClick={() => setDays(d)}
            >
              {d}D
            </button>
          ))}
          <button className="btn" onClick={load}>⟳</button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div className="card">
            <div className="label">TOTAL EARNED ({days}D)</div>
            <div className="value glow">{data.total_sats.toLocaleString()}</div>
            <div className="unit">SATS</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              {data.total_btc.toFixed(8)} BTC
            </div>
          </div>
          <div className="card">
            <div className="label">TOTAL PAYMENTS</div>
            <div className="value glow">{data.payments.length}</div>
          </div>
          <div className="card">
            <div className="label">CURRENCY</div>
            <div className="value glow">{data.currency}</div>
          </div>
        </div>
      )}

      {/* Monthly summary */}
      {data && data.monthly_summary.length > 0 && (
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>MONTHLY SUMMARY</div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>MONTH</th>
                  <th>PAYMENTS</th>
                  <th>SATS</th>
                  <th>BTC</th>
                  <th>FIAT ({data.currency})</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_summary.map((m) => (
                  <tr key={m.month}>
                    <td style={{ color: 'var(--primary)' }}>{m.month}</td>
                    <td>{m.count}</td>
                    <td>{m.sats.toLocaleString()}</td>
                    <td>{m.btc.toFixed(8)}</td>
                    <td>{m.fiat > 0 ? `$${m.fiat.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px' }}>
          <div className="label" style={{ marginBottom: '12px' }}>PAYMENT HISTORY</div>
          {loading ? (
            <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
              LOADING...
            </div>
          ) : error ? (
            <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
              {error}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>AMOUNT (SATS)</th>
                  <th>BTC</th>
                  <th>FIAT</th>
                  <th>TXID</th>
                </tr>
              </thead>
              <tbody>
                {(data?.payments ?? []).map((p, i) => {
                  const link = txLink(p.txid, p.lightning_txid);
                  return (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{p.date}</td>
                      <td style={{ color: 'var(--primary)' }}>{p.amount_sats.toLocaleString()}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{p.amount_btc.toFixed(8)}</td>
                      <td>{p.fiat_value ? `$${p.fiat_value.toFixed(2)}` : '—'}</td>
                      <td>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '11px' }}
                          >
                            {(p.txid || p.lightning_txid).slice(0, 16)}…
                          </a>
                        ) : '—'}
                        {p.lightning_txid && !p.txid && (
                          <span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--text-dim)' }}>⚡</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(data?.payments ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center" style={{ color: 'var(--text-dim)', padding: '24px' }}>
                      NO PAYMENTS FOUND
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
