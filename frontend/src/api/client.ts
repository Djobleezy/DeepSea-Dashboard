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

const RAW_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const BASE = String(RAW_BASE).replace(/\/+$/, '');
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 10000);

const MAX_RATE_LIMIT_RETRIES = 3;

// Simple toast helper — avoids importing a full toast library here
function _showRateLimitToast(message: string): void {
  const existing = document.getElementById('_deepsea_rl_toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = '_deepsea_rl_toast';
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: 'rgba(13, 26, 36, 0.92)',
    color: '#a0d4f5',
    border: '1px solid #0055aa',
    borderRadius: '4px',
    padding: '8px 16px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.5px',
    zIndex: '9999',
    opacity: '0',
    transition: 'opacity 0.2s',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${BASE}${normalizedPath}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  return url.toString();
}

async function request<T>(
  path: string,
  init?: RequestInit,
  params?: Record<string, string | number | boolean>,
  _retryCount = 0,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(path, params), {
      ...init,
      signal: controller.signal,
    });

    // Handle 429 Rate Limited with automatic retry
    if (res.status === 429 && _retryCount < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterSec = retryAfterHeader ? Math.min(parseInt(retryAfterHeader, 10) || 5, 60) : 5;
      const delayMs = retryAfterSec * 1000 * (_retryCount + 1); // linear backoff

      _showRateLimitToast(`Rate limited — retrying in ${retryAfterSec}s… (${_retryCount + 1}/${MAX_RATE_LIMIT_RETRIES})`);

      if (localStorage.getItem('debugMode') === 'true') {
        console.debug('[DeepSea] 429 on', path, '— retry', _retryCount + 1, 'after', delayMs, 'ms');
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
      return request<T>(path, init, params, _retryCount + 1);
    }

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

// Exchange rates
export const fetchExchangeRates = () =>
  get<{ base: string; currencies: string[]; rates: Record<string, number> }>('/exchange-rates');

// ---------------------------------------------------------------------------
// Batch fetch client
// ---------------------------------------------------------------------------
// Queues individual GET requests and flushes them as a single /api/batch POST
// after a 50ms debounce window. This reduces waterfall latency on page load.
// Fallback: if batch fails, all queued requests are retried individually.
// ---------------------------------------------------------------------------

interface BatchQueueEntry {
  path: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface BatchResponse {
  status: number;
  body: unknown;
}

interface BatchResult {
  responses: BatchResponse[];
  executed: number;
  duration_ms: number;
}

const _batchQueue: BatchQueueEntry[] = [];
let _batchTimer: ReturnType<typeof window.setTimeout> | null = null;
const BATCH_DEBOUNCE_MS = 50;

async function _flushBatch(): Promise<void> {
  const entries = _batchQueue.splice(0);
  _batchTimer = null;

  if (entries.length === 0) return;

  const paths = entries.map((e) => e.path);

  try {
    const result = await post<BatchResult>('/batch', {
      requests: paths.map((path) => ({ method: 'GET', path: `${BASE}${path}` })),
    });

    result.responses.forEach((resp, i) => {
      const entry = entries[i];
      if (!entry) return;
      if (resp.status >= 200 && resp.status < 300) {
        entry.resolve(resp.body);
      } else {
        entry.reject(new Error(`Batch sub-request ${paths[i]} failed: ${resp.status}`));
      }
    });
  } catch (_batchError) {
    // Batch endpoint failed — fall back to individual requests
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          const result = await get<unknown>(entry.path);
          entry.resolve(result);
        } catch (err) {
          entry.reject(err);
        }
      }),
    );
  }
}

/**
 * Queue a GET request to be included in the next batch flush.
 * Multiple calls within 50ms are coalesced into a single /api/batch POST.
 * Falls back to individual fetch if batch fails.
 */
export function batchFetch<T>(path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _batchQueue.push({ path, resolve: resolve as (v: unknown) => void, reject });

    if (_batchTimer !== null) {
      window.clearTimeout(_batchTimer);
    }
    _batchTimer = window.setTimeout(_flushBatch, BATCH_DEBOUNCE_MS);
  });
}

// Client error reporting
export interface ClientErrorPayload {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  url?: string;
}

export const postClientError = (payload: ClientErrorPayload) =>
  post<{ ok: boolean }>('/client-errors', payload).catch(() => {
    // Fire-and-forget: never throw from error reporting itself
  });
