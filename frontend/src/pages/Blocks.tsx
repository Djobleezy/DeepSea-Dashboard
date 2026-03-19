import React, { useState, useEffect, useMemo, useId } from 'react';
import { fetchBlocks } from '../api/client';
import { useAppStore } from '../stores/store';
import { fmtHashrate } from '../utils/format';
import type { Block, BlocksResponse } from '../types';

// ── Pool colors ────────────────────────────────────────────────────────────
const POOL_COLORS: Record<string, string> = {
  'Foundry USA': '#e6194b',
  'AntPool': '#f58231',
  'F2Pool': '#3cb44b',
  'ViaBTC': '#4363d8',
  'Binance Pool': '#f0c929',
  'Luxor': '#9a6324',
  'SpiderPool': '#800000',
  'SBI Crypto': '#000075',
  'Ocean.xyz': '#00bfff',
  'MARA Pool': '#e6beff',
  'Braiins Pool': '#aaffc3',
  'Poolin': '#dcbeff',
  'BTC.com': '#fffac8',
  'EMCD': '#ffd8b1',
  'Titan': '#46f0f0',
  'SecPool': '#808000',
  'WhitePool': '#ffe119',
  'Ultimus Pool': '#42d4f4',
  'PEGA Pool': '#fabebe',
  'Unknown': '#808080',
};

function poolColor(name: string): string {
  return POOL_COLORS[name] || `hsl(${hashCode(name) % 360}, 60%, 55%)`;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Donut Chart ────────────────────────────────────────────────────────────
interface DonutSlice {
  pool: string;
  count: number;
  pct: number;
  color: string;
}

const PoolDonut: React.FC<{ slices: DonutSlice[]; total: number }> = ({ slices, total }) => {
  const uid = useId();
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const stroke = 28;

  let cumAngle = -90; // start from top

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {slices.map((s, i) => {
          const angle = (s.pct / 100) * 360;
          const startAngle = cumAngle;
          cumAngle += angle;
          const endAngle = cumAngle;

          const startRad = (startAngle * Math.PI) / 180;
          const endRad = (endAngle * Math.PI) / 180;
          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          const largeArc = angle > 180 ? 1 : 0;

          return (
            <path
              key={`${uid}-${i}`}
              d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              opacity={0.85}
            />
          );
        })}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill="var(--text)"
          fontFamily="var(--font-vt323)"
          fontSize="24"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fill="var(--text-dim)"
          fontFamily="var(--font-mono)"
          fontSize="10"
        >
          BLOCKS
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px' }}>
        {slices.slice(0, 10).map((s) => (
          <div key={s.pool} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                background: s.color,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span style={{ color: 'var(--text)' }}>{s.pool}</span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 'auto', paddingLeft: '8px' }}>
              {s.count} ({s.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
        {slices.length > 10 && (
          <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
            +{slices.length - 10} more pools
          </span>
        )}
      </div>
    </div>
  );
};

// ── Block Card ─────────────────────────────────────────────────────────────
const BlockCard: React.FC<{ block: Block; btcPrice: number }> = ({ block, btcPrice }) => {
  const rewardUsd = block.reward_btc * btcPrice;
  const feePct = block.reward_btc > 0 ? (block.fees_btc / block.reward_btc) * 100 : 0;
  const color = poolColor(block.pool);

  return (
    <div
      className="card"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: '8px' }}>
        <a
          href={`https://mempool.space/block/${block.hash || block.height}`}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '10px',
          fontSize: '13px',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>REWARD</div>
          <div style={{ color: 'var(--color-success)', textShadow: '0 0 4px rgba(0,204,102,0.3)' }}>
            ₿ {block.reward_btc.toFixed(5)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
            ${rewardUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>FEES</div>
          <div style={{ color: 'var(--color-warning)' }}>₿ {block.fees_btc.toFixed(5)}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{feePct.toFixed(1)}%</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>TXs</div>
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
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              color: color,
              textShadow: `0 0 6px ${color}40`,
              fontWeight: 600,
            }}
          >
            {block.pool === 'Ocean.xyz' ? '🌊 ' : ''}{block.pool}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────
export const Blocks: React.FC = () => {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // For the donut we fetch 100 blocks once
  const [donutBlocks, setDonutBlocks] = useState<Block[]>([]);
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

  // Fetch 100 blocks for donut chart on mount
  useEffect(() => {
    fetchBlocks(0, 100)
      .then((res) => setDonutBlocks(res.blocks))
      .catch(() => {});
  }, []);

  const blocks = data?.blocks ?? [];

  // Donut data
  const donutSlices = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of donutBlocks) {
      const name = b.pool || 'Unknown';
      counts[name] = (counts[name] || 0) + 1;
    }
    const total = donutBlocks.length || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([pool, count]) => ({
        pool,
        count,
        pct: (count / total) * 100,
        color: poolColor(pool),
      }));
  }, [donutBlocks]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="flex justify-between items-center">
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>⛏ BLOCK EXPLORER</h1>
        <button className="btn" onClick={() => load(page)}>⟳ REFRESH</button>
      </div>

      {/* Donut chart — last 100 blocks pool distribution */}
      {donutSlices.length > 0 && (
        <div className="card">
          <div className="label" style={{ marginBottom: '12px' }}>
            POOL DISTRIBUTION — LAST {donutBlocks.length} BLOCKS
          </div>
          <PoolDonut slices={donutSlices} total={donutBlocks.length} />
        </div>
      )}

      {/* Summary cards */}
      {metrics && (
        <div className="grid-4">
          <MetricCardSimple label="LAST BLOCK" value={`#${metrics.last_block_height.toLocaleString()}`} sub={metrics.last_block_time} />
          <MetricCardSimple label="BLOCKS FOUND" value={String(metrics.blocks_found)} />
          <MetricCardSimple label="PAGE REWARDS" value={`₿ ${blocks.reduce((s, b) => s + b.reward_btc, 0).toFixed(3)}`}
            sub={`$${(blocks.reduce((s, b) => s + b.reward_btc, 0) * btcPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <MetricCardSimple label="PAGE FEES" value={`₿ ${blocks.reduce((s, b) => s + b.fees_btc, 0).toFixed(5)}`} />
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
        <button className="btn" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>
          ← NEWER
        </button>
        <span style={{ padding: '6px 16px', fontFamily: 'var(--font-vt323)', fontSize: '18px', color: 'var(--text-dim)' }}>
          PAGE {page + 1}
        </span>
        <button className="btn" disabled={blocks.length < 20} onClick={() => setPage(page + 1)}>
          OLDER →
        </button>
        {page > 0 && (
          <button className="btn" onClick={() => setPage(0)}>⇥ LATEST</button>
        )}
      </div>
    </div>
  );
};

// Simple metric card for inline use
const MetricCardSimple: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="card">
    <div className="label">{label}</div>
    <div className="value glow" style={{ marginTop: '6px' }}>{value}</div>
    {sub && <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{sub}</div>}
  </div>
);
