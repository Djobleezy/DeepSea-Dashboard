import React, { useState } from 'react';
import type { Worker } from '../types';

interface Props {
  workers: Worker[];
  onSort?: (col: string) => void;
  sortCol?: string;
  sortDesc?: boolean;
}

export const WorkerTable: React.FC<Props> = ({
  workers,
  onSort,
  sortCol = 'name',
  sortDesc = false,
}) => {
  const sortArrow = (col: string) => {
    if (sortCol !== col) return '';
    return sortDesc ? ' ▼' : ' ▲';
  };

  const fmt = (v: number) =>
    v >= 1000
      ? `${(v / 1000).toFixed(1)} PH/s`
      : `${v.toFixed(2)} TH/s`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th onClick={() => onSort?.('name')}>WORKER{sortArrow('name')}</th>
            <th onClick={() => onSort?.('status')}>STATUS{sortArrow('status')}</th>
            <th onClick={() => onSort?.('hashrate')}>3HR AVG{sortArrow('hashrate')}</th>
            <th onClick={() => onSort?.('hashrate_60sec')}>60S{sortArrow('hashrate_60sec')}</th>
            <th>MODEL</th>
            <th onClick={() => onSort?.('efficiency')}>W/TH{sortArrow('efficiency')}</th>
            <th>LAST SHARE</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center" style={{ color: 'var(--text-dim)', padding: '24px' }}>
                NO WORKERS FOUND
              </td>
            </tr>
          ) : (
            workers.map((w) => (
              <tr key={w.name}>
                <td style={{ fontFamily: 'var(--font-vt323)', fontSize: '16px' }}>
                  {w.name}
                </td>
                <td>
                  <span className={`badge badge-${w.status}`}>
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: w.status === 'online' ? 'var(--color-success)' : 'var(--color-error)',
                        display: 'inline-block',
                        boxShadow: w.status === 'online' ? '0 0 6px var(--color-success)' : 'none',
                      }}
                    />
                    {w.status}
                  </span>
                </td>
                <td style={{ color: 'var(--primary)', textShadow: '0 0 6px var(--primary-glow)' }}>
                  {fmt(w.hashrate_3hr)}
                </td>
                <td style={{ color: 'var(--text-dim)' }}>{fmt(w.hashrate_60sec)}</td>
                <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{w.model}</td>
                <td style={{ color: 'var(--text-dim)' }}>
                  {w.efficiency > 0 ? `${w.efficiency.toFixed(1)}` : '—'}
                </td>
                <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{w.last_share}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
