import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchConfig, fetchTimezones, updateConfig } from '../api/client';
import { invalidateCurrencyCache } from '../hooks/useCurrency';
import { useAppStore } from '../stores/store';
import type { AppConfig } from '../types';

export const Boot: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AppConfig>({
    wallet: '', power_cost: 0.12, power_usage: 3000, currency: 'USD',
    timezone: 'UTC', network_fee: 0.5, extended_history: false, low_hashrate_threshold_ths: 3,
  });
  const [timezones, setTimezones] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const redirect = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, zones] = await Promise.all([
        fetchConfig(), fetchTimezones().catch(() => ({ timezones: [] as string[] })),
      ]);
      if (!mounted.current) return;
      setConfig({ ...cfg, low_hashrate_threshold_ths: cfg.low_hashrate_threshold_ths ?? 3 });
      setTimezones(Array.from(new Set([cfg.timezone, 'UTC', ...zones.timezones])));
      setLoaded(true);
    } catch {
      if (mounted.current) setError('Configuration could not be loaded. Your saved settings have not changed.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      if (redirect.current) clearTimeout(redirect.current);
    };
  }, [load]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await updateConfig({ ...config, wallet: config.wallet.trim() });
      if (!mounted.current) return;
      setConfig(result);
      useAppStore.getState().setWallet(result.wallet);
      useAppStore.getState().requestMetricsRefresh();
      invalidateCurrencyCache();
      setSaved(true);
      redirect.current = setTimeout(() => navigate('/dashboard'), 1200);
    } catch {
      if (mounted.current) setError('Settings could not be saved. Check the values and connection, then try again.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div className="config-page">
      <div className="page-heading">
        <div><p className="eyebrow">Your mining setup</p><h1>Configuration</h1></div>
      </div>
      <p className="page-description">Connect your Ocean wallet and set the values used for your mining estimates.</p>
      {error && <div className="status-panel status-error" role="alert">{error}{!loaded && <button className="btn" onClick={load}>Retry</button>}</div>}
      {saved && <div className="status-panel status-success" role="status">Settings saved. Opening your dashboard…</div>}
      {loading ? <div className="status-panel" role="status">Loading your settings…</div> : loaded && (
        <form onSubmit={handleSubmit} className="config-form">
          <section className="card">
            <label className="label" htmlFor="wallet">Bitcoin wallet address</label>
            <input id="wallet" type="text" value={config.wallet} onChange={(event) => setConfig({ ...config, wallet: event.target.value })}
              placeholder="bc1q…" required autoComplete="off" spellCheck={false} aria-describedby="wallet-help" />
            <p className="field-help" id="wallet-help">Use the payout address you mine to on Ocean. Changing it switches the dashboard to that wallet’s history.</p>
          </section>
          <section className="card config-grid" aria-label="Mining cost estimates">
            <div>
              <label className="label" htmlFor="power-cost">Electricity rate ($/kWh)</label>
              <input id="power-cost" type="number" step="0.001" min="0" max="10" value={config.power_cost}
                onChange={(event) => setConfig({ ...config, power_cost: Number(event.target.value) })} required aria-describedby="power-help" />
            </div>
            <div>
              <label className="label" htmlFor="power-usage">Fallback power draw (W)</label>
              <input id="power-usage" type="number" step="1" min="0" value={config.power_usage}
                onChange={(event) => setConfig({ ...config, power_usage: Number(event.target.value) })} required aria-describedby="power-help" />
            </div>
            <p id="power-help" className="field-help config-grid-wide">The electricity rate is shared with Workers. Fallback power is used when fleet power data is unavailable.</p>
            <div>
              <label className="label" htmlFor="currency">Display currency</label>
              <select id="currency" value={config.currency} onChange={(event) => setConfig({ ...config, currency: event.target.value })}>
                {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'KRW', 'BRL', 'CHF'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="network-fee">Pool fee estimate (%)</label>
              <input id="network-fee" type="number" step="0.1" min="0" max="10" value={config.network_fee}
                onChange={(event) => setConfig({ ...config, network_fee: Number(event.target.value) })} required />
            </div>
          </section>
          <section className="card">
            <label className="label" htmlFor="timezone">Timezone</label>
            <select id="timezone" value={config.timezone} onChange={(event) => setConfig({ ...config, timezone: event.target.value })}>
              {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
            </select>
          </section>
          <section className="card">
            <label className="label" htmlFor="low-hashrate-threshold">Low-hashrate threshold (TH/s)</label>
            <input id="low-hashrate-threshold" type="number" step="any" min="0" max="1000000"
              value={config.low_hashrate_threshold_ths ?? 3}
              onChange={(event) => setConfig({ ...config, low_hashrate_threshold_ths: Number(event.target.value) })}
              required aria-describedby="low-hashrate-help" />
            <p id="low-hashrate-help" className="field-help">Below this 3-hour average, charts emphasize the steadier reading and alerts allow more variance. Set 0 to disable low-hashrate mode.</p>
          </section>
          <section className="card checkbox-field">
            <input type="checkbox" id="ext-history" checked={config.extended_history}
              onChange={(event) => setConfig({ ...config, extended_history: event.target.checked })} />
            <label htmlFor="ext-history"><span className="label">Extended history</span><span className="field-help">Fetch up to 360 days of payout history instead of 90.</span></label>
          </section>
          <button type="submit" className="btn btn-primary save-config" disabled={saving || saved || !config.wallet.trim()}>
            {saving ? 'Saving settings…' : saved ? 'Settings saved' : 'Save configuration'}
          </button>
        </form>
      )}
    </div>
  );
};
