import React, { useState } from 'react';
import { useWorkers } from '../hooks/useWorkers';
import { WorkerTable } from '../components/WorkerTable';

type StatusFilter = 'all' | 'online' | 'offline';

export const Workers: React.FC = () => {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortDesc, setSortDesc] = useState(false);

  const { workers, loading, error, refresh } = useWorkers(status, sortBy, sortDesc);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDesc((d) => !d);
    } else {
      setSortBy(col);
      setSortDesc(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>WORKER FLEET</h1>
        <button className="btn" onClick={refresh}>⟳ REFRESH</button>
      </div>

      {/* Summary */}
      {workers && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div className="card">
            <div className="label">TOTAL WORKERS</div>
            <div className="value glow">{workers.workers_total}</div>
          </div>
          <div className="card">
            <div className="label">ONLINE</div>
            <div className="value glow" style={{ color: 'var(--color-success)', textShadow: '0 0 8px var(--color-success)' }}>
              {workers.workers_online}
            </div>
          </div>
          <div className="card">
            <div className="label">OFFLINE</div>
            <div className="value glow" style={{ color: workers.workers_offline > 0 ? 'var(--color-error)' : 'var(--text-dim)', textShadow: workers.workers_offline > 0 ? '0 0 8px var(--color-error)' : 'none' }}>
              {workers.workers_offline}
            </div>
          </div>
          <div className="card">
            <div className="label">TOTAL HASHRATE</div>
            <div className="value glow">{workers.total_hashrate.toFixed(2)}</div>
            <div className="unit">{workers.hashrate_unit}</div>
          </div>
        </div>
      )}

      {/* Filter buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
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

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
            LOADING WORKERS...
          </div>
        ) : error ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
            ERROR: {error}
          </div>
        ) : (
          <WorkerTable
            workers={workers?.workers ?? []}
            onSort={handleSort}
            sortCol={sortBy}
            sortDesc={sortDesc}
          />
        )}
      </div>
    </div>
  );
};
