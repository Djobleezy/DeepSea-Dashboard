// Zustand global store
import { create } from 'zustand';
import type { DashboardMetrics, WorkerSummary, Notification, Theme } from '../types';

interface ChartPoint {
  label: string;
  value: number;
  ts: number;
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
  hydrateChart: (points: { timestamp: number; hashrate_60sec: number; hashrate_3hr: number }[]) => void;

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

export const useAppStore = create<AppState>((set, get) => ({
  wallet: null,
  walletEpoch: 0,
  setWallet: (rawWallet) => {
    const wallet = rawWallet.trim();
    if (get().wallet === wallet) return;
    set((s) => ({
      wallet, walletEpoch: s.walletEpoch + 1,
      metrics: null, prevMetrics: null, workers: null, lastUpdated: null,
      chartData60s: [], chartData3hr: [], chartHydrated: false,
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
    const sourceTime = m.data_updated_at === null ? null
      : (m.data_updated_at ?? m.server_timestamp) * 1000;
    // A delayed REST response must not roll back a newer streamed snapshot.
    if (sourceTime !== null && current.lastUpdated !== null && sourceTime < current.lastUpdated) return false;
    if (sourceTime === null && current.metrics && current.lastUpdated !== null) {
      // A no-data response cannot erase a successful reading from this wallet.
      // Keep its age and values, while making the lost source explicit.
      set({
        metrics: { ...current.metrics, data_status: 'stale', data_error: m.data_error ?? 'Current mining data is unavailable.' },
        metricsLoading: false,
        metricsError: m.data_error ?? 'Current mining data is unavailable.',
      });
      return true;
    }
    set({
      prevMetrics: current.metrics, metrics: m, lastUpdated: sourceTime,
      metricsLoading: false,
      metricsError: m.data_error ?? (m.data_status === 'stale' ? 'Showing previously received data.' : null),
    });
    return true;
  },

  chartData60s: [],
  chartData3hr: [],
  chartHydrated: false,
  addChartPoint: (hr60s, hr3hr, sourceTimestamp) =>
    set((s) => {
      const ts = sourceTimestamp ? sourceTimestamp * 1000 : Date.now();
      const label = new Date(ts).toLocaleTimeString();
      const append = (points: ChartPoint[], value: number) => [
        ...points.filter((point) => Math.floor(point.ts / 1000) !== Math.floor(ts / 1000)),
        { label, value, ts },
      ].sort((a, b) => a.ts - b.ts).slice(-60);
      return {
        chartData60s: append(s.chartData60s, hr60s),
        chartData3hr: append(s.chartData3hr, hr3hr),
      };
    }),
  hydrateChart: (points) =>
    set((s) => {
      const data60s = points.map((p) => ({
        label: new Date(p.timestamp * 1000).toLocaleTimeString(),
        value: p.hashrate_60sec,
        ts: p.timestamp * 1000,
      }));
      const data3hr = points.map((p) => ({
        label: new Date(p.timestamp * 1000).toLocaleTimeString(),
        value: p.hashrate_3hr,
        ts: p.timestamp * 1000,
      }));

      const mergeByTimestamp = (historical: ChartPoint[], live: ChartPoint[]) => {
        const merged = new Map<string, ChartPoint>();
        [...historical, ...live].forEach((point) => {
          const key = `ts:${Math.floor(point.ts / 1000)}`;
          merged.set(key, point);
        });
        return Array.from(merged.values())
          .sort((a, b) => a.ts - b.ts)
          .slice(-60);
      };

      return {
        // Merge hydrated history with any already-received live points.
        chartData60s: mergeByTimestamp(data60s, s.chartData60s),
        chartData3hr: mergeByTimestamp(data3hr, s.chartData3hr),
        chartHydrated: true,
      };
    }),

  workers: null,
  setWorkers: (w) => {
    const current = get();
    if (w.wallet !== undefined && w.wallet !== current.wallet) return false;
    const sourceTime = (w as WorkerSummary & Pick<DashboardMetrics, 'data_updated_at'>).data_updated_at;
    const previousTime = (current.workers as (WorkerSummary & Pick<DashboardMetrics, 'data_updated_at'>) | null)?.data_updated_at;
    if (typeof sourceTime === 'number' && typeof previousTime === 'number' && sourceTime < previousTime) return false;
    if (sourceTime === null && typeof previousTime === 'number' && current.workers) {
      set({ workers: { ...current.workers, data_status: 'stale' } as WorkerSummary });
      return true;
    }
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
