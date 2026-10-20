// Zustand global store
import { create } from 'zustand';
import type { DashboardMetrics, WorkerSummary, Notification, Theme } from '../types';
import { appendChartPoint, chartPoint, mergeChartPoints, sourceTimeMs, validHashrate } from '../utils/hashrateHistory';
import type { ChartPoint, HistoryHours, MetricHistoryPoint } from '../utils/hashrateHistory';

export type { ChartPoint } from '../utils/hashrateHistory';

interface SnapshotRevision {
  snapshot_updated_at?: number;
}

interface AppState {
  wallet: string | null;
  walletEpoch: number;
  setWallet: (wallet: string) => void;
  // Metrics
  metrics: DashboardMetrics | null;
  prevMetrics: DashboardMetrics | null;
  setMetrics: (m: DashboardMetrics) => boolean;
  metricsLoading: boolean;
  metricsError: string | null;
  setMetricsLoading: (loading: boolean) => void;
  setMetricsError: (error: string | null) => void;
  requestMetricsRefresh: () => void;

  // Chart history (persists across route changes)
  chartData60s: ChartPoint[];
  chartData3hr: ChartPoint[];
  addChartPoint: (hr60s: number, hr3hr: number, sourceTimestamp?: number | null) => void;
  chartHydrated: boolean;
  chartHours: HistoryHours;
  chartLoadedHours: number;
  setChartHours: (hours: HistoryHours) => void;
  hydrateChart: (points: MetricHistoryPoint[], expectedWalletEpoch?: number, hours?: number) => void;

  // Workers
  workers: WorkerSummary | null;
  setWorkers: (w: WorkerSummary) => boolean;

  // Notifications
  notifications: Notification[];
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  setNotifications: (n: Notification[]) => void;
  addNotification: (n: Notification) => void;

  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;

  // Connection state
  sseConnected: boolean;
  setSseConnected: (v: boolean) => void;

  // Last updated
  lastUpdated: number | null;
  setLastUpdated: (ts: number) => void;
}

