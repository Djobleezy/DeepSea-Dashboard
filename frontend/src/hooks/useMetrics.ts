import { useCallback, useEffect, useRef } from 'react';
import { fetchMetrics } from '../api/client';
import { useAppStore } from '../stores/store';

export function useMetrics(pollMs = 60000) {
  const setMetrics = useAppStore((s) => s.setMetrics);
  const metrics = useAppStore((s) => s.metrics);
  const wallet = useAppStore((s) => s.wallet);
  const loading = useAppStore((s) => s.metricsLoading);
  const error = useAppStore((s) => s.metricsError);
  const setLoading = useAppStore((s) => s.setMetricsLoading);
  const setError = useAppStore((s) => s.setMetricsError);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const scope = useAppStore.getState();
    if (scope.wallet === null) return;
    const requestId = ++requestIdRef.current;

    try {
      const m = await fetchMetrics();
      if (!mountedRef.current || requestId !== requestIdRef.current || scope.walletEpoch !== useAppStore.getState().walletEpoch) return;
      setMetrics(m);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current || scope.walletEpoch !== useAppStore.getState().walletEpoch) return;
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current && scope.walletEpoch === useAppStore.getState().walletEpoch) {
        setLoading(false);
      }
    }
  }, [setMetrics, setError, setLoading]);

  useEffect(() => {
    mountedRef.current = true;
    if (wallet === null) return;
    load();
    timerRef.current = setInterval(load, pollMs);
    const refresh = () => { void load(); };
    window.addEventListener('deepsea:refresh-metrics', refresh);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener('deepsea:refresh-metrics', refresh);
    };
  }, [load, pollMs, wallet]);

  return { metrics, loading, error, refresh: load };
}
