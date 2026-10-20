import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetrics, fetchWorkers } from '../api/client';
import { resetApiStatus } from '../api/status';
import { useSSE } from '../hooks/useSSE';
import { useAppStore } from '../stores/store';
import type { DashboardMetrics, WorkerSummary } from '../types';

vi.mock('../api/client', () => ({ fetchMetrics: vi.fn(), fetchWorkers: vi.fn() }));

const initialStore = useAppStore.getState();
const sources: ControlledSource[] = [];

/** Retain callbacks after close to exercise delayed transport deliveries. */
class ControlledSource {
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor() { sources.push(this); }

  addEventListener(type: string, callback: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, data: unknown = {}) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function metrics(timestamp: number, wallet = 'wallet-a'): DashboardMetrics {
  return {
    wallet, data_status: 'fresh', data_updated_at: timestamp,
    snapshot_updated_at: timestamp, server_timestamp: timestamp,
    hashrate_60sec: timestamp, hashrate_3hr: timestamp,
  } as DashboardMetrics;
}

function workers(timestamp: number, wallet = 'wallet-a'): WorkerSummary {
  return {
    wallet, data_status: 'fresh', data_updated_at: timestamp,
    snapshot_updated_at: timestamp, workers: [], workers_total: timestamp,
  } as unknown as WorkerSummary;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  vi.resetAllMocks();
  sources.length = 0;
  useAppStore.setState(initialStore, true);
  useAppStore.getState().setWallet('wallet-a');
  resetApiStatus();
  vi.stubGlobal('EventSource', ControlledSource);
  vi.mocked(fetchMetrics).mockResolvedValue(metrics(1000));
  vi.mocked(fetchWorkers).mockResolvedValue(workers(1000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SSE connection lifetime', () => {
  it('ignores delayed data, open, and error callbacks from a replaced connection', async () => {
    renderHook(() => useSSE());
    await act(async () => sources[0].emit('open'));
    act(() => sources[0].emit('error'));
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => sources[1].emit('open'));
    act(() => {
      sources[1].emit('metrics', metrics(2000));
      sources[1].emit('workers', workers(2000));
    });
    const resyncCalls = vi.mocked(fetchMetrics).mock.calls.length;

    await act(async () => {
      sources[0].emit('metrics', metrics(3000));
      sources[0].emit('workers', workers(3000));
      sources[0].emit('open');
      sources[0].emit('error');
    });

    expect(useAppStore.getState().metrics?.data_updated_at).toBe(2000);
    expect(useAppStore.getState().workers?.data_updated_at).toBe(2000);
    expect(useAppStore.getState().sseConnected).toBe(true);
    expect(sources[1].close).not.toHaveBeenCalled();
    expect(fetchMetrics).toHaveBeenCalledTimes(resyncCalls);
    act(() => vi.advanceTimersByTime(5000));
    expect(sources).toHaveLength(2);
  });

  it('does not let an obsolete heartbeat conceal a stalled replacement stream', async () => {
    renderHook(() => useSSE());
    act(() => sources[0].emit('error'));
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => sources[1].emit('open'));
    act(() => vi.advanceTimersByTime(60_000));
    act(() => sources[0].emit('heartbeat'));
    // The current stream has been silent for 79 seconds at the next watchdog tick.
    act(() => vi.advanceTimersByTime(19_000));

    expect(sources[1].close).toHaveBeenCalledOnce();
    expect(useAppStore.getState().sseConnected).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(sources).toHaveLength(3);
  });

  it('ignores pending REST resync results after the originating connection is replaced', async () => {
    const oldMetrics = deferred<DashboardMetrics>();
    const oldWorkers = deferred<WorkerSummary>();
    vi.mocked(fetchMetrics).mockReturnValueOnce(oldMetrics.promise).mockResolvedValue(metrics(2000));
    vi.mocked(fetchWorkers).mockReturnValueOnce(oldWorkers.promise).mockResolvedValue(workers(2000));
    renderHook(() => useSSE());
    act(() => sources[0].emit('open'));
    act(() => sources[0].emit('error'));
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => sources[1].emit('open'));
    expect(useAppStore.getState().metrics?.data_updated_at).toBe(2000);

    await act(async () => {
      oldMetrics.resolve(metrics(3000));
      oldWorkers.resolve(workers(3000));
    });

    expect(useAppStore.getState().metrics?.data_updated_at).toBe(2000);
    expect(useAppStore.getState().workers?.data_updated_at).toBe(2000);
    expect(useAppStore.getState().chartData60s.map((point) => point.ts)).toEqual([2_000_000]);
  });

  it('keeps a successful metrics resync when the worker request fails', async () => {
    vi.mocked(fetchMetrics).mockResolvedValue(metrics(2000));
    vi.mocked(fetchWorkers).mockRejectedValue(new Error('Worker endpoint unavailable'));
    renderHook(() => useSSE());
    await act(async () => sources[0].emit('open'));

    expect(useAppStore.getState().metrics?.data_updated_at).toBe(2000);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([2000]);
    expect(useAppStore.getState().workers).toBeNull();
    expect(useAppStore.getState().sseConnected).toBe(true);
  });

  it('reconnects immediately on online and cancels the existing backoff retry', async () => {
    renderHook(() => useSSE());
    act(() => sources[0].emit('error'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => sources[1].emit('error'));
    act(() => vi.advanceTimersByTime(2000));
    act(() => sources[2].emit('error'));

    act(() => window.dispatchEvent(new Event('online')));
    expect(sources).toHaveLength(4);
    await act(async () => sources[3].emit('open'));
    act(() => vi.advanceTimersByTime(4000));

    expect(sources).toHaveLength(4);
    expect(sources[3].close).not.toHaveBeenCalled();
    expect(useAppStore.getState().sseConnected).toBe(true);
  });

  it('resets accumulated reconnect backoff when the wallet changes', () => {
    renderHook(() => useSSE());
    act(() => sources[0].emit('error'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => sources[1].emit('error'));
    act(() => vi.advanceTimersByTime(2000));
    act(() => sources[2].emit('error'));
    act(() => useAppStore.getState().setWallet('wallet-b'));
    expect(sources).toHaveLength(4);
    act(() => sources[3].emit('error'));
    act(() => vi.advanceTimersByTime(999));
    expect(sources).toHaveLength(4);
    act(() => vi.advanceTimersByTime(1));
    expect(sources).toHaveLength(5);
  });

  it('cleans up watchdogs, retries, and online listeners when unmounted', async () => {
    const hook = renderHook(() => useSSE());
    act(() => sources[0].emit('error'));
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    hook.unmount();
    // Flush React's queued zero-delay work before counting remaining timers.
    act(() => vi.advanceTimersByTime(0));
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      sources[0].emit('open');
      sources[0].emit('error');
      sources[0].emit('heartbeat');
      sources[0].emit('metrics', metrics(2000));
    });
    act(() => vi.advanceTimersByTime(120_000));

    expect(sources).toHaveLength(1);
    expect(fetchMetrics).not.toHaveBeenCalled();
    expect(useAppStore.getState().metrics).toBeNull();
    expect(useAppStore.getState().sseConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
