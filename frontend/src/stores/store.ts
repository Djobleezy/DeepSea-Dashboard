// Zustand global store
import { create } from 'zustand';
import type { DashboardMetrics, WorkerSummary, Notification, Theme } from '../types';

interface AppState {
  // Metrics
  metrics: DashboardMetrics | null;
  prevMetrics: DashboardMetrics | null;
  setMetrics: (m: DashboardMetrics) => void;

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
