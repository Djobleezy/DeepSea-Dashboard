import { useState, useEffect, useCallback } from 'react';
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

  const load = useCallback(async () => {
    try {
      const w = await fetchWorkers(status, sortBy, descending);
      setWorkers(w);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, [descending, setWorkers, sortBy, status]);

  useEffect(() => {
    load();
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { workers, loading, error, refresh: load };
}
