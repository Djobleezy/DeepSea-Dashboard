/**
 * useServerTime — polls /api/health every 60 s to keep a client-server time offset.
 *
 * Usage:
 *   useServerTime();             // mount once (e.g. in App.tsx)
 *   getServerTime();             // returns accurate timestamp (ms) anywhere
 */

import { useEffect, useRef } from 'react';
import { fetchHealth } from '../api/client';

const POLL_INTERVAL_MS = 60_000;

/** Client-server offset in milliseconds (server_ms - client_ms at time of sync). */
let _offsetMs = 0;
let _lastSyncAt = 0;

/**
 * Returns the best available current timestamp in milliseconds.
 * Uses the server-calibrated offset when a sync has occurred.
 */
export function getServerTime(): number {
  return Date.now() + _offsetMs;
}

/**
 * Returns the current offset between server and client clocks (ms).
 * Positive = server is ahead of client.
 */
export function getClockOffset(): number {
  return _offsetMs;
}

export function useServerTime(): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sync = async () => {
    const clientBefore = Date.now();
    try {
      const health = await fetchHealth();
      if (health.server_timestamp != null) {
        const clientAfter = Date.now();
        const rtt = clientAfter - clientBefore;
        // Estimate server time at the midpoint of the round trip
        const serverMs = health.server_timestamp * 1000;
        const clientMid = clientBefore + rtt / 2;
        _offsetMs = serverMs - clientMid;
        _lastSyncAt = Date.now();

        if (localStorage.getItem('debugMode') === 'true') {
          console.debug(
            '[DeepSea] Server time sync — offset:',
            _offsetMs.toFixed(1),
            'ms  rtt:',
            rtt,
            'ms',
          );
        }
      }
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

export { _lastSyncAt as lastSyncAt };
