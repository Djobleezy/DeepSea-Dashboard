import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBlocks, fetchConfig, fetchEarnings, fetchMetrics, fetchNotifications, fetchUnreadCount } from '../api/client';
import { getApiStatus, publishApiStatus, resetApiStatus } from '../api/status';
import { useAppStore } from '../stores/store';
import { useMetrics } from '../hooks/useMetrics';
import { usePayoutTracking, payoutHistoryKey } from '../hooks/usePayoutTracking';
import { useNotifications } from '../hooks/useNotifications';
import { useUnreadCount } from '../hooks/useUnreadCount';
import { useSSE } from '../hooks/useSSE';
import { useWalletScope } from '../hooks/useWalletScope';
import { Earnings } from '../pages/Earnings';
import { Blocks } from '../pages/Blocks';
import type { AppConfig, DashboardMetrics, EarningsResponse, Notification, WorkerSummary } from '../types';

vi.mock('../api/client', () => ({
  fetchBlocks: vi.fn(), fetchEarnings: vi.fn(), fetchMetrics: vi.fn(),
  fetchNotifications: vi.fn(), fetchUnreadCount: vi.fn(), fetchWorkers: vi.fn(), fetchConfig: vi.fn(),
}));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatFiat: (amount: number) => `$${amount.toFixed(2)}` }),
}));

