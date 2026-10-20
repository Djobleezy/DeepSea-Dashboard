import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDatumStatus, fetchHealth } from '../api/client';
import { useDatumStatus } from '../hooks/useDatumStatus';
import type { DatumStatus, HealthStatus } from '../types';

vi.mock('../api/client', () => ({ fetchHealth: vi.fn(), fetchDatumStatus: vi.fn() }));

const health: HealthStatus = {
  status: 'ok', version: '2.2.0', wallet_configured: true,
  redis_connected: false, uptime_seconds: 10, datum_gateway_configured: true,
};
const datum: DatumStatus = {
  status: 'reachable', probe_reachable: true, probe_method: 'umbrel-api',
  pool_fees_percentage: 1, fees_in_datum_band: true,
  fee_band_low: 0.9, fee_band_high: 1.3, explanation: 'Reachability only.', last_check: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchHealth).mockReset().mockResolvedValue(health);
  vi.mocked(fetchDatumStatus).mockReset().mockResolvedValue(datum);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DATUM polling', () => {
  it('recovers even after several failed health checks', async () => {
    vi.mocked(fetchHealth).mockRejectedValue(new Error('starting'));
    const { result } = renderHook(useDatumStatus);
    await act(async () => { await vi.advanceTimersByTimeAsync(150_000); });
    expect(fetchHealth).toHaveBeenCalledTimes(6);
    vi.mocked(fetchHealth).mockResolvedValue(health);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.datum).toEqual(datum);
  });

  it('clears stale probe results after a failed refresh', async () => {
    const { result } = renderHook(useDatumStatus);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.datum).toEqual(datum);
    vi.mocked(fetchDatumStatus).mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.datum).toBeNull();
  });

  it('starts and stops probing when configuration changes', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({ ...health, datum_gateway_configured: false });
    const { result } = renderHook(useDatumStatus);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchDatumStatus).not.toHaveBeenCalled();
    vi.mocked(fetchHealth).mockResolvedValue(health);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.datum).toEqual(datum);
    vi.mocked(fetchHealth).mockResolvedValue({ ...health, datum_gateway_configured: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.datum).toBeNull();
    expect(fetchDatumStatus).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the dashboard unmounts', async () => {
    const { unmount } = renderHook(useDatumStatus);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });
});
