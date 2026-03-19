import { useState, useEffect } from 'react';
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

  async function load() {
    try {
      const w = await fetchWorkers(status, sortBy, descending);
      setWorkers(w);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sortBy, descending, pollMs]);

  return { workers, loading, error, refresh: load };
}