const initial = useAppStore.getState();
const emptyEarnings: EarningsResponse = { payments: [], total_btc: 0, total_sats: 0, monthly_summary: [], currency: 'USD' };
function snapshot(wallet: string, timestamp = 1000): DashboardMetrics {
  return { wallet, data_status: 'fresh', data_updated_at: timestamp, server_timestamp: timestamp + 2, unpaid_earnings: 0.001, btc_price: 100000 } as DashboardMetrics;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useAppStore.setState(initial, true);
  resetApiStatus();
  vi.mocked(fetchEarnings).mockResolvedValue(emptyEarnings);
  vi.mocked(fetchUnreadCount).mockResolvedValue({ unread_count: 2 });
  vi.mocked(fetchNotifications).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('wallet-scoped snapshots', () => {
  it('clears charts and rejects delayed snapshots belonging to the previous wallet', () => {
    const store = useAppStore.getState();
    store.setWallet('wallet-a');
    store.setMetrics(snapshot('wallet-a'));
    store.addChartPoint(100, 100);
    store.setWallet('wallet-b');
    store.setMetrics(snapshot('wallet-a', 2000));
    store.setWorkers({ wallet: 'wallet-a', workers: [] } as unknown as WorkerSummary);
    expect(useAppStore.getState()).toMatchObject({ wallet: 'wallet-b', metrics: null, workers: null, chartData60s: [], chartHydrated: false });
  });

  it('does not replace newer streamed workers with an older REST response', () => {
    const store = useAppStore.getState();
    store.setWallet('wallet-a');
    const newer = { wallet: 'wallet-a', workers: [], data_updated_at: 2000 } as unknown as WorkerSummary;
    const older = { wallet: 'wallet-a', workers: [], data_updated_at: 1000 } as unknown as WorkerSummary;
    store.setWorkers(newer);
    store.setWorkers(older);
    expect(useAppStore.getState().workers).toBe(newer);
    // Saving local power settings can legitimately revise the same source sample.
    const revised = { ...newer, total_power_watts: 3000 };
    store.setWorkers(revised);
    expect(useAppStore.getState().workers).toBe(revised);
  });

  it('retains the source timestamp for stale data rather than stamping receipt time', () => {
    useAppStore.getState().setWallet('wallet-a');
    useAppStore.getState().setMetrics({ ...snapshot('wallet-a', 100), data_status: 'stale', data_error: 'Source unavailable' });
    expect(useAppStore.getState().lastUpdated).toBe(100000);
    expect(useAppStore.getState().metricsError).toBe('Source unavailable');
  });

  it('retains successful readings when an unavailable response has no source timestamp', () => {
    const store = useAppStore.getState();
    store.setWallet('wallet-a');
    store.setMetrics({ ...snapshot('wallet-a', 2000), hashrate_60sec: 250 });
    store.setMetrics({ ...snapshot('wallet-a'), data_status: 'unavailable', data_updated_at: null, hashrate_60sec: 0 });
    expect(useAppStore.getState().metrics).toMatchObject({ hashrate_60sec: 250, data_status: 'stale', data_updated_at: 2000 });
    expect(useAppStore.getState().lastUpdated).toBe(2000000);

    const freshWorkers = { wallet: 'wallet-a', data_updated_at: 2000, workers_total: 2, workers: [] } as unknown as WorkerSummary;
    store.setWorkers(freshWorkers);
    store.setWorkers({ wallet: 'wallet-a', data_updated_at: null, workers_total: 0, workers: [] } as unknown as WorkerSummary);
    expect(useAppStore.getState().workers).toMatchObject({ workers_total: 2, data_status: 'stale', data_updated_at: 2000 });
  });

  it('records legitimate zero readings once per source timestamp', () => {
    const store = useAppStore.getState();
    store.addChartPoint(100, 100, 1000);
    store.addChartPoint(0, 0, 1060);
    store.addChartPoint(0, 0, 1060);
    expect(useAppStore.getState().chartData60s.map((point) => point.value)).toEqual([100, 0]);
    expect(useAppStore.getState().chartData60s[1].ts).toBe(1060000);
  });

  it('exposes a metrics error instead of remaining in a loading state', async () => {
    useAppStore.getState().setWallet('wallet-a');
    vi.mocked(fetchMetrics).mockRejectedValue(new Error('Network unavailable'));
    const { result } = renderHook(() => useMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network unavailable');
  });

  it('does not display wallet A payouts after changing to wallet B', async () => {
    localStorage.setItem(payoutHistoryKey('wallet-a'), JSON.stringify([{ timestamp: new Date().toISOString(), amountBtc: .01, fiatValueUsd: 1000, verified: true, status: 'confirmed', officialId: 'wallet-a-tx' }]));
    useAppStore.getState().setWallet('wallet-a');
    const { result, rerender } = renderHook(({ metrics }) => usePayoutTracking(metrics), { initialProps: { metrics: snapshot('wallet-a') } });
    await waitFor(() => expect(result.current.lastPayout?.officialId).toBe('wallet-a-tx'));
    act(() => useAppStore.getState().setWallet('wallet-b'));
    rerender({ metrics: snapshot('wallet-b') });
    await waitFor(() => expect(result.current.lastPayout).toBeNull());
    expect(result.current.newPayoutDetected).toBe(false);
    expect(localStorage.getItem(payoutHistoryKey('wallet-b'))).toBe('[]');
  });

  it('ignores a pending verification after the wallet changes', async () => {
    const a = deferred<EarningsResponse>();
    vi.mocked(fetchEarnings).mockReturnValueOnce(a.promise).mockResolvedValue(emptyEarnings);
    useAppStore.getState().setWallet('wallet-a');
    const { result, rerender } = renderHook(({ metrics }) => usePayoutTracking(metrics), { initialProps: { metrics: snapshot('wallet-a') } });
    act(() => useAppStore.getState().setWallet('wallet-b'));
    rerender({ metrics: snapshot('wallet-b') });
    await act(async () => a.resolve({ ...emptyEarnings, payments: [{ date: new Date().toISOString(), txid: 'wallet-a-tx', lightning_txid: '', amount_btc: .01, amount_sats: 1000000, status: 'confirmed' }] }));
    expect(result.current.payoutHistory).toEqual([]);
    expect(localStorage.getItem(payoutHistoryKey('wallet-b'))).not.toContain('wallet-a-tx');
  });
});

describe('authoritative wallet refresh', () => {
  const config = (wallet: string) => ({ wallet } as AppConfig);

  it('rechecks configuration on Retry, focus, and the regular poll', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchConfig)
      .mockResolvedValueOnce(config('wallet-a'))
      .mockResolvedValueOnce(config('wallet-b'))
      .mockResolvedValueOnce(config('wallet-c'))
      .mockResolvedValueOnce(config('wallet-d'));
    const hook = renderHook(() => useWalletScope());
    await act(async () => {});
    expect(useAppStore.getState().wallet).toBe('wallet-a');
    await act(async () => window.dispatchEvent(new Event('deepsea:refresh-metrics')));
    expect(useAppStore.getState().wallet).toBe('wallet-b');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(useAppStore.getState().wallet).toBe('wallet-c');
    await act(async () => vi.advanceTimersByTime(60000));
    expect(useAppStore.getState().wallet).toBe('wallet-d');
    hook.unmount();
  });

  it('does not restore an old wallet from a configuration read started before a save', async () => {
    const old = deferred<AppConfig>();
    vi.mocked(fetchConfig).mockResolvedValueOnce(config('wallet-a')).mockReturnValueOnce(old.promise);
    const hook = renderHook(() => useWalletScope());
    await waitFor(() => expect(useAppStore.getState().wallet).toBe('wallet-a'));
    act(() => window.dispatchEvent(new Event('deepsea:refresh-metrics')));
    act(() => useAppStore.getState().setWallet('wallet-b'));
    await act(async () => old.resolve(config('wallet-a')));
    expect(useAppStore.getState().wallet).toBe('wallet-b');
    hook.unmount();
  });
});

