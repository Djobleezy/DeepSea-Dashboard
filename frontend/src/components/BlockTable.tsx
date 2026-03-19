import React from 'react';
import type { Block } from '../types';

interface Props {
  blocks: Block[];
  page: number;
  onPageChange: (p: number) => void;
  hasMore: boolean;
}

export const BlockTable: React.FC<Props> = ({
  blocks,
  page,
  onPageChange,
  hasMore,
}) => {
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>HEIGHT</th>
              <th>AGE</th>
              <th>TXs</th>
              <th>FEES (BTC)</th>
              <th>REWARD</th>
              <th>POOL</th>
            </tr>
          </thead>
          <tbody>
            {blocks.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center" style={{ color: 'var(--text-dim)', padding: '24px' }}>
                  NO BLOCKS
                </td>
              </tr>
            ) : (
              blocks.map((b) => (
                <tr key={b.height}>
                  <td>
                    <a
                      href={`https://mempool.guide/block/${b.height}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--primary)', textDecoration: 'none', textShadow: '0 0 6px var(--primary-glow)' }}
                    >
                      #{b.height.toLocaleString()}
                    </a>
                  </td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{b.time_ago || b.timestamp.slice(0, 16)}</td>
                  <td>{b.tx_count.toLocaleString()}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{b.fees_btc.toFixed(5)}</td>
                  <td style={{ color: 'var(--primary)' }}>{b.reward_btc.toFixed(5)}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{b.pool}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-1 mt-2" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn"
          disabled={page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          ← NEWER
        </button>
        <span style={{ padding: '6px 12px', color: 'var(--text-dim)', fontSize: '12px' }}>
          PAGE {page + 1}
        </span>
        <button
          className="btn"
          disabled={!hasMore}
          onClick={() => onPageChange(page + 1)}
        >
          OLDER →
        </button>
        {page > 0 && (
          <button className="btn" onClick={() => onPageChange(0)}>
            LATEST
          </button>
        )}
      </div>
    </div>
  );
};
