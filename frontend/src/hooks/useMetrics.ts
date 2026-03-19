import { useEffect, useRef, useState } from 'react';
import { fetchMetrics } from '../api/client';
import { useAppStore } from '../stores/store';

export function useMetrics(pollMs = 60000) {
  const setMetrics = useAppStore((s) => s.setMetrics);
  const metrics = useAppStore((s) => s.metrics);
  const [loading, setLoading] = useState(!metrics);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    try {
      const m = await fetchMetrics();
      setMetrics(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return { metrics, loading, error, refresh: load };
}
