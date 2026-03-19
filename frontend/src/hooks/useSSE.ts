// SSE hook with auto-reconnect and typed events
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/store';
import type { DashboardMetrics, WorkerSummary } from '../types';

const SSE_URL = '/api/stream';
const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 30000;

export function useSSE() {
  const setMetrics = useAppStore((s) => s.setMetrics);
  const setWorkers = useAppStore((s) => s.setWorkers);
  const setSseConnected = useAppStore((s) => s.setSseConnected);
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const es = new EventSource(SSE_URL);
      esRef.current = es;

      es.addEventListener('open', () => {
        if (!mountedRef.current) return;
        setSseConnected(true);
        backoffRef.current = INITIAL_BACKOFF;
      });

      es.addEventListener('metrics', (e: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(e.data) as DashboardMetrics;
          setMetrics(data);
        } catch (_) {/* ignore */}
      });

      es.addEventListener('workers', (e: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(e.data) as WorkerSummary;
          setWorkers(data);
        } catch (_) {/* ignore */}
      });

      es.addEventListener('heartbeat', () => {
        // keep-alive, no action needed
      });

      es.addEventListener('error', () => {
        if (!mountedRef.current) return;
        setSseConnected(false);
        es.close();
        esRef.current = null;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
        setTimeout(connect, delay);
      });
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [setMetrics, setWorkers, setSseConnected]);
}
