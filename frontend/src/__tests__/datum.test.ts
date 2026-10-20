import { describe, expect, it } from 'vitest';
import type { DatumStatus, HealthStatus } from '../types';
import { deriveDatumBadge } from '../utils/datum';

const health: HealthStatus = {
  status: 'ok', version: '2.0.4', wallet_configured: true,
  redis_connected: false, uptime_seconds: 10, datum_gateway_configured: true,
};
const datum: DatumStatus = {
  status: 'reachable', probe_reachable: true, probe_method: 'umbrel-api',
  pool_fees_percentage: 1, fees_in_datum_band: true,
  fee_band_low: 0.9, fee_band_high: 1.3, explanation: 'Reachability only.', last_check: 1,
};

describe('DATUM evidence labels', () => {
  it('reports gateway reachability separately from pool connectivity', () => {
    expect(deriveDatumBadge(health, datum, 1).label).toBe('DATUM GATEWAY REACHABLE');
  });

  it('does not infer a live connection from historical fees or a failed probe', () => {
    expect(deriveDatumBadge(null, null, 1).label).toBe('DATUM FEES IN RANGE');
    expect(deriveDatumBadge(null, null, 2).label).toBe('DATUM STATUS UNVERIFIED');
    expect(deriveDatumBadge(health, { ...datum, probe_reachable: false }, 1).label)
      .toBe('DATUM GATEWAY UNREACHABLE');
  });

  it('does not fall back to a positive fee inference when live status is missing', () => {
    expect(deriveDatumBadge(health, null, 1).label).toBe('DATUM STATUS UNAVAILABLE');
  });

  it('shows exhausted discovery as unreachable even without an individual probe method', () => {
    const result = deriveDatumBadge(health, {
      ...datum, status: 'unreachable', probe_reachable: false,
      probe_method: 'none', gateway_url: null, probe_error: 'autodiscover-failed',
    }, 1);
    expect(result.label).toBe('DATUM GATEWAY UNREACHABLE');
    expect(result.className).toBe('badge-warning');
  });

  it('keeps an unavailable discovery result distinct from an unsuccessful check', () => {
    expect(deriveDatumBadge(health, {
      ...datum, status: 'unknown', probe_reachable: false, probe_method: 'none',
    }, 1).label).toBe('DATUM STATUS UNAVAILABLE');
  });
});
