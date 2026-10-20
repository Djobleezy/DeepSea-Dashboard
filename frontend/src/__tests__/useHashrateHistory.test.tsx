import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetricHistory } from '../api/client';
import { useHashrateHistory } from '../hooks/useHashrateHistory';
import { useAppStore } from '../stores/store';
import type { MetricHistoryPoint } from '../utils/hashrateHistory';

vi.mock('../api/client', () => ({ fetchMetricHistory: vi.fn() }));
const initial = useAppStore.getState();
const epoch = Math.floor(Date.now() / 1000) - 3600;
const sample = (timestamp = epoch, value = 100): MetricHistoryPoint => ({
  timestamp, hashrate_60sec: value, hashrate_3hr: value / 2,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState(initial, true);
  useAppStore.getState().setWallet('wallet-a');
  vi.mocked(fetchMetricHistory).mockResolvedValue([sample()]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('history hydration and recovery', () => {
  it('loads the default 24-hour range and retains live points arriving during hydration', async () => {
    const history = deferred<MetricHistoryPoint[]>();
    vi.mocked(fetchMetricHistory).mockReturnValue(history.promise);
    const { result } = renderHook(() => useHashrateHistory());
    expect(fetchMetricHistory).toHaveBeenCalledWith(24);
    expect(result.current.loading).toBe(true);
    act(() => useAppStore.getState().addChartPoint(200, 100, sample().timestamp + 60));
    await act(async () => history.resolve([sample()]));
    expect(result.current.loading).toBe(false);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100, 200]);
    expect(useAppStore.getState().chartLoadedHours).toBe(24);
  });

  it('lets the user retry a failed first hydration without losing live readings', async () => {
    useAppStore.getState().addChartPoint(200, 100, sample().timestamp + 60);
    vi.mocked(fetchMetricHistory).mockRejectedValueOnce(new Error('History unavailable'));
    const { result } = renderHook(() => useHashrateHistory());
    await waitFor(() => expect(result.current.error).toBe('History unavailable'));
    expect(useAppStore.getState().chartData60s).toHaveLength(1);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100, 200]);
    expect(fetchMetricHistory).toHaveBeenCalledTimes(2);
  });

  it('does not let a slower old range replace the current range', async () => {
    const old = deferred<MetricHistoryPoint[]>();
    vi.mocked(fetchMetricHistory).mockReturnValueOnce(old.promise).mockResolvedValueOnce([sample(epoch + 60, 200)]);
    const { result } = renderHook(() => useHashrateHistory());
    act(() => result.current.setHours(168));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => old.resolve([sample()]));
    expect(result.current.hours).toBe(168);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([200]);
    expect(useAppStore.getState().chartLoadedHours).toBe(168);
  });

  it('ignores a late history response from the previous wallet', async () => {
    const old = deferred<MetricHistoryPoint[]>();
    vi.mocked(fetchMetricHistory).mockReturnValueOnce(old.promise).mockResolvedValueOnce([sample(epoch + 60, 200)]);
    const { result } = renderHook(() => useHashrateHistory());
    act(() => useAppStore.getState().setWallet('wallet-b'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => old.resolve([sample()]));
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([200]);
    expect(useAppStore.getState().wallet).toBe('wallet-b');
  });

  it('backfills on an SSE reconnect and queues recovery while an earlier request is pending', async () => {
    const old = deferred<MetricHistoryPoint[]>();
    vi.mocked(fetchMetricHistory).mockReturnValueOnce(old.promise).mockResolvedValueOnce([sample(), sample(epoch + 60)]);
    renderHook(() => useHashrateHistory());
    act(() => useAppStore.getState().setSseConnected(true));
    expect(fetchMetricHistory).toHaveBeenCalledTimes(1);
    await act(async () => old.resolve([sample()]));
    await waitFor(() => expect(fetchMetricHistory).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().chartData60s).toHaveLength(2);
  });

  it('refreshes on online, focus and periodic backfill, then removes every listener on unmount', async () => {
    vi.useFakeTimers();
    const view = renderHook(() => useHashrateHistory());
    await act(async () => {});
    await act(async () => window.dispatchEvent(new Event('online')));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(fetchMetricHistory).toHaveBeenCalledTimes(4);
    view.unmount();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      useAppStore.getState().setSseConnected(true);
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(fetchMetricHistory).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for a configured wallet and treats an invalid payload as an actionable error', async () => {
    useAppStore.getState().setWallet('');
    const { result } = renderHook(() => useHashrateHistory());
    expect(fetchMetricHistory).not.toHaveBeenCalled();
    vi.mocked(fetchMetricHistory).mockResolvedValueOnce({ error: 'bad' } as unknown as MetricHistoryPoint[]);
    act(() => useAppStore.getState().setWallet('wallet-a'));
    await waitFor(() => expect(result.current.error).toMatch(/invalid chart history/));
    expect(result.current.loading).toBe(false);
    expect(useAppStore.getState().chartHydrated).toBe(false);
  });
});
