// Typed API client for DeepSea Dashboard backend

import type {
  AppConfig,
  BlocksResponse,
  DashboardMetrics,
  EarningsResponse,
  HealthStatus,
  Notification,
  WorkerSummary,
} from '../types';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API PATCH ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API DELETE ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// Metrics
export const fetchMetrics = () => get<DashboardMetrics>('/metrics');

export const fetchMetricHistory = (hours = 1) =>
  get<{ timestamp: number; hashrate_60sec: number; hashrate_3hr: number }[]>('/metrics/history', { hours });

// Workers
export const fetchWorkers = (
  status = 'all',
  sortBy = 'name',
  descending = false,
) =>
  get<WorkerSummary>('/workers', { status, sort_by: sortBy, descending });

// Blocks
export const fetchBlocks = (page = 0, pageSize = 20) =>
  get<BlocksResponse>('/blocks', { page, page_size: pageSize });

// Earnings
export const fetchEarnings = (days = 90) =>
  get<EarningsResponse>('/earnings', { days });

// Notifications
export const fetchNotifications = (
  category = 'all',
  unreadOnly = false,
  limit = 100,
) =>
  get<Notification[]>('/notifications', { category, unread_only: unreadOnly, limit });

export const markNotificationRead = (id: string) =>
  patch<{ ok: boolean }>(`/notifications/${id}/read`);

export const markAllRead = () =>
  post<{ marked_read: number }>('/notifications/read-all');

export const deleteNotification = (id: string) =>
  del<{ ok: boolean }>(`/notifications/${id}`);

export const clearReadNotifications = () =>
  del<{ cleared: number }>('/notifications/clear/read');

export const clearAllNotifications = () =>
  del<{ cleared: number }>('/notifications/clear/all');

// Config
export const fetchConfig = () => get<AppConfig>('/config');
export const updateConfig = (cfg: Partial<AppConfig>) =>
  post<AppConfig>('/config', cfg);
export const fetchTimezones = () =>
  get<{ timezones: string[] }>('/timezones');

// Health
export const fetchHealth = () => get<HealthStatus>('/health');