describe('stream recovery', () => {
  it('clears a REST connection failure on a fresh event and ignores old-wallet events', () => {
    const sources: FakeSource[] = [];
    class FakeSource {
      listeners = new Map<string, ((event: MessageEvent) => void)[]>();
      constructor() { sources.push(this); }
      addEventListener(type: string, callback: (event: MessageEvent) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
      }
      close() { /* Capture old callbacks to verify scope guards. */ }
      emit(type: string, data: object) {
        for (const callback of this.listeners.get(type) ?? []) callback({ data: JSON.stringify(data) } as MessageEvent);
      }
    }
    const original = globalThis.EventSource;
    vi.stubGlobal('EventSource', FakeSource);
    useAppStore.getState().setWallet('wallet-a');
    const hook = renderHook(() => useSSE());
    publishApiStatus({ path: '/metrics', status: 'unavailable', updatedAt: null, error: 'Offline' });
    act(() => sources[0].emit('metrics', snapshot('wallet-a')));
    expect(getApiStatus()).toBeNull();
    act(() => sources[0].emit('metrics', { ...snapshot('wallet-a', 100), data_status: 'stale' }));
    expect(getApiStatus()).toBeNull();
    expect(useAppStore.getState().metrics?.data_updated_at).toBe(1000);
    act(() => useAppStore.getState().setWallet('wallet-b'));
    act(() => sources[0].emit('metrics', snapshot('wallet-a', 2000)));
    expect(useAppStore.getState().metrics).toBeNull();
    act(() => sources[1].emit('metrics', snapshot('wallet-b', 3000)));
    expect(useAppStore.getState().metrics?.wallet).toBe('wallet-b');
    hook.unmount();
    vi.stubGlobal('EventSource', original);
  });
});

describe('global alert count', () => {
  it('loads away from Alerts and does not shrink to a filtered category count', async () => {
    const notifications = [{ id: 'hash-alert', read: false }] as Notification[];
    vi.mocked(fetchNotifications).mockResolvedValue(notifications);
    renderHook(() => useUnreadCount());
    await waitFor(() => expect(useAppStore.getState().unreadCount).toBe(2));
    renderHook(() => useNotifications('hashrate'));
    await waitFor(() => expect(useAppStore.getState().notifications).toEqual(notifications));
    expect(useAppStore.getState().unreadCount).toBe(2);
  });
});

describe('page request ordering', () => {
  it('keeps the newer earnings range when a slower old response arrives', async () => {
    const old = deferred<EarningsResponse>();
    const recent = { ...emptyEarnings, total_sats: 3000, total_btc: .00003 };
    vi.mocked(fetchEarnings).mockImplementation((days) => days === 90 ? old.promise : Promise.resolve(recent));
    render(<Earnings />);
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    await screen.findByText('3,000');
    await act(async () => old.resolve({ ...emptyEarnings, total_sats: 9000, total_btc: .00009 }));
    expect(screen.queryByText('9,000')).not.toBeInTheDocument();
    expect(screen.getByText('PAYMENTS (30D)')).toBeInTheDocument();
  });

  it('does not relabel old totals while the requested earnings range is loading', async () => {
    const recent = deferred<EarningsResponse>();
    vi.mocked(fetchEarnings).mockImplementation((days) => days === 30 ? recent.promise : Promise.resolve({ ...emptyEarnings, total_sats: 9000 }));
    render(<Earnings />);
    await screen.findByText('9,000');
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    expect(screen.getByText('PAYMENTS (90D)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing the last completed 90-day result');
    await act(async () => recent.resolve(emptyEarnings));
  });

  it('refreshes the distribution together with the current block page', async () => {
    vi.mocked(fetchBlocks).mockImplementation((page, page_size) => Promise.resolve({ page: page ?? 0, page_size: page_size ?? 20, total: 0, blocks: [] }));
    render(<Blocks />);
    await waitFor(() => expect(fetchBlocks).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /REFRESH/ }));
    await waitFor(() => expect(fetchBlocks).toHaveBeenCalledTimes(4));
    expect(vi.mocked(fetchBlocks).mock.calls.filter(([, size]) => size === 100)).toHaveLength(2);
  });
});
