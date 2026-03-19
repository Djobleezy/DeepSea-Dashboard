import React, { useState, useEffect } from 'react';
import { fetchBlocks } from '../api/client';
import { useAppStore } from '../stores/store';
import type { Block, BlocksResponse } from '../types';

const BLOCK_REWARD = 3.125; // current epoch

function fmtBtc(v: number, decimals = 5): string {
  return v.toFixed(decimals);
}

function fmtSats(btc: number): string {
  const sats = Math.floor(btc * 1e8);
  if (sats >= 1e6) return `${(sats / 1e6).toFixed(2)}M`;
  if (sats >= 1e3) return `${(sats / 1e3).toFixed(1)}K`;
  return sats.toLocaleString();
}

const BlockCard: React.FC<{ block: Block; btcPrice: number }> = ({ block, btcPrice }) => {
  const rewardUsd = block.reward_btc * btcPrice;
  const feePct = block.reward_btc > 0 ? (block.fees_btc / block.reward_btc) * 100 : 0;

  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${block.pool === 'Ocean.xyz' ? 'var(--primary)' : 'var(--text-dim)'}`,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: '8px' }}>
        <a
          href={`https://mempool.guide/block/${block.height}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-vt323)',
            fontSize: '24px',
            color: 'var(--primary)',
            textDecoration: 'none',
            textShadow: '0 0 8px var(--primary-glow)',
          }}
        >
          #{block.height.toLocaleString()}
        </a>
        <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
          {block.time_ago || block.timestamp.slice(0, 16)}
        </span>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '10px',
          fontSize: '13px',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Reward</div>
          <div style={{ color: 'var(--color-success)', textShadow: '0 0 4px rgba(0,204,102,0.3)' }}>
            ₿ {fmtBtc(block.reward_btc)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
            ${rewardUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Fees</div>
          <div style={{ color: 'var(--color-warning)' }}>
            ₿ {fmtBtc(block.fees_btc)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
            {feePct.toFixed(1)}% of reward
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>TXs</div>
          <div style={{ color: 'var(--text)' }}>
            {block.tx_count > 0 ? block.tx_count.toLocaleString() : '—'}
          </div>
        </div>
      </div>

      {/* Pool badge */}
      <div style={{ marginTop: '10px', borderTop: '1px solid rgba(0,85,170,0.15)', paddingTop: '8px' }}>
        <div className="flex justify-between items-center" style={{ fontSize: '12px' }}>
          <span style={{ color: 'var(--text-dim)' }}>POOL</span>
          <span
            className={block.pool === 'Ocean.xyz' ? 'badge badge-online' : 'badge'}
            style={{
              fontSize: '11px',
              ...(block.pool !== 'Ocean.xyz' ? { color: 'var(--text-dim)', borderColor: 'var(--border)' } : {}),
            }}
          >
            {block.pool === 'Ocean.xyz' ? '🌊 ' : ''}{block.pool}
          </span>
        </div>
        {block.miner_earnings_sats > 0 && (
          <div className="flex justify-between items-center" style={{ fontSize: '12px', marginTop: '4px' }}>
            <span style={{ color: 'var(--text-dim)' }}>YOUR EARNINGS</span>
            <span style={{ color: 'var(--color-success)' }}>
              {block.miner_earnings_sats.toLocaleString()} sats
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const Blocks: React.FC = () => {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const metrics = useAppStore((s) => s.metrics);
  const btcPrice = metrics?.btc_price ?? 0;

  async function load(p: number) {
    setLoading(true);
    try {
      const res = await fetchBlocks(p, 20);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load blocks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(page);
  }, [page]);

  // Block stats from the loaded data
  const blocks = data?.blocks ?? [];
  const oceanBlocks = blocks.filter((b) => b.pool === 'Ocean.xyz');
  const totalFees = blocks.reduce((sum, b) => sum + b.fees_btc, 0);
  const totalRewards = blocks.reduce((sum, b) => sum + b.reward_btc, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title */}
      <div className="flex justify-between items-center">
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>⛏ BLOCK EXPLORER</h1>
        <button className="btn" onClick={() => load(page)}>
          ⟳ REFRESH
        </button>
      </div>

      {/* Summary cards */}
      {metrics && (
        <div className="grid-4">
          <div className="card">
            <div className="label">LAST BLOCK</div>
            <div className="value glow" style={{ marginTop: '6px' }}>
              #{metrics.last_block_height.toLocaleString()}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px' }}>
              {metrics.last_block_time}
            </div>
          </div>
          <div className="card">
            <div className="label">BLOCKS FOUND (POOL)</div>
            <div className="value glow" style={{ marginTop: '6px' }}>
              {metrics.blocks_found}
            </div>
          </div>
          <div className="card">
            <div className="label">PAGE TOTAL REWARDS</div>
            <div className="value glow" style={{ marginTop: '6px', color: 'var(--color-success)', textShadow: '0 0 8px rgba(0,204,102,0.3)' }}>
              ₿ {fmtBtc(totalRewards, 3)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
              ${(totalRewards * btcPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="card">
            <div className="label">PAGE TOTAL FEES</div>
            <div className="value glow" style={{ marginTop: '6px', color: 'var(--color-warning)', textShadow: '0 0 8px rgba(255,170,0,0.3)' }}>
              ₿ {fmtBtc(totalFees, 5)}
            </div>
          </div>
        </div>
      )}

      {/* Block cards */}
      {loading ? (
        <div className="text-center" style={{ padding: '60px', color: 'var(--text-dim)' }}>
          <span className="glow" style={{ fontFamily: 'var(--font-vt323)', fontSize: '20px' }}>
            SCANNING BLOCKCHAIN...▌
          </span>
        </div>
      ) : error ? (
        <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
          ERROR: {error}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '16px',
          }}
        >
          {blocks.map((b) => (
            <BlockCard key={b.height} block={b} btcPrice={btcPrice} />
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex gap-1" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <button
          className="btn"
          disabled={page === 0}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          ← NEWER
        </button>
        <span
          style={{
            padding: '6px 16px',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-vt323)',
            fontSize: '18px',
          }}
        >
          PAGE {page + 1}
        </span>
        <button
          className="btn"
          disabled={blocks.length < 20}
          onClick={() => setPage(page + 1)}
        >
          OLDER →
        </button>
        {page > 0 && (
          <button className="btn" onClick={() => setPage(0)}>
            ⇥ LATEST
          </button>
        )}
      </div>
    </div>
  );
};
