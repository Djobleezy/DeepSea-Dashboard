import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useWorkers } from '../hooks/useWorkers';
import { useAppStore } from '../stores/store';
import { useCurrency } from '../hooks/useCurrency';
import { StaggerChildren } from '../components/StaggerChildren';
import { ASIC_MODELS, groupedModels } from '../data/asicModels';
import { fetchWorkerSettings, saveWorkerSettings, saveElectricityRate, fetchMetrics } from '../api/client';
import type { Worker } from '../types';
import type { WorkerOverrideData } from '../api/client';

type StatusFilter = 'all' | 'online' | 'offline';
interface WorkerOverride {
  efficiency?: number;
  powerConsumption?: number;
  asicId?: string;
}
type OverrideMap = Record<string, WorkerOverride>;

function decodeOverrides(data: Record<string, WorkerOverrideData>): OverrideMap {
  return Object.fromEntries(Object.entries(data).map(([name, o]) => [name, {
    asicId: o.asicId ?? undefined,
    efficiency: o.efficiency ?? undefined,
    powerConsumption: o.power ?? undefined,
  }]));
}
function encodeOverrides(overrides: OverrideMap): Record<string, WorkerOverrideData> {
  return Object.fromEntries(Object.entries(overrides).map(([name, o]) => [name, {
    asicId: o.asicId ?? null,
    efficiency: o.efficiency ?? null,
    power: o.powerConsumption ?? null,
  }]));
}
function fmtHashrate(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} PH/s`;
  if (v >= 1) return `${v.toFixed(1)} TH/s`;
  if (v >= 0.001) return `${(v * 1000).toFixed(1)} GH/s`;
  return `${v.toFixed(2)} TH/s`;
}
function fmtPower(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${w.toFixed(0)} W`;
}
const asicById = new Map(ASIC_MODELS.map((m) => [m.id, m]));
function resolveModel(worker: Worker, override?: WorkerOverride): string {
  return (override?.asicId && asicById.get(override.asicId)?.model) || worker.model;
}
function formatShare(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const WorkerCard: React.FC<{
  worker: Worker;
  maxHashrate: number;
  btcPrice: number;
  powerCost: number | null;
  override?: WorkerOverride;
  disabled: boolean;
  onSave: (name: string, value: WorkerOverride | undefined) => Promise<boolean>;
}> = ({ worker, maxHashrate, btcPrice, powerCost, override, disabled, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draftEfficiency, setDraftEfficiency] = useState('');
  const [draftPower, setDraftPower] = useState('');
  const [draftAsic, setDraftAsic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { formatFiat } = useCurrency();
  const id = `worker-${encodeURIComponent(worker.name)}`;
  const isOnline = worker.status === 'online';
  const efficiency = worker.efficiency;
  const power = worker.power_consumption;
  const dailyCost = powerCost === null ? null : (power / 1000) * 24 * powerCost;
  const dailyRevenue = worker.estimated_daily_btc === undefined || btcPrice <= 0 ? null : worker.estimated_daily_btc * btcPrice;
  const dailyProfit = dailyRevenue === null || dailyCost === null ? null : dailyRevenue - dailyCost;
  const hasOverride = override && Object.values(override).some(v => v !== undefined);

  const openEditor = () => {
    setDraftEfficiency(override?.efficiency === undefined ? '' : String(override.efficiency));
    setDraftPower(override?.powerConsumption === undefined ? '' : String(override.powerConsumption));
    setDraftAsic(override?.asicId ?? '');
    setError(null);
    setEditing(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const efficiency = draftEfficiency === '' ? undefined : Number(draftEfficiency);
    const power = draftPower === '' ? undefined : Number(draftPower);
    if (efficiency !== undefined && (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 200)) {
      setError('Efficiency must be greater than 0 and no more than 200 W/TH.'); return;
    }
    if (power !== undefined && (!Number.isFinite(power) || power < 0 || power > 50000)) {
      setError('Power must be between 0 and 50,000 watts.'); return;
    }
    const value = efficiency === undefined && power === undefined && !draftAsic ? undefined : {
      efficiency, powerConsumption: power, asicId: draftAsic || undefined,
    };
    setError(null);
    if (await onSave(worker.name, value)) setEditing(false);
    else setError('Not saved. Your previous settings are still active. Try again.');
  };

  return (
    <article className="card worker-card" aria-label={`Worker ${worker.name}`} style={{ borderColor: isOnline ? 'var(--border)' : 'var(--color-error)' }}>
      <div className="worker-card-header">
        <div className="worker-identity">
          <h2 className="worker-name">{worker.name}</h2>
          <div className="worker-model">{resolveModel(worker, override) || 'Unknown model'}{hasOverride ? ' · custom' : ''}</div>
        </div>
        <div className="worker-card-actions">
          <span className={`badge badge-${worker.status}`}>{worker.status.toUpperCase()}</span>
          <button className="btn" type="button" onClick={() => editing ? setEditing(false) : openEditor()}
            disabled={disabled} aria-expanded={editing} aria-controls={`${id}-settings`}
            aria-label={`${editing ? 'Close' : 'Adjust'} power settings for ${worker.name}`}>
            {editing ? '✕' : '⚙'}
          </button>
        </div>
      </div>
      {editing && (
        <form id={`${id}-settings`} className="worker-editor" onSubmit={submit}>
          <label htmlFor={`${id}-model`}>ASIC model</label>
          <select id={`${id}-model`} value={draftAsic} disabled={disabled} onChange={e => {
            const model = asicById.get(e.target.value);
            setDraftAsic(e.target.value);
            setDraftEfficiency(model ? String(model.efficiency) : '');
            setDraftPower('');
          }}>
            <option value="">Auto-detect</option>
            {Object.entries(groupedModels()).map(([brand, models]) => <optgroup key={brand} label={brand}>
              {models.map(m => <option key={m.id} value={m.id}>{m.model} · {m.efficiency} W/TH</option>)}
            </optgroup>)}
          </select>
          <div className="worker-editor-fields">
            <div><label htmlFor={`${id}-efficiency`}>Efficiency (W/TH)</label>
              <input id={`${id}-efficiency`} type="number" min="0.1" max="200" step="any" disabled={disabled}
                value={draftEfficiency} placeholder="Auto" onChange={e => { setDraftEfficiency(e.target.value); setDraftAsic(''); }} />
            </div>
            <div><label htmlFor={`${id}-power`}>Power (watts)</label>
              <input id={`${id}-power`} type="number" min="0" max="50000" step="any" disabled={disabled}
                value={draftPower} placeholder="Auto" onChange={e => { setDraftPower(e.target.value); setDraftAsic(''); }} />
            </div>
          </div>
          <p className="worker-help">Leave a field blank to use the detected value. Explicit power overrides calculated power; 0 W is allowed.</p>
          {error && <p role="alert" className="worker-save-error">{error}</p>}
          <div className="worker-editor-buttons">
            <button className="btn btn-primary" type="submit" disabled={disabled}>Save worker</button>
            <button className="btn" type="button" disabled={disabled} onClick={() => setEditing(false)}>Cancel</button>
            {hasOverride && <button className="btn" type="button" disabled={disabled} onClick={async () => {
              if (await onSave(worker.name, undefined)) setEditing(false);
              else setError('Not saved. Your previous settings are still active. Try again.');
            }}>Reset to auto</button>}
          </div>
        </form>
      )}
      <div className="worker-hashrate">
        <div className="flex justify-between"><span>3-hour average</span><strong>{fmtHashrate(worker.hashrate_3hr)}</strong></div>
        <div className="progress-bar" style={{ height: '6px', marginTop: '8px' }}>
          <div className="progress-fill" style={{ width: `${Math.min(100, worker.hashrate_3hr / maxHashrate * 100)}%` }} />
        </div>
      </div>
      <dl className="worker-stats">
        <div><dt>60-second rate</dt><dd>{fmtHashrate(worker.hashrate_60sec)}</dd></div>
        <div><dt>Efficiency</dt><dd>{efficiency > 0 ? `${efficiency.toFixed(1)} W/TH` : '—'}</dd></div>
        <div><dt>Unpaid balance</dt><dd>{Math.floor(worker.earnings * 1e8).toLocaleString()} sats</dd></div>
        <div><dt>Est. revenue/day</dt><dd>{dailyRevenue === null ? '—' : formatFiat(dailyRevenue)}</dd></div>
        <div><dt>Power draw</dt><dd>{fmtPower(power)}</dd></div>
        <div><dt>Cost/day</dt><dd>{dailyCost === null ? '—' : formatFiat(dailyCost)}</dd></div>
        <div><dt>Est. profit/day</dt><dd style={{ color: dailyProfit === null ? 'var(--text-dim)' : dailyProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
          {dailyProfit === null ? '—' : `${dailyProfit >= 0 ? '+' : '-'}${formatFiat(Math.abs(dailyProfit))}`}
        </dd></div>
        <div><dt>Last share</dt><dd>{formatShare(worker.last_share)}</dd></div>
      </dl>
    </article>
  );
};

export const Workers: React.FC = () => {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [powerCost, setPowerCost] = useState(0.12);
  const [rateDraft, setRateDraft] = useState('0.12');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [showPowerSettings, setShowPowerSettings] = useState(false);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const metrics = useAppStore(s => s.metrics);
  const setMetrics = useAppStore(s => s.setMetrics);
  const { formatFiat } = useCurrency();
  const { workers, loading, error, refresh } = useWorkers('all', 'hashrate_3hr', true);
  const priceAvailable = metrics !== null && Number.isFinite(metrics.btc_price) && metrics.btc_price > 0
    && metrics.data_status !== 'unavailable' && metrics.data_status !== 'unconfigured';
  const btcPrice = priceAvailable ? metrics.btc_price : 0;
  const dataUnavailable = workers?.data_status === 'unavailable' || workers?.data_status === 'unconfigured';
  const staleData = workers?.data_status === 'stale' || Boolean(error && workers);
  const lastUpdate = workers?.data_updated_at;
  const ageMinutes = lastUpdate ? Math.max(0, Math.floor((Date.now() / 1000 - lastUpdate) / 60)) : null;

  const loadSettings = useCallback(async () => {
    setSaveError(null);
    try {
      const data = await fetchWorkerSettings();
      if (!mounted.current) return;
      setOverrides(decodeOverrides(data.overrides));
      setPowerCost(data.electricity_rate);
      setRateDraft(String(data.electricity_rate));
      setSettingsLoaded(true);
    } catch {
      if (mounted.current) setSaveError('Could not load saved power settings. Retry before editing.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadSettings();
    return () => { mounted.current = false; };
  }, [loadSettings]);

  const refreshCalculations = async () => {
    await refresh();
    try {
      const updated = await fetchMetrics();
      if (mounted.current) setMetrics(updated);
    } catch { /* Existing metrics remain visible until the next refresh. */ }
  };
  const handleOverride = async (name: string | undefined, value: WorkerOverride | undefined) => {
    if (!settingsLoaded || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true); setSaveError(null); setSaveMessage('');
    const next = name === undefined ? {} : { ...overrides };
    if (name !== undefined) {
      if (value === undefined) delete next[name]; else next[name] = value;
    }
    try {
      const saved = await saveWorkerSettings(encodeOverrides(next));
      if (mounted.current) {
        setOverrides(decodeOverrides(saved.overrides));
        setPowerCost(saved.electricity_rate);
        setRateDraft(String(saved.electricity_rate));
        setSaveMessage(name === undefined ? 'All worker overrides reset.' : 'Worker settings saved.');
      }
      await refreshCalculations();
      return true;
    } catch {
      if (mounted.current) setSaveError('Worker settings were not saved. Your previous settings are still active. Try again.');
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const saveRate = async (event: React.FormEvent) => {
    event.preventDefault();
    const rate = Number(rateDraft);
    if (rateDraft.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 10) {
      setSaveError('Electricity cost must be between 0 and 10 USD/kWh.'); return;
    }
    if (!settingsLoaded || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setSaveError(null); setSaveMessage('');
    try {
      const saved = await saveElectricityRate(rate);
      if (mounted.current) {
        setPowerCost(saved.electricity_rate);
        setRateDraft(String(saved.electricity_rate));
        setSaveMessage('Electricity rate saved for the whole dashboard.');
      }
      await refreshCalculations();
    } catch {
      if (mounted.current) setSaveError('Electricity rate was not saved. Calculations still use your previous rate. Try again.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const allWorkers = useMemo(() => workers?.workers ?? [], [workers]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allWorkers.filter(w => (status === 'all' || w.status === status) && (!query ||
      [w.name, resolveModel(w, overrides[w.name]), w.type].some(value => value.toLowerCase().includes(query))));
  }, [allWorkers, search, status, overrides]);
  const maxHashrate = Math.max(1, ...filtered.map(w => w.hashrate_3hr));
  const modelCounts = useMemo(() => {
    const map: Record<string, { count: number; totalHr: number }> = {};
    for (const w of allWorkers) {
      const model = resolveModel(w, overrides[w.name]) || 'Unknown';
      map[model] ??= { count: 0, totalHr: 0 };
      map[model].count++; map[model].totalHr += w.hashrate_3hr;
    }
    return Object.entries(map).sort((a, b) => b[1].totalHr - a[1].totalHr);
  }, [allWorkers, overrides]);
  const totalPower = workers?.total_power_watts ?? allWorkers.reduce((sum, w) => sum + w.power_consumption, 0);
  const totalDailyCost = settingsLoaded ? totalPower / 1000 * 24 * powerCost : null;
  const dailyBtc = dataUnavailable ? undefined : workers?.total_daily_earnings_btc;
  const dailyRevenue = dailyBtc === undefined || !priceAvailable ? null : dailyBtc * btcPrice;
  const dailyProfit = dailyRevenue === null || totalDailyCost === null ? null : dailyRevenue - totalDailyCost;
  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="worker-page">
      <style>{`
        .worker-page{display:flex;flex-direction:column;gap:20px;min-width:0}
        .worker-page-heading,.worker-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
        .worker-page-heading h1{font-size:32px;letter-spacing:3px}
        .worker-page .btn{min-height:36px}
        .worker-page .label{letter-spacing:1.2px}
        .worker-identity{min-width:0;flex:1 1 100%}
        .worker-name{font-size:24px;line-height:1.2;overflow-wrap:anywhere}
        .worker-model{font-size:13px;color:var(--text-dim);margin-top:5px;overflow-wrap:anywhere}
        .worker-card-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:nowrap;width:100%}
        .worker-card-actions .badge{white-space:nowrap;flex-shrink:0}
        .worker-editor{padding:12px;margin:14px 0;background:var(--bg);border:1px solid var(--border);border-radius:4px;display:flex;flex-direction:column;gap:8px}
        .worker-editor label,.worker-rate-form label{font-size:13px;color:var(--text)}
        .worker-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .worker-editor input,.worker-editor select{margin-top:4px}
        .worker-editor-buttons{display:flex;gap:8px;flex-wrap:wrap}
        .worker-help{font-size:13px;line-height:1.55;color:var(--text-dim)}
        .worker-save-error{color:var(--color-error)}
        .worker-hashrate{margin:16px 0;font-size:13px;color:var(--text-dim)}
        .worker-hashrate strong{color:var(--primary);font-weight:normal}
        .worker-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 10px;font-size:14px}
        .worker-stats dt{font-size:12px;color:var(--text-dim);margin-bottom:3px}
        .worker-stats dd{margin:0;overflow-wrap:anywhere}
        .worker-fleet-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;font-size:13px;align-items:center}
        .worker-fleet-row .progress-bar{grid-column:1/-1;height:5px}
        .worker-power-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;align-items:start}
        .worker-rate-form{display:flex;flex-direction:column;gap:8px;min-width:0}
        .worker-rate-form input{min-width:0}
        .worker-summary-value{font-family:var(--font-vt323);font-size:28px;line-height:1.2;margin-top:8px;overflow-wrap:anywhere}
        @media(max-width:420px){.worker-card-header{flex-direction:column}.worker-card-actions{width:100%;justify-content:space-between}.worker-identity{flex-basis:auto;width:100%}.worker-editor-fields{grid-template-columns:1fr}.worker-page-heading h1{font-size:28px;letter-spacing:2px}}
      `}</style>
      <div className="worker-page-heading"><div><h1>WORKER FLEET</h1><p className="worker-help">Live hashrate, saved power settings, and estimated daily returns.</p></div>
        <button className="btn" onClick={() => void refresh()}>⟳ Refresh</button></div>
      {(staleData || dataUnavailable || error) && <div className="card" role="status" style={{borderColor:'var(--color-warning)'}}>
        <strong>{workers?.data_status === 'unconfigured' ? 'Wallet setup required' : staleData ? 'Worker data is stale' : 'Worker data unavailable'}</strong>
        <p className="worker-help">{workers?.data_status === 'unconfigured' ? 'Add your mining wallet in Configuration to load workers.' : ageMinutes === null ? 'No successful worker update is available yet.' : `Showing the last successful update from ${ageMinutes < 1 ? 'less than a minute' : `${ageMinutes} minute${ageMinutes === 1 ? '' : 's'}`} ago. Live status and estimates may have changed.`}</p>
        {workers?.data_status === 'unconfigured' ? <a className="btn" href="/config">Open Configuration</a> : <button className="btn" onClick={() => void refresh()} style={{marginTop:8}}>Retry worker data</button>}
      </div>}
      {workers && <div className="grid-4">
        <div className="card"><div className="label">Workers online</div><div className="worker-summary-value">{workers.workers_online} / {workers.workers_total}</div><p className="worker-help">{workers.workers_offline} offline</p></div>
        <div className="card"><div className="label">Fleet hashrate</div><div className="worker-summary-value">{fmtHashrate(workers.total_hashrate)}</div><p className="worker-help">3-hour average</p></div>
        <div className="card"><div className="label">Est. power draw</div><div className="worker-summary-value">{fmtPower(totalPower)}</div><p className="worker-help">{totalDailyCost === null ? 'Loading saved electricity rate…' : `${formatFiat(totalDailyCost)}/day at $${powerCost.toFixed(2)}/kWh`}</p></div>
        <div className="card"><div className="label">Est. daily profit</div><div className="worker-summary-value" style={{color:dailyProfit === null ? 'var(--text-dim)' : dailyProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)'}}>
          {dailyProfit === null ? '—' : `${dailyProfit >= 0 ? '+' : '-'}${formatFiat(Math.abs(dailyProfit))}`}</div><p className="worker-help">{!priceAvailable ? 'Waiting for an available BTC price' : metrics?.data_status === 'stale' ? 'Estimate uses the last available BTC price' : 'Revenue less electricity · whole fleet'}</p></div>
      </div>}
      {modelCounts.length > 0 && <div className="card"><div className="label" style={{marginBottom:14}}>Fleet composition</div>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>{modelCounts.map(([model, data]) => <div key={model} className="worker-fleet-row">
          <span style={{overflowWrap:'anywhere'}}>{model} <span style={{color:'var(--text-dim)'}}>×{data.count}</span></span><span>{fmtHashrate(data.totalHr)}</span>
          <div className="progress-bar"><div className="progress-fill" style={{width:`${Math.min(100,data.totalHr / (workers?.total_hashrate || 1)*100)}%`}} /></div>
        </div>)}</div>
      </div>}
      <div className="card">
        <button type="button" className="flex justify-between items-center" style={{cursor:'pointer',width:'100%',background:'transparent',border:0,padding:0,color:'inherit',textAlign:'left',gap:12}}
          onClick={() => setShowPowerSettings(v => !v)} aria-expanded={showPowerSettings} aria-controls="fleet-power-settings-panel">
          <span className="label">⚡ Fleet power settings{overrideCount > 0 ? ` · ${overrideCount} custom` : ''}</span><span aria-hidden="true">{showPowerSettings ? '−' : '+'}</span>
        </button>
        {showPowerSettings && <div id="fleet-power-settings-panel" style={{marginTop:16}}>
          <div className="worker-power-grid">
            <form className="worker-rate-form" onSubmit={saveRate} noValidate>
              <label htmlFor="fleet-electricity-rate">Electricity cost (USD/kWh)</label>
              <input id="fleet-electricity-rate" type="number" min="0" max="10" step="any" disabled={!settingsLoaded || saving} value={rateDraft}
                onChange={e => {setRateDraft(e.target.value);setSaveError(null);setSaveMessage('');}} aria-describedby="fleet-rate-help" />
              <button className="btn btn-primary" type="submit" disabled={!settingsLoaded || saving}>Save rate</button>
            </form>
            <div><div className="label">Daily cost</div><div className="worker-summary-value">{totalDailyCost === null ? '—' : formatFiat(totalDailyCost)}</div></div>
            <div><div className="label">Est. daily revenue</div><div className="worker-summary-value">{dailyRevenue === null ? '—' : formatFiat(dailyRevenue)}</div></div>
          </div>
          <p id="fleet-rate-help" className="worker-help" style={{marginTop:14}}>Shared with Configuration. Saved settings apply to the whole fleet. Estimated revenue changes with hashrate, network conditions, and BTC price.</p>
          {overrideCount > 0 && <button className="btn" type="button" disabled={!settingsLoaded || saving} onClick={() => void handleOverride(undefined, undefined)} style={{marginTop:12}}>Reset all overrides ({overrideCount})</button>}
        </div>}
        {saving && <p role="status" style={{marginTop:12}}>Saving settings…</p>}
        {saveMessage && <p role="status" style={{marginTop:12,color:'var(--color-success)'}}>{saveMessage}</p>}
        {saveError && <div role="alert" className="worker-save-error" style={{marginTop:12}}>{saveError}{!settingsLoaded && <button className="btn" onClick={() => void loadSettings()} style={{marginLeft:8}}>Retry</button>}</div>}
      </div>
      <div className="flex gap-2 items-center" style={{flexWrap:'wrap'}}>
        <input type="search" aria-label="Search workers" placeholder="Search workers…" value={search} onChange={e => setSearch(e.target.value)} style={{maxWidth:280}} />
        <div className="flex gap-1" role="group" aria-label="Worker status filter">
          {(['all','online','offline'] as StatusFilter[]).map(s => <button key={s} className={`btn ${status === s ? 'btn-primary' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}
        </div><span className="worker-help" role="status">{filtered.length} of {allWorkers.length} workers</span>
      </div>
      {loading ? <p role="status" className="worker-help">Loading workers…</p> : (error && !workers) ? <p role="alert" className="worker-save-error">Could not load workers. Try again when the connection is available.</p> : filtered.length === 0 ?
        <p className="card worker-help">{allWorkers.length ? 'No workers match this filter.' : 'No workers yet. Confirm your wallet in Configuration and check that your miners are submitting shares.'}</p> :
        <StaggerChildren stagger={40} duration={350} style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(100%,300px),1fr))',gap:16}}>
          {filtered.map(w => <WorkerCard key={w.name} worker={w} maxHashrate={maxHashrate} btcPrice={btcPrice} powerCost={settingsLoaded && !dataUnavailable ? powerCost : null} override={overrides[w.name]}
            disabled={!settingsLoaded || saving} onSave={handleOverride} />)}
        </StaggerChildren>}
    </div>
  );
};
