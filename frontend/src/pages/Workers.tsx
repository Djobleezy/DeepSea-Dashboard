import React, { useState, useMemo } from 'react';
import { useWorkers } from '../hooks/useWorkers';
import { useAppStore } from '../stores/store';
import { ArrowIndicator } from '../components/ArrowIndicator';
import type { Worker } from '../types';

type StatusFilter = 'all' | 'online' | 'offline';

function fmtHashrate(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} PH/s`;
  if (v >= 1) return `${v.toFixed(1)} TH/s`;
  if (v >= 0.001) return `${(v * 1000).toFixed(1)} GH/s`;
  return `${v.toFixed(2)} TH/s`;
}

function fmtPower(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}

const WorkerCard: React.FC<{ worker: Worker; maxHashrate: number; btcPrice: number }> = ({
  worker,
  maxHashrate,
  btcPrice,
}) => {
  const isOnline = worker.status === 'online';
  const hrPct = maxHashrate > 0 ? Math.min(100, (worker.hashrate_3hr / maxHashrate) * 100) : 0;
  const earningsSats = Math.floor(worker.earnings * 1e8);
  const earningsFiat = worker.earnings * btcPrice;
  // Estimate daily power cost at $0.12/kWh
  const dailyPowerCost = (worker.power_consumption / 1000) * 24 * 0.12;

  return (
    <div
      className="card"
      style={{
        borderColor: isOnline ? 'var(--border)' : 'var(--color-error)',
        opacity: isOnline ? 1 : 0.7,
        transition: 'opacity 0.3s, border-color 0.3s',
      }}
    >
      {/* Header row */}
      <div className="flex justify-between items-center" style={{ marginBottom: '10px' }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-vt323)',
              fontSize: '22px',
              color: 'var(--primary)',
              textShadow: '0 0 8px var(--primary-glow)',
            }}
          >
            {worker.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{worker.model}</div>
        </div>
        <span className={`badge badge-${worker.status}`}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isOnline ? 'var(--color-success)' : 'var(--color-error)',
              display: 'inline-block',
              boxShadow: isOnline ? '0 0 6px var(--color-success)' : 'none',
              animation: isOnline ? 'pulse-glow 2s infinite' : 'none',
            }}
          />
          {worker.status.toUpperCase()}
        </span>
      </div>

      {/* Hashrate bar */}
      <div style={{ marginBottom: '12px' }}>
        <div className="flex justify-between" style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '4px' }}>
          <span>3HR AVG</span>
          <span style={{ color: 'var(--primary)', textShadow: '0 0 6px var(--primary-glow)' }}>
            {fmtHashrate(worker.hashrate_3hr)}
          </span>
        </div>
        <div className="progress-bar" style={{ height: '8px' }}>
          <div
            className="progress-fill"
            style={{
              width: `${hrPct}%`,
              transition: 'width 0.6s ease',
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          fontSize: '13px',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>60s</div>
          <div style={{ color: 'var(--text)' }}>{fmtHashrate(worker.hashrate_60sec)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Efficiency</div>
          <div style={{ color: 'var(--text)' }}>{worker.efficiency > 0 ? `${worker.efficiency.toFixed(1)} W/TH` : '—'}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Earnings</div>
          <div style={{ color: 'var(--color-success)', textShadow: '0 0 4px rgba(0,204,102,0.3)' }}>
            {earningsSats.toLocaleString()} sats
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Fiat Value</div>
          <div style={{ color: 'var(--color-success)' }}>
            ${earningsFiat.toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Power</div>
          <div style={{ color: 'var(--color-warning)' }}>{fmtPower(worker.power_consumption)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Cost/Day</div>
          <div style={{ color: 'var(--color-error)' }}>${dailyPowerCost.toFixed(2)}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Last Share</div>
          <div style={{ color: 'var(--primary)' }}>{worker.last_share || '—'}</div>
        </div>
      </div>

      {/* Acceptance rate bar at bottom */}
      {worker.acceptance_rate > 0 && (
        <div style={{ marginTop: '10px', borderTop: '1px solid rgba(0,85,170,0.15)', paddingTop: '8px' }}>
          <div className="flex justify-between" style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '3px' }}>
            <span>ACCEPTANCE</span>
            <span style={{ color: worker.acceptance_rate >= 99 ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {worker.acceptance_rate.toFixed(1)}%
            </span>
          </div>
          <div className="progress-bar" style={{ height: '4px' }}>
            <div
              className="progress-fill"
              style={{
                width: `${worker.acceptance_rate}%`,
                background: worker.acceptance_rate >= 99 ? 'var(--color-success)' : 'var(--color-warning)',
                boxShadow: `0 0 6px ${worker.acceptance_rate >= 99 ? 'var(--color-success)' : 'var(--color-warning)'}`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const Workers: React.FC = () => {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const metrics = useAppStore((s) => s.metrics);
  const btcPrice = metrics?.btc_price ?? 0;

  const { workers, loading, error, refresh } = useWorkers(status, 'hashrate_3hr', true);

  // Filtered + searched workers
  const filtered = useMemo(() => {
    if (!workers?.workers) return [];
    if (!search) return workers.workers;
    const q = search.toLowerCase();
    return workers.workers.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        w.type.toLowerCase().includes(q),
    );
  }, [workers, search]);

  const maxHashrate = useMemo(
    () => Math.max(...(filtered.map((w) => w.hashrate_3hr) || [1]), 1),
    [filtered],
  );

  // Fleet composition breakdown
  const modelCounts = useMemo(() => {
    const map: Record<string, { count: number; totalHr: number }> = {};
    for (const w of filtered) {
      const m = w.model || 'Unknown';
      if (!map[m]) map[m] = { count: 0, totalHr: 0 };
      map[m].count++;
      map[m].totalHr += w.hashrate_3hr;
    }
    return Object.entries(map).sort((a, b) => b[1].totalHr - a[1].totalHr);
  }, [filtered]);

  const totalPower = useMemo(
    () => filtered.reduce((sum, w) => sum + w.power_consumption, 0),
    [filtered],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title */}
      <div className="flex justify-between items-center">
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>WORKER FLEET</h1>
        <button className="btn" onClick={refresh}>
          ⟳ REFRESH
        </button>
      </div>

      {/* Summary cards */}
      {workers && (
        <div className="grid-4">
          <div className="card" style={{ textAlign: 'center' }}>
            {/* Online ring */}
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                margin: '0 auto 8px',
                background: `conic-gradient(
                  var(--color-success) ${((workers.workers_online / (workers.workers_total || 1)) * 360)}deg,
                  rgba(255,68,68,0.3) 0deg
                )`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(0,204,102,0.3)',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="value glow" style={{ fontSize: '28px' }}>{workers.workers_total}</span>
              </div>
            </div>
            <div className="label">WORKERS</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              <span style={{ color: 'var(--color-success)' }}>{workers.workers_online} online</span>
              {workers.workers_offline > 0 && (
                <span style={{ color: 'var(--color-error)', marginLeft: '8px' }}>{workers.workers_offline} offline</span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="label">TOTAL HASHRATE</div>
            <div className="value glow" style={{ marginTop: '6px' }}>
              {fmtHashrate(workers.total_hashrate)}
            </div>
          </div>

          <div className="card">
            <div className="label">EST. POWER DRAW</div>
            <div className="value glow" style={{ marginTop: '6px', color: 'var(--color-warning)', textShadow: '0 0 8px rgba(255,170,0,0.4)' }}>
              {fmtPower(totalPower)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
              ~${((totalPower / 1000) * 24 * 0.12).toFixed(2)}/day
            </div>
          </div>

          <div className="card">
            <div className="label">TOTAL EARNINGS</div>
            <div className="value glow" style={{ marginTop: '6px', color: 'var(--color-success)', textShadow: '0 0 8px rgba(0,204,102,0.3)' }}>
              {Math.floor((workers.total_earnings ?? 0) * 1e8).toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
              SATS
            </div>
          </div>
        </div>
      )}

      {/* Fleet composition */}
      {modelCounts.length > 1 && (
        <div className="card">
          <div className="label" style={{ marginBottom: '10px' }}>FLEET COMPOSITION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {modelCounts.map(([model, { count, totalHr }]) => {
              const pct = maxHashrate > 0 ? (totalHr / (workers?.total_hashrate || 1)) * 100 : 0;
              return (
                <div key={model} className="flex items-center gap-2" style={{ fontSize: '13px' }}>
                  <span style={{ minWidth: '180px', color: 'var(--text)' }}>{model}</span>
                  <span style={{ minWidth: '30px', color: 'var(--text-dim)', textAlign: 'right' }}>×{count}</span>
                  <div className="progress-bar" style={{ flex: 1, height: '6px' }}>
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span style={{ minWidth: '80px', textAlign: 'right', color: 'var(--primary)' }}>
                    {fmtHashrate(totalHr)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search workers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '280px' }}
        />
        <div className="flex gap-1">
          {(['all', 'online', 'offline'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={`btn ${status === s ? 'btn-primary' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-dim)', marginLeft: 'auto' }}>
          {filtered.length} worker{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Worker cards grid */}
      {loading ? (
        <div className="text-center" style={{ padding: '60px', color: 'var(--text-dim)' }}>
          <span className="glow" style={{ fontFamily: 'var(--font-vt323)', fontSize: '20px' }}>
            SCANNING FLEET...▌
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px',
          }}
        >
          {filtered.map((w) => (
            <WorkerCard key={w.name} worker={w} maxHashrate={maxHashrate} btcPrice={btcPrice} />
          ))}
        </div>
      )}
    </div>
  );
};
