import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchConfig, fetchTimezones, updateConfig } from '../api/client';
import { invalidateCurrencyCache } from '../hooks/useCurrency';
import type { AppConfig } from '../types';

export const Boot: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AppConfig>({
    wallet: '',
    power_cost: 0.12,
    power_usage: 3450,
    currency: 'USD',
    timezone: 'America/Los_Angeles',
    network_fee: 0.5,
    extended_history: false,
  });
  const [timezones, setTimezones] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchConfig(), fetchTimezones()])
      .then(([cfg, tz]) => {
        setConfig(cfg);
        setTimezones(tz.timezones);
      })
      .catch(() => setError('Failed to load config'))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateConfig(config);
      invalidateCurrencyCache(); // push new currency to all useCurrency consumers
      setSaved(true);
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <span className="glow" style={{ fontFamily: 'var(--font-vt323)', fontSize: '24px' }}>
          LOADING CONFIG...▌
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '640px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      <h1 style={{ fontSize: '36px', letterSpacing: '4px', textAlign: 'center' }}>
        ⚡ CONFIGURATION
      </h1>

      {error && (
        <div
          className="card notif-error"
          style={{ color: 'var(--color-error)', fontSize: '13px', padding: '10px' }}
        >
          ⚠ {error}
        </div>
      )}

      {saved && (
        <div
          className="card notif-success"
          style={{ color: 'var(--color-success)', fontSize: '13px', padding: '10px', textAlign: 'center' }}
        >
          ✓ CONFIGURATION SAVED — REDIRECTING...
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="card">
          <div className="label" style={{ marginBottom: '8px' }}>BITCOIN WALLET ADDRESS</div>
          <input
            type="text"
            value={config.wallet}
            onChange={(e) => setConfig({ ...config, wallet: e.target.value })}
            placeholder="bc1q..."
            required
          />
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Your Ocean.xyz mining wallet address
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <div className="label" style={{ marginBottom: '8px' }}>POWER COST ($/kWh)</div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={config.power_cost}
              onChange={(e) => {
                const next = Number(e.target.value);
                setConfig({ ...config, power_cost: Number.isFinite(next) ? next : 0 });
              }}
            />
          </div>
          <div>
            <div className="label" style={{ marginBottom: '8px' }}>POWER USAGE (W)</div>
            <input
              type="number"
              step="10"
              min="0"
              value={config.power_usage}
              onChange={(e) => {
                const next = Number(e.target.value);
                setConfig({ ...config, power_usage: Number.isFinite(next) ? next : 0 });
              }}
            />
          </div>
          <div>
            <div className="label" style={{ marginBottom: '8px' }}>CURRENCY</div>
            <select
              value={config.currency}
              onChange={(e) => setConfig({ ...config, currency: e.target.value })}
            >
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'KRW', 'BRL', 'CHF'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="label" style={{ marginBottom: '8px' }}>NETWORK FEE (%)</div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={config.network_fee}
              onChange={(e) => {
                const next = Number(e.target.value);
                setConfig({ ...config, network_fee: Number.isFinite(next) ? next : 0 });
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="label" style={{ marginBottom: '8px' }}>TIMEZONE</div>
          <select
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="checkbox"
            id="ext-history"
            checked={config.extended_history}
            onChange={(e) => setConfig({ ...config, extended_history: e.target.checked })}
            style={{ width: 'auto' }}
          />
          <label htmlFor="ext-history" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <span className="label">EXTENDED HISTORY</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block' }}>
              Fetch 360 days of payout history instead of 90
            </span>
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || !config.wallet}
          style={{ fontSize: '16px', padding: '12px', letterSpacing: '2px' }}
        >
          {saving ? 'SAVING...' : '⚡ SAVE & LAUNCH'}
        </button>
      </form>
    </div>
  );
};
