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
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 10000);

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit, params?: Record<string, string | number | boolean>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(path, params), {
      ...init,
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API ${init?.method ?? 'GET'} ${path} failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`API ${init?.method ?? 'GET'} ${path} timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  return request<T>(path, undefined, params);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
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
