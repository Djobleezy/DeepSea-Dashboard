import React from 'react';
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

  const renderSortableHeader = (col: string, label: string) => {
    const isActive = sortCol === col;
    return (
      <button
        type="button"
        onClick={() => onSort?.(col)}
        aria-label={`Sort by ${label}${isActive ? (sortDesc ? ', descending' : ', ascending') : ''}`}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {label}{sortArrow(col)}
      </button>
    );
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
            <th>{renderSortableHeader('name', 'WORKER')}</th>
            <th>{renderSortableHeader('status', 'STATUS')}</th>
            <th>{renderSortableHeader('hashrate', '3HR AVG')}</th>
            <th>{renderSortableHeader('hashrate_60sec', '60S')}</th>
            <th>MODEL</th>
            <th>{renderSortableHeader('efficiency', 'W/TH')}</th>
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
