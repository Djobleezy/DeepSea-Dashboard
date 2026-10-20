import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/store';
import type { DashboardMetrics } from '../types';
import { MAX_CHART_POINTS } from '../utils/hashrateHistory';
import { getServerTime, resetServerClock } from '../utils/serverClock';

const initial = useAppStore.getState();
const epoch = 1_800_000_000;
const row = (timestamp: number, value = 100) => ({ timestamp, hashrate_60sec: value, hashrate_3hr: value / 2 });
const metrics = (timestamp: number, value = 100): DashboardMetrics => ({
  wallet: 'wallet-a', data_status: 'fresh', data_updated_at: timestamp,
  server_timestamp: timestamp + 1, hashrate_60sec: value, hashrate_3hr: value / 2,
}) as DashboardMetrics;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime((epoch + 31 * 86_400) * 1000);
  resetServerClock();
  useAppStore.setState(initial, true);
  useAppStore.getState().setWallet('wallet-a');
});
afterEach(() => { resetServerClock(); vi.useRealTimers(); });

describe('durable chart history in the shared store', () => {
  it('retains a full seven-day history with absolute timestamps and both series aligned', () => {
    const rows = Array.from({ length: MAX_CHART_POINTS }, (_, index) => row(epoch + index * 60, index));
    useAppStore.getState().hydrateChart(rows, useAppStore.getState().walletEpoch, 168);
    const state = useAppStore.getState();
    expect(state.chartData60s).toHaveLength(MAX_CHART_POINTS);
    expect(state.chartData3hr).toHaveLength(MAX_CHART_POINTS);
    expect(state.chartData60s[0].ts).toBe(epoch * 1000);
    expect(state.chartData60s[state.chartData60s.length - 1]?.ts).toBe((epoch + (MAX_CHART_POINTS - 1) * 60) * 1000);
    expect(state.chartData60s.map((point) => point.ts)).toEqual(state.chartData3hr.map((point) => point.ts));
    expect(state.chartLoadedHours).toBe(168);
  });

  it('keeps equal clock labels on separate days as distinct samples', () => {
    useAppStore.getState().hydrateChart([row(epoch), row(epoch + 86_400)]);
    const points = useAppStore.getState().chartData60s;
    expect(points).toHaveLength(2);
    expect(points[0].label).toBe(points[1].label);
    expect(points[1].ts - points[0].ts).toBe(86_400_000);
  });

  it('captures accepted fresh snapshots without a mounted dashboard and ignores stale samples', () => {
    const store = useAppStore.getState();
    store.setMetrics(metrics(epoch));
    store.setMetrics(metrics(epoch + 60, 0));
    store.setMetrics({ ...metrics(epoch + 120), data_status: 'stale' });
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100, 0]);
    expect(useAppStore.getState().chartData60s.map((point) => point.ts)).toEqual([epoch * 1000, (epoch + 60) * 1000]);
  });

  it('does not append old, repeated or recalculated samples with the same source timestamp', () => {
    const store = useAppStore.getState();
    store.setMetrics({ ...metrics(epoch), snapshot_updated_at: epoch + 1 });
    const first = useAppStore.getState().chartData60s;
    store.setMetrics({ ...metrics(epoch), snapshot_updated_at: epoch + 2, btc_price: 80_000 });
    expect(useAppStore.getState().chartData60s).toBe(first);
    expect(store.setMetrics({ ...metrics(epoch - 60), snapshot_updated_at: epoch - 1 })).toBe(false);
    expect(useAppStore.getState().chartData60s).toHaveLength(1);
  });

  it('requires valid source time and finite nonnegative values without replacing missing data with zero', () => {
    const store = useAppStore.getState();
    for (const timestamp of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      store.addChartPoint(100, 50, timestamp);
    }
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      store.addChartPoint(value, 50, epoch);
      store.addChartPoint(100, value, epoch);
    }
    expect(useAppStore.getState().chartData60s).toEqual([]);
    store.hydrateChart([
      row(epoch, 0), row(epoch + 60, Number.NaN), row(epoch + 120, -1),
      row(Number.POSITIVE_INFINITY), { ...row(epoch + 180), hashrate_3hr: Number.NaN },
    ]);
    expect(useAppStore.getState().chartData60s).toHaveLength(1);
    expect(useAppStore.getState().chartData60s[0].value).toBe(0);
  });

  it('merges out-of-order history with live values while preserving authoritative gap metadata', () => {
    const store = useAppStore.getState();
    store.addChartPoint(900, 450, epoch + 120);
    store.hydrateChart([
      { ...row(epoch + 120, 100), gap_before: true },
      { ...row(epoch, 50), gap_before: false },
      { ...row(epoch + 60, 75), gap_before: false },
    ]);
    const state = useAppStore.getState();
    expect(state.chartData60s.map((point) => point.value)).toEqual([50, 75, 900]);
    expect(state.chartData60s.map((point) => point.gapBefore)).toEqual([false, false, true]);
    expect(state.chartData3hr.map((point) => point.value)).toEqual([25, 37.5, 450]);
  });

  it('rejects history from a previous wallet epoch and keeps the range preference', () => {
    const store = useAppStore.getState();
    const oldEpoch = store.walletEpoch;
    store.setChartHours(168);
    store.hydrateChart([row(epoch)], oldEpoch, 168);
    store.setWallet('wallet-b');
    store.hydrateChart([row(epoch + 60)], oldEpoch, 168);
    expect(useAppStore.getState()).toMatchObject({
      chartData60s: [], chartData3hr: [], chartHydrated: false, chartLoadedHours: 0, chartHours: 168,
    });
  });

  it('clears an old gap marker after recovered history fills the missing samples', () => {
    const store = useAppStore.getState();
    store.hydrateChart([{ ...row(epoch), gap_before: false }, { ...row(epoch + 600), gap_before: true }]);
    expect(useAppStore.getState().chartData60s[1].gapBefore).toBe(true);
    store.hydrateChart(Array.from({ length: 11 }, (_, index) => ({ ...row(epoch + index * 60), gap_before: false })));
    expect(useAppStore.getState().chartData60s).toHaveLength(11);
    expect(useAppStore.getState().chartData60s.some((point) => point.gapBefore)).toBe(false);
  });

  it('bounds high-volume hydration and subsequent live appends to seven days and the point limit', () => {
    const store = useAppStore.getState();
    const rows = Array.from({ length: MAX_CHART_POINTS + 500 }, (_, index) => row(epoch + index * 60, index));
    store.hydrateChart(rows);
    expect(useAppStore.getState().chartData60s).toHaveLength(MAX_CHART_POINTS);
    expect(useAppStore.getState().chartData60s[0].value).toBe(500);
    store.addChartPoint(42, 21, epoch + (MAX_CHART_POINTS + 500) * 60);
    expect(useAppStore.getState().chartData60s).toHaveLength(MAX_CHART_POINTS);
    expect(useAppStore.getState().chartData60s[0].value).toBe(501);
    store.addChartPoint(99, 49.5, epoch + 30 * 86_400);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([99]);
  });

  it('inserts late samples in timestamp order and deduplicates a source second', () => {
    const store = useAppStore.getState();
    store.addChartPoint(1, 1, epoch);
    store.addChartPoint(3, 3, epoch + 120);
    store.addChartPoint(2, 2, epoch + 60);
    store.addChartPoint(2.5, 2.5, epoch + 60.25);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([1, 2.5, 3]);
    expect(useAppStore.getState().chartData60s[1].ts).toBe((epoch + 60.25) * 1000);
  });

  it('rejects future live and persisted samples without losing valid history or poisoning ordering', () => {
    const store = useAppStore.getState();
    const now = Date.now() / 1000;
    store.setMetrics(metrics(now - 60));
    for (const future of [now + 5.001, now + 86_400, 8e12]) {
      const initialHistory = useAppStore.getState().chartData60s;
      store.addChartPoint(999, 999, future);
      expect(useAppStore.getState().chartData60s).toBe(initialHistory);
      expect(store.setMetrics({ ...metrics(future, 999), server_timestamp: now })).toBe(false);
      store.hydrateChart([row(now - 60), row(future, 999)]);
      expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100]);
    }
    expect(store.setMetrics(metrics(now, 200))).toBe(true);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100, 200]);
    expect(useAppStore.getState().lastUpdated).toBe(now * 1000);
  });

  it('allows up to five seconds of source clock skew', () => {
    const store = useAppStore.getState();
    const now = Date.now() / 1000;
    store.addChartPoint(100, 50, now + 5);
    store.hydrateChart([row(now + 5)]);
    expect(useAppStore.getState().chartData60s).toHaveLength(1);
    expect(useAppStore.getState().chartData60s[0].ts).toBe((now + 5) * 1000);
  });

  it('replaces an old reduced selection without moving a gap to an unrelated pair of samples', () => {
    vi.setSystemTime((epoch + 1000) * 1000);
    const store = useAppStore.getState();
    store.hydrateChart([
      { ...row(epoch - 4000), gap_before: false },
      { ...row(epoch + 90), gap_before: false },
      { ...row(epoch + 305), gap_before: true },
      { ...row(epoch + 310, 310), gap_before: false },
    ]);
    store.addChartPoint(500, 250, epoch + 500);
    store.hydrateChart([
      { ...row(epoch + 95), gap_before: false },
      { ...row(epoch + 310, 999), gap_before: true },
      { ...row(epoch + 315), gap_before: false },
    ]);
    const points = useAppStore.getState().chartData60s;
    expect(points.map((point) => point.ts / 1000 - epoch)).toEqual([-4000, 95, 310, 315, 500]);
    expect(points[2]).toMatchObject({ value: 310, gapBefore: true });
  });

  it('accepts the first fresh SSE snapshot with a slow client clock before health synchronization', () => {
    const serverNow = Date.now();
    vi.setSystemTime(serverNow - 180_000);
    const store = useAppStore.getState();
    expect(store.setMetrics({ ...metrics(serverNow / 1000), server_timestamp: serverNow / 1000 })).toBe(true);
    expect(getServerTime()).toBe(serverNow);
    store.hydrateChart([row(serverNow / 1000 - 60), row(serverNow / 1000)]);
    expect(useAppStore.getState().chartData60s).toHaveLength(2);
    expect(store.setMetrics({ ...metrics(serverNow / 1000 + 10), server_timestamp: serverNow / 1000 })).toBe(false);
    expect(useAppStore.getState().chartData60s).toHaveLength(2);
  });
});