function appendSample(state: AppState, hr60s: number, hr3hr: number, timestamp: unknown) {
  const ts = sourceTimeMs(timestamp, Date.now());
  if (ts === null || !validHashrate(hr60s) || !validHashrate(hr3hr)) return {};
  const first = chartPoint(hr60s, ts);
  return {
    chartData60s: appendChartPoint(state.chartData60s, first),
    chartData3hr: appendChartPoint(state.chartData3hr, chartPoint(hr3hr, ts, first.label)),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  wallet: null,
  walletEpoch: 0,
  setWallet: (rawWallet) => {
    const wallet = rawWallet.trim();
    if (get().wallet === wallet) return;
    set((s) => ({
      wallet, walletEpoch: s.walletEpoch + 1,
      metrics: null, prevMetrics: null, workers: null, lastUpdated: null,
      chartData60s: [], chartData3hr: [], chartHydrated: false, chartLoadedHours: 0,
      metricsLoading: true, metricsError: null,
    }));
    // Legacy payout records had no wallet ownership and cannot be migrated safely.
    try {
      localStorage.removeItem('deepsea_payout_history');
      localStorage.setItem('deepsea_wallet', wallet);
    } catch { /* Storage can be unavailable in private browsing. */ }
  },
  metrics: null,
  prevMetrics: null,
  metricsLoading: true,
  metricsError: null,
  setMetricsLoading: (metricsLoading) => set({ metricsLoading }),
  setMetricsError: (metricsError) => set((s) => ({ metricsError, metricsLoading: metricsError ? false : s.metricsLoading })),
  requestMetricsRefresh: () => window.dispatchEvent(new Event('deepsea:refresh-metrics')),
  setMetrics: (m) => {
    const current = get();
    if (m.wallet !== undefined && m.wallet !== current.wallet) return false;
    const sourceTimestamp = m.data_updated_at ?? m.server_timestamp;
    // A future sample must not move either retention or response ordering into
    // the future, otherwise later real readings could be rejected indefinitely.
    if (m.data_updated_at !== null && sourceTimestamp !== undefined && sourceTimeMs(sourceTimestamp, Date.now()) === null) return false;
    const sourceTime = m.data_updated_at === null ? null
      : (m.data_updated_at ?? m.server_timestamp) * 1000;
    const revision = (m as DashboardMetrics & SnapshotRevision).snapshot_updated_at;
    const previousRevision = (current.metrics as (DashboardMetrics & SnapshotRevision) | null)?.snapshot_updated_at;
    if (sourceTime === null && current.metrics && current.lastUpdated !== null) {
      // A no-data response cannot erase a successful reading from this wallet.
      // A restarted backend has revision 0: handle its loss of data before
      // ordering snapshots, keeping the last reading's age and revision.
      const retained: DashboardMetrics & SnapshotRevision = {
        ...current.metrics,
        ...(typeof revision === 'number' && (previousRevision === undefined || revision > previousRevision) ? { snapshot_updated_at: revision } : {}),
        data_status: 'stale', data_error: m.data_error ?? 'Current mining data is unavailable.',
      };
      set({
        metrics: retained,
        metricsLoading: false,
        metricsError: m.data_error ?? 'Current mining data is unavailable.',
      });
      return true;
    }
    // Financial recalculations can share a mining-source timestamp. Their
    // separate revision prevents a delayed pre-save response undoing a save.
    const hasRevisions = typeof revision === 'number' && typeof previousRevision === 'number';
    if (hasRevisions ? revision < previousRevision
      : sourceTime !== null && current.lastUpdated !== null && sourceTime < current.lastUpdated) return false;
    set({
      prevMetrics: current.metrics, metrics: m, lastUpdated: sourceTime,
      metricsLoading: false,
      metricsError: m.data_error ?? (m.data_status === 'stale' ? 'Showing previously received data.' : null),
      // Capture in the shared ingestion path, including while Dashboard is not
      // mounted. A repeated/recalculated snapshot cannot manufacture a sample.
      ...(current.wallet && (!m.data_status || m.data_status === 'fresh')
        ? appendSample(current, m.hashrate_60sec, m.hashrate_3hr, m.data_updated_at)
        : {}),
    });
    return true;
  },

  chartData60s: [],
  chartData3hr: [],
  chartHydrated: false,
  chartHours: 24,
  chartLoadedHours: 0,
  setChartHours: (chartHours) => set({ chartHours }),
  addChartPoint: (hr60s, hr3hr, sourceTimestamp) =>
    set((s) => appendSample(s, hr60s, hr3hr, sourceTimestamp)),
  hydrateChart: (points, expectedWalletEpoch, hours = 1) =>
    set((s) => {
      if (expectedWalletEpoch !== undefined && s.walletEpoch !== expectedWalletEpoch) return s;
      const data60s: ChartPoint[] = [];
      const data3hr: ChartPoint[] = [];
      const now = Date.now();
      for (const point of points) {
        const ts = sourceTimeMs(point?.timestamp, now);
        if (ts === null || !validHashrate(point?.hashrate_60sec) || !validHashrate(point?.hashrate_3hr)) continue;
        const first = { ...chartPoint(point.hashrate_60sec, ts), gapBefore: point.gap_before };
        data60s.push(first);
        data3hr.push({ ...chartPoint(point.hashrate_3hr, ts, first.label), gapBefore: point.gap_before });
      }

      return {
        // Merge hydrated history with any already-received live points.
        chartData60s: mergeChartPoints(data60s, s.chartData60s),
        chartData3hr: mergeChartPoints(data3hr, s.chartData3hr),
        chartHydrated: true,
        chartLoadedHours: Math.max(s.chartLoadedHours, hours),
      };
    }),

  workers: null,
  setWorkers: (w) => {
    const current = get();
    if (w.wallet !== undefined && w.wallet !== current.wallet) return false;
    const sourceTime = (w as WorkerSummary & Pick<DashboardMetrics, 'data_updated_at'>).data_updated_at;
    const previousTime = (current.workers as (WorkerSummary & Pick<DashboardMetrics, 'data_updated_at'>) | null)?.data_updated_at;
    const revision = (w as WorkerSummary & SnapshotRevision).snapshot_updated_at;
    const previousRevision = (current.workers as (WorkerSummary & SnapshotRevision) | null)?.snapshot_updated_at;
    if (sourceTime === null && typeof previousTime === 'number' && current.workers) {
      const retained = {
        ...current.workers,
        ...(typeof revision === 'number' && (previousRevision === undefined || revision > previousRevision) ? { snapshot_updated_at: revision } : {}),
        data_status: 'stale',
      };
      set({ workers: retained as WorkerSummary });
      return true;
    }
    const hasRevisions = typeof revision === 'number' && typeof previousRevision === 'number';
    if (hasRevisions ? revision < previousRevision
      : typeof sourceTime === 'number' && typeof previousTime === 'number' && sourceTime < previousTime) return false;
    set({ workers: w });
    return true;
  },

  notifications: [],
  unreadCount: 0,
  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),
  setNotifications: (n) => set({ notifications: n }),
  addNotification: (n) =>
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, 500),
      unreadCount: s.unreadCount + (n.read ? 0 : 1),
    })),

  theme: (localStorage.getItem('theme') as Theme) || 'deepsea',
  setTheme: (t) => {
    localStorage.setItem('theme', t);
    set({ theme: t });
  },

  sseConnected: false,
  setSseConnected: (v) => set({ sseConnected: v }),

  lastUpdated: null,
  setLastUpdated: (ts) => set({ lastUpdated: ts }),
}));
