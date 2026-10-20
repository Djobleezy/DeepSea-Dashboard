/**
 * useServerTime — polls /api/health every 60 s to keep a client-server time offset.
 *
 * Usage:
 *   useServerTime();             // mount once (e.g. in App.tsx)
 *   getServerTime();             // returns accurate timestamp (ms) anywhere
 */

import { useEffect, useRef } from 'react';
import { fetchHealth } from '../api/client';
import { syncServerTime } from '../utils/serverClock';

export { getServerTime, getClockOffset, lastSyncAt } from '../utils/serverClock';

const POLL_INTERVAL_MS = 60_000;

export function useServerTime(): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sync = async () => {
    const clientBefore = Date.now();
    try {
      const health = await fetchHealth();
      syncServerTime(health.server_timestamp, clientBefore, Date.now());
    } catch {
      // Non-fatal: keep using previous offset
    }
  };

  useEffect(() => {
    sync(); // immediate sync on mount
    timerRef.current = setInterval(sync, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, []);
}
