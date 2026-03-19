import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMetrics } from '../api/client';
import { useAppStore } from '../stores/store';

export function useMetrics(pollMs = 60000) {
  const setMetrics = useAppStore((s) => s.setMetrics);
  const metrics = useAppStore((s) => s.metrics);
  const [loading, setLoading] = useState(!metrics);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const m = await fetchMetrics();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setMetrics(m);
      setError(null);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, [setMetrics]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    timerRef.current = setInterval(load, pollMs);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, pollMs]);

  return { metrics, loading, error, refresh: load };
}
