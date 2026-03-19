// Zustand global store
import { create } from 'zustand';
import type { DashboardMetrics, WorkerSummary, Notification, Theme } from '../types';

interface ChartPoint {
  label: string;
  value: number;
}

interface AppState {
  // Metrics
  metrics: DashboardMetrics | null;
  prevMetrics: DashboardMetrics | null;
  setMetrics: (m: DashboardMetrics) => void;

  // Chart history (persists across route changes)
  chartData60s: ChartPoint[];
  chartData3hr: ChartPoint[];
  addChartPoint: (hr60s: number, hr3hr: number) => void;
  chartHydrated: boolean;
  hydrateChart: (points: { timestamp: number; hashrate_60sec: number; hashrate_3hr: number }[]) => void;

  // Workers
  workers: WorkerSummary | null;
  setWorkers: (w: WorkerSummary) => void;

  // Notifications
  notifications: Notification[];
  unreadCount: number;
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
  metrics: null,
  prevMetrics: null,
  setMetrics: (m) =>
    set({ prevMetrics: get().metrics, metrics: m, lastUpdated: Date.now() }),

  chartData60s: [],
  chartData3hr: [],
  chartHydrated: false,
  addChartPoint: (hr60s, hr3hr) =>
    set((s) => {
      const ts = new Date().toLocaleTimeString();
      return {
        chartData60s: [...s.chartData60s.slice(-59), { label: ts, value: hr60s }],
        chartData3hr: [...s.chartData3hr.slice(-59), { label: ts, value: hr3hr }],
      };
    }),
  hydrateChart: (points) =>
    set(() => {
      const data60s = points.map((p) => ({
        label: new Date(p.timestamp * 1000).toLocaleTimeString(),
        value: p.hashrate_60sec,
      }));
      const data3hr = points.map((p) => ({
        label: new Date(p.timestamp * 1000).toLocaleTimeString(),
        value: p.hashrate_3hr,
      }));
      return {
        chartData60s: data60s.slice(-60),
        chartData3hr: data3hr.slice(-60),
        chartHydrated: true,
      };
    }),

  workers: null,
  setWorkers: (w) => set({ workers: w }),

  notifications: [],
  unreadCount: 0,
  setNotifications: (n) =>
    set({ notifications: n, unreadCount: n.filter((x) => !x.read).length }),
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
