// SSE hook with reconnect, stale-connection detection, and REST re-sync
import { useEffect, useRef } from 'react';
import { fetchMetrics, fetchWorkers } from '../api/client';
import { useAppStore } from '../stores/store';
import { publishApiStatus } from '../api/status';
import type { DashboardMetrics, WorkerSummary } from '../types';

const API_BASE = String(import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');
const SSE_URL = `${API_BASE}/stream`;
const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 30000;
const STALE_AFTER_MS = 70000;
const WATCHDOG_INTERVAL_MS = 10000;

function publishSnapshotStatus(path: string, snapshot: object) {
  const data = snapshot as Pick<DashboardMetrics, 'data_status' | 'data_updated_at' | 'data_error'>;
  publishApiStatus({
    path,
    status: data.data_status === 'stale' ? 'stale' : data.data_status === 'unavailable' ? 'unavailable' : 'fresh',
    updatedAt: data.data_updated_at ?? null,
    error: data.data_error ?? null,
  });
}

export function useSSE() {
  const wallet = useAppStore((s) => s.wallet);
  const setMetrics = useAppStore((s) => s.setMetrics);
  const setWorkers = useAppStore((s) => s.setWorkers);
  const setSseConnected = useAppStore((s) => s.setSseConnected);
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageAtRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (wallet === null) return;
    const scopeEpoch = useAppStore.getState().walletEpoch;
    const isCurrent = () => mountedRef.current && scopeEpoch === useAppStore.getState().walletEpoch;

    async function resyncSnapshot() {
      try {
        const [metrics, workers] = await Promise.all([fetchMetrics(), fetchWorkers()]);
        if (!isCurrent()) return;
        setMetrics(metrics);
        setWorkers(workers);
      } catch {
        // Ignore — polling hooks remain a secondary recovery path.
      }
    }

    function markActivity() {
      lastMessageAtRef.current = Date.now();
    }

    function scheduleReconnect() {
      if (!isCurrent() || reconnectTimerRef.current) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function closeConnection(markDisconnected = true) {
      if (markDisconnected) setSseConnected(false);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    }

    function connect() {
      if (!isCurrent()) return;

      closeConnection(false);
      const es = new EventSource(SSE_URL);
      esRef.current = es;
      markActivity();

      es.addEventListener('open', () => {
        if (!isCurrent()) return;
        markActivity();
        setSseConnected(true);
        backoffRef.current = INITIAL_BACKOFF;
        void resyncSnapshot();
      });

      es.addEventListener('metrics', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markActivity();
        try {
          const data = JSON.parse(e.data) as DashboardMetrics;
          if (data.wallet !== undefined && data.wallet !== useAppStore.getState().wallet) return;
          if (setMetrics(data)) {
            publishSnapshotStatus('/metrics', useAppStore.getState().metrics ?? data);
          }
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('workers', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markActivity();
        try {
          const data = JSON.parse(e.data) as WorkerSummary;
          if (data.wallet !== undefined && data.wallet !== useAppStore.getState().wallet) return;
          if (setWorkers(data)) {
            publishSnapshotStatus('/workers', useAppStore.getState().workers ?? data);
          }
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('heartbeat', () => {
        markActivity();
      });

      es.addEventListener('error', () => {
        if (!isCurrent()) return;
        closeConnection();
        scheduleReconnect();
      });
    }

    connect();
    watchdogTimerRef.current = setInterval(() => {
      if (!isCurrent() || !esRef.current) return;
      if (Date.now() - lastMessageAtRef.current <= STALE_AFTER_MS) return;
      closeConnection();
      scheduleReconnect();
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      closeConnection();
    };
  }, [setMetrics, setWorkers, setSseConnected, wallet]);
}
