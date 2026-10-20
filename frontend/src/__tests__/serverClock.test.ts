import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetricHistory, fetchMetrics } from '../api/client';
import { getClockOffset, getServerTime, resetServerClock, syncServerTime } from '../utils/serverClock';

const serverNow = Date.UTC(2026, 9, 20, 20, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(serverNow - 180_000);
  resetServerClock();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { resetServerClock(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('server-calibrated chart time', () => {
  it('rejects malformed synchronization values and accounts for request midpoint', () => {
    expect(syncServerTime(Number.NaN)).toBe(false);
    expect(syncServerTime(Infinity)).toBe(false);
    expect(syncServerTime(-1)).toBe(false);
    expect(getClockOffset()).toBe(0);
    expect(syncServerTime(serverNow / 1000, serverNow - 180_100, serverNow - 179_900)).toBe(true);
    expect(getServerTime()).toBe(serverNow);
  });

  it('calibrates history from a fresh HTTP Date header before returning its samples', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([
      { timestamp: serverNow / 1000, hashrate_60sec: 100, hashrate_3hr: 50 },
    ], { headers: { Date: new Date(serverNow).toUTCString() } }));
    await fetchMetricHistory(24);
    expect(getServerTime()).toBe(serverNow);
  });

  it('prefers a precise server timestamp and never recalibrates from a stale saved response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      server_timestamp: serverNow / 1000 + .25, data_updated_at: serverNow / 1000, data_status: 'fresh',
    }, { headers: { Date: new Date(serverNow).toUTCString() } }));
    await fetchMetrics();
    expect(getServerTime()).toBe(serverNow + 250);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      server_timestamp: (serverNow - 3600_000) / 1000, data_status: 'fresh',
    }, { headers: { 'X-DeepSea-Cache': 'stale', Date: new Date(serverNow - 3600_000).toUTCString() } }));
    await fetchMetrics();
    expect(getServerTime()).toBe(serverNow + 250);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      server_timestamp: (serverNow - 3600_000) / 1000, data_status: 'stale',
    }));
    await fetchMetrics();
    expect(getServerTime()).toBe(serverNow + 250);
  });
});
