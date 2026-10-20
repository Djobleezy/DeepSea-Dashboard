import { useCallback, useEffect, useState } from 'react';
import { fetchMetricHistory } from '../api/client';
import { useAppStore } from '../stores/store';

const BACKFILL_INTERVAL_MS = 5 * 60 * 1000;

/** Reconcile persisted samples with live samples after navigation or reconnect. */
export function useHashrateHistory() {
  const wallet = useAppStore((s) => s.wallet);
  const walletEpoch = useAppStore((s) => s.walletEpoch);
  const hours = useAppStore((s) => s.chartHours);
  const setHours = useAppStore((s) => s.setChartHours);
  const hydrateChart = useAppStore((s) => s.hydrateChart);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((value) => value + 1), []);

  useEffect(() => {
    if (!wallet) {
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    let pending = false;
    let queued = false;
    const current = () => active && useAppStore.getState().walletEpoch === walletEpoch;
    const load = async () => {
      if (!current()) return;
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      setLoading(true);
      try {
        const points = await fetchMetricHistory(hours);
        if (!Array.isArray(points)) throw new Error('The server returned invalid chart history.');
        if (current()) {
          hydrateChart(points, walletEpoch, hours);
          setError(null);
        }
      } catch (cause) {
        if (current()) setError(cause instanceof Error ? cause.message : 'Could not load chart history.');
      } finally {
        pending = false;
        if (current()) setLoading(false);
        if (current() && queued) {
          queued = false;
          void load();
        }
      }
    };
    const refresh = () => { void load(); };
    const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
    // SSE replays its latest snapshot, not every sample missed while disconnected.
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.sseConnected && !previous.sseConnected) refresh();
    });
    void load();
    const timer = window.setInterval(refresh, BACKFILL_INTERVAL_MS);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [wallet, walletEpoch, hours, hydrateChart, retryCount]);

  return { hours, setHours, loading, error, retry };
}
