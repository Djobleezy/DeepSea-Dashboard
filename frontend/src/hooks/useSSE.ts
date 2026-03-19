// SSE hook with reconnect, stale-connection detection, and REST re-sync
import { useEffect, useRef } from 'react';
import { fetchMetrics, fetchWorkers } from '../api/client';
import { useAppStore } from '../stores/store';
import type { DashboardMetrics, WorkerSummary } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const SSE_URL = `${API_BASE}/stream`;
const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 30000;
const STALE_AFTER_MS = 70000;
const WATCHDOG_INTERVAL_MS = 10000;

export function useSSE() {
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

    async function resyncSnapshot() {
      try {
        const [metrics, workers] = await Promise.all([fetchMetrics(), fetchWorkers()]);
        if (!mountedRef.current) return;
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
      if (!mountedRef.current || reconnectTimerRef.current) return;
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
      if (!mountedRef.current) return;

      closeConnection(false);
      const es = new EventSource(SSE_URL);
      esRef.current = es;
      markActivity();

      es.addEventListener('open', () => {
        if (!mountedRef.current) return;
        markActivity();
        setSseConnected(true);
        backoffRef.current = INITIAL_BACKOFF;
        void resyncSnapshot();
      });

      es.addEventListener('metrics', (e: MessageEvent) => {
        if (!mountedRef.current) return;
        markActivity();
        try {
          const data = JSON.parse(e.data) as DashboardMetrics;
          setMetrics(data);
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('workers', (e: MessageEvent) => {
        if (!mountedRef.current) return;
        markActivity();
        try {
          const data = JSON.parse(e.data) as WorkerSummary;
          setWorkers(data);
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('heartbeat', () => {
        markActivity();
      });

      es.addEventListener('error', () => {
        if (!mountedRef.current) return;
        closeConnection();
        scheduleReconnect();
      });
    }

    connect();
    watchdogTimerRef.current = setInterval(() => {
      if (!mountedRef.current || !esRef.current) return;
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
  }, [setMetrics, setWorkers, setSseConnected]);
}
