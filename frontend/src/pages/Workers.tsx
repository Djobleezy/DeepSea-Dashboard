import React, { useState, useMemo, useCallback } from 'react';
import { useWorkers } from '../hooks/useWorkers';
import { useAppStore } from '../stores/store';
import { StaggerChildren } from '../components/StaggerChildren';
import type { Worker } from '../types';

type StatusFilter = 'all' | 'online' | 'offline';

// ── Per-worker overrides stored in localStorage ─────────────────────────────
const OVERRIDES_KEY = 'workerPowerOverrides';
const MAX_OVERRIDE_ENTRIES = 500;
const MAX_OVERRIDE_BYTES = 256 * 1024;

interface WorkerOverride {
  efficiency?: number; // W/TH
  powerConsumption?: number; // watts
}
type OverrideMap = Record<string, WorkerOverride>;

function sanitizeOverrides(input: unknown): OverrideMap {
  if (!input || typeof input !== 'object') return {};

  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([name, value]) => {
      if (!name || typeof name !== 'string' || typeof value !== 'object' || value === null) return false;
      const candidate = value as WorkerOverride;
      const effValid = candidate.efficiency === undefined || (Number.isFinite(candidate.efficiency) && candidate.efficiency > 0 && candidate.efficiency <= 200);
      const powerValid = candidate.powerConsumption === undefined || (Number.isFinite(candidate.powerConsumption) && candidate.powerConsumption >= 0 && candidate.powerConsumption <= 50_000);
      return effValid && powerValid;
    })
    .slice(-MAX_OVERRIDE_ENTRIES);

  return entries.reduce<OverrideMap>((acc, [name, value]) => {
    acc[name] = value as WorkerOverride;
    return acc;
  }, {});
}

