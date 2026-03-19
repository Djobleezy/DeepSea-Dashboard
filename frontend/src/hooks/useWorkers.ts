import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWorkers } from '../api/client';
import { useAppStore } from '../stores/store';

export function useWorkers(
  status = 'all',
  sortBy = 'name',
  descending = false,
  pollMs = 60000,
) {
  const setWorkers = useAppStore((s) => s.setWorkers);
  const workers = useAppStore((s) => s.workers);
  const [loading, setLoading] = useState(!workers);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const w = await fetchWorkers(status, sortBy, descending);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setWorkers(w);
      setError(null);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load workers');
    } finally {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, [descending, setWorkers, sortBy, status]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const timer = setInterval(load, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load, pollMs]);

  return { workers, loading, error, refresh: load };
}