function loadOverrides(): OverrideMap {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    return sanitizeOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

function saveOverrides(m: OverrideMap) {
  try {
    const limited = sanitizeOverrides(m);
    const serialized = JSON.stringify(limited);
    if (serialized.length > MAX_OVERRIDE_BYTES) {
      console.warn('[Workers] Overrides payload exceeded storage cap, dropping oldest entries.');
      const trimmed = Object.fromEntries(Object.entries(limited).slice(-Math.floor(MAX_OVERRIDE_ENTRIES / 2)));
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(OVERRIDES_KEY, serialized);
  } catch (e) {
    console.warn('[Workers] Failed to persist overrides', e);
  }
}

// ── Fleet-level power cost stored in localStorage ───────────────────────────
const POWER_COST_KEY = 'fleetPowerCostPerKwh';
function loadPowerCost(): number {
  try {
    const v = localStorage.getItem(POWER_COST_KEY);
    return v ? parseFloat(v) : 0.12;
  } catch { return 0.12; }
}
function savePowerCost(v: number) {
  localStorage.setItem(POWER_COST_KEY, String(v));
}

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

// ── Worker Card ─────────────────────────────────────────────────────────────
const WorkerCard: React.FC<{
  worker: Worker;
  maxHashrate: number;
  btcPrice: number;
  powerCost: number;
  override?: WorkerOverride;
  onOverride: (name: string, o: WorkerOverride | undefined) => void;
}> = ({ worker, maxHashrate, btcPrice, powerCost, override, onOverride }) => {
  const [editing, setEditing] = useState(false);
  const efficiencyInputId = `worker-efficiency-${worker.name.replace(/\s+/g, '-').toLowerCase()}`;
  const powerInputId = `worker-power-${worker.name.replace(/\s+/g, '-').toLowerCase()}`;
  const isOnline = worker.status === 'online';
  const hrPct = maxHashrate > 0 ? Math.min(100, (worker.hashrate_3hr / maxHashrate) * 100) : 0;
  const earningsSats = Math.floor(worker.earnings * 1e8);
  const earningsFiat = worker.earnings * btcPrice;

  // Apply overrides
  const efficiency = override?.efficiency ?? worker.efficiency;
  const powerWatts = override?.powerConsumption ?? (
    efficiency > 0 && worker.hashrate_3hr > 0 ? Math.round(worker.hashrate_3hr * efficiency) : worker.power_consumption
  );
  const dailyPowerCost = (powerWatts / 1000) * 24 * powerCost;
  const dailyProfit = earningsFiat - dailyPowerCost;
  const hasOverride = override?.efficiency !== undefined || override?.powerConsumption !== undefined;

  return (
    <div
      className="card"
      style={{
        borderColor: isOnline ? (hasOverride ? 'var(--primary)' : 'var(--border)') : 'var(--color-error)',
        opacity: isOnline ? 1 : 0.7,
        transition: 'all 0.3s',
      }}
    >
      {/* Header row */}
      <div className="flex justify-between items-center" style={{ marginBottom: '10px' }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-vt323)', fontSize: '22px',
            color: 'var(--primary)', textShadow: '0 0 8px var(--primary-glow)',
          }}>
            {worker.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{worker.model}</div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            className="btn"
            onClick={() => setEditing(!editing)}
            style={{ fontSize: '11px', padding: '2px 8px', opacity: 0.7 }}
            title="Adjust power settings"
            aria-expanded={editing}
            aria-controls={`${efficiencyInputId}-panel`}
            aria-label={editing ? `Close power settings for ${worker.name}` : `Adjust power settings for ${worker.name}`}
          >
            {editing ? '✕' : '⚙'}
          </button>
          <span className={`badge badge-${worker.status}`}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block',
              background: isOnline ? 'var(--color-success)' : 'var(--color-error)',
              boxShadow: isOnline ? '0 0 6px var(--color-success)' : 'none',
              animation: isOnline ? 'pulse-glow 2s infinite' : 'none',
            }} />
            {worker.status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div
          id={`${efficiencyInputId}-panel`}
          style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '10px',
            marginBottom: '12px', border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '8px' }}>
            POWER SETTINGS {hasOverride && <span style={{ color: 'var(--primary)' }}>(CUSTOM)</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label htmlFor={efficiencyInputId} style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Efficiency (W/TH)</label>
              <input
                id={efficiencyInputId}
                type="number" step="0.5" min="0" max="200"
                aria-describedby={`${efficiencyInputId}-hint`}
                value={efficiency > 0 ? efficiency : ''}
                placeholder={String(worker.efficiency || 30)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) {
                    const newPower = Math.round(worker.hashrate_3hr * v);
                    onOverride(worker.name, { efficiency: v, powerConsumption: newPower });
                  }
                }}
                style={{ width: '100%', fontSize: '14px', padding: '4px 8px' }}
              />
              <div id={`${efficiencyInputId}-hint`} style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>
                Enter an efficiency value between 0 and 200 W/TH.
              </div>
            </div>
            <div>
              <label htmlFor={powerInputId} style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Power (Watts)</label>
              <input
                id={powerInputId}
                type="number" step="10" min="0" max="50000"
                aria-describedby={`${powerInputId}-hint`}
                value={powerWatts > 0 ? powerWatts : ''}
                placeholder={String(worker.power_consumption || 0)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0) {
                    const newEff = worker.hashrate_3hr > 0 ? v / worker.hashrate_3hr : 0;
                    onOverride(worker.name, { powerConsumption: v, efficiency: Math.round(newEff * 10) / 10 });
                  }
                }}
                style={{ width: '100%', fontSize: '14px', padding: '4px 8px' }}
              />
              <div id={`${powerInputId}-hint`} style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>
                Enter power consumption between 0 and 50,000 watts.
              </div>
            </div>
          </div>
          {hasOverride && (
            <button
              className="btn"
              onClick={() => onOverride(worker.name, undefined)}
              style={{ marginTop: '8px', fontSize: '11px', padding: '2px 10px', opacity: 0.7 }}
            >
              RESET TO AUTO-DETECT
            </button>
          )}
        </div>
      )}

      {/* Hashrate bar */}
      <div style={{ marginBottom: '12px' }}>
        <div className="flex justify-between" style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '4px' }}>
          <span>3HR AVG</span>
          <span style={{ color: 'var(--primary)', textShadow: '0 0 6px var(--primary-glow)' }}>
            {fmtHashrate(worker.hashrate_3hr)}
          </span>
        </div>
        <div className="progress-bar" style={{ height: '8px' }}>
          <div className="progress-fill" style={{ width: `${hrPct}%`, transition: 'width 0.6s ease' }} />
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>60s</div>
          <div style={{ color: 'var(--text)' }}>{fmtHashrate(worker.hashrate_60sec)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>
            Efficiency {hasOverride && '✎'}
          </div>
          <div style={{ color: hasOverride ? 'var(--primary)' : 'var(--text)' }}>
            {efficiency > 0 ? `${efficiency.toFixed(1)} W/TH` : '—'}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Earnings</div>
          <div style={{ color: 'var(--color-success)', textShadow: '0 0 4px rgba(0,204,102,0.3)' }}>
            {earningsSats.toLocaleString()} sats
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Fiat Value</div>
          <div style={{ color: 'var(--color-success)' }}>${earningsFiat.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>
            Power {hasOverride && '✎'}
          </div>
          <div style={{ color: 'var(--color-warning)' }}>{fmtPower(powerWatts)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Cost/Day</div>
          <div style={{ color: 'var(--color-error)' }}>${dailyPowerCost.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Profit/Day</div>
          <div style={{ color: dailyProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
            {dailyProfit >= 0 ? '+' : ''}${dailyProfit.toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>Last Share</div>
          <div style={{ color: 'var(--primary)' }}>{worker.last_share || '—'}</div>
        </div>
      </div>
    </div>
  );
};

export const Workers: React.FC = () => {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<OverrideMap>(loadOverrides);
  const [powerCost, setPowerCost] = useState(loadPowerCost);
  const [showPowerSettings, setShowPowerSettings] = useState(false);
  const metrics = useAppStore((s) => s.metrics);
  const btcPrice = metrics?.btc_price ?? 0;

  const { workers, loading, error, refresh } = useWorkers(status, 'hashrate_3hr', true);

  const handleOverride = useCallback((name: string, o: WorkerOverride | undefined) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (o === undefined) { delete next[name]; } else { next[name] = o; }
      saveOverrides(next);
      return next;
    });
  }, []);

  const handlePowerCostChange = useCallback((v: number) => {
    setPowerCost(v);
    savePowerCost(v);
  }, []);

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

  // Compute power with overrides applied
  const computeWorkerPower = useCallback((w: Worker) => {
    const ov = overrides[w.name];
    if (ov?.powerConsumption !== undefined) return ov.powerConsumption;
    if (ov?.efficiency !== undefined && w.hashrate_3hr > 0) return Math.round(w.hashrate_3hr * ov.efficiency);
    return w.power_consumption;
  }, [overrides]);

  const totalPower = useMemo(
    () => filtered.reduce((sum, w) => sum + computeWorkerPower(w), 0),
    [filtered, computeWorkerPower],
  );

  const totalDailyCost = (totalPower / 1000) * 24 * powerCost;
  const totalDailyEarningsFiat = (workers?.total_earnings ?? 0) * btcPrice;
  const totalDailyProfit = totalDailyEarningsFiat - totalDailyCost;
  const overrideCount = Object.keys(overrides).length;

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
        <div className="grid-4" style={{ animation: 'stagger-in 0.4s ease-out 0.05s both' }}>
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
              ~${totalDailyCost.toFixed(2)}/day @ ${powerCost.toFixed(2)}/kWh
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
        <div className="card" style={{ animation: 'stagger-in 0.4s ease-out 0.15s both' }}>
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

      {/* Fleet Power Settings */}
      <div className="card" style={{ animation: 'stagger-in 0.4s ease-out 0.25s both' }}>
        <button
          type="button"
          className="flex justify-between items-center"
          style={{ cursor: 'pointer', width: '100%', background: 'transparent', border: 0, padding: 0, color: 'inherit', textAlign: 'left' }}
          onClick={() => setShowPowerSettings(!showPowerSettings)}
          aria-expanded={showPowerSettings}
          aria-controls="fleet-power-settings-panel"
        >
          <span className="label">
            ⚡ FLEET POWER SETTINGS
            {overrideCount > 0 && (
              <span style={{ color: 'var(--primary)', marginLeft: '8px', fontSize: '12px' }}>
                {overrideCount} custom override{overrideCount !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '14px' }}>{showPowerSettings ? '▼' : '▶'}</span>
        </button>

        {showPowerSettings && (
          <div id="fleet-power-settings-panel" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Electricity Cost ($/kWh)</label>
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={powerCost}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) handlePowerCostChange(v); }}
                  style={{ width: '100%', fontSize: '16px', padding: '6px 10px', marginTop: '4px' }}
                />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Daily Cost</div>
                <div style={{ fontSize: '22px', color: 'var(--color-error)', fontFamily: 'var(--font-vt323)', marginTop: '4px' }}>
                  ${totalDailyCost.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Daily Profit</div>
                <div style={{
                  fontSize: '22px', fontFamily: 'var(--font-vt323)', marginTop: '4px',
                  color: totalDailyProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                  textShadow: totalDailyProfit >= 0 ? '0 0 8px rgba(0,204,102,0.3)' : '0 0 8px rgba(255,68,68,0.3)',
                }}>
                  {totalDailyProfit >= 0 ? '+' : ''}${totalDailyProfit.toFixed(2)}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.5' }}>
              Click ⚙ on any worker card to set custom efficiency (W/TH) or power draw (watts).
              Changes are saved locally and override the auto-detected values.
              All cost/profit calculations across the dashboard update automatically.
            </div>
            {overrideCount > 0 && (
              <button
                className="btn"
                onClick={() => { setOverrides({}); saveOverrides({}); }}
                style={{ alignSelf: 'flex-start', fontSize: '12px' }}
              >
                RESET ALL OVERRIDES ({overrideCount})
              </button>
            )}
          </div>
        )}
      </div>

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
        <StaggerChildren
          stagger={40}
          duration={350}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px',
          }}
        >
          {filtered.map((w) => (
            <WorkerCard
              key={w.name}
              worker={w}
              maxHashrate={maxHashrate}
              btcPrice={btcPrice}
              powerCost={powerCost}
              override={overrides[w.name]}
              onOverride={handleOverride}
            />
          ))}
        </StaggerChildren>
      )}
    </div>
  );
};
