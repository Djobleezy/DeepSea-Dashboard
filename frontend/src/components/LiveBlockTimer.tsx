/**
 * LiveBlockTimer — live-ticking elapsed time since last block
 *
 * Parses the server's "X mins ago" / "X hours ago" string to get initial
 * elapsed seconds, then ticks every second client-side.
 *
 * Color transitions:
 *   green  (<5 min)  — fresh block
 *   yellow (5-10 min) — normal range
 *   red    (>10 min) — getting long
 *
 * Coordinates with BitcoinProgressBar which has the same parseElapsedSecs util.
 * Uses localStorage to persist last-known block time so the timer survives
 * page reloads (matching v1 behavior) without freezing during SSE downtime.
 */

import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'liveBlockTimer_lastBlockEpoch';

/** Parses "X mins ago" / "X hours ago" / "X secs ago" → elapsed seconds */
export function parseElapsedSecs(str: string): number {
  if (!str || str === 'N/A') return 0;
  const m = str.match(/(\d+)\s*(sec|min|hour)/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('sec')) return n;
  if (unit.startsWith('min')) return n * 60;
  if (unit.startsWith('hour')) return n * 3600;
  return 0;
}

function colorForSecs(secs: number): string {
  if (secs < 300)  return 'var(--color-success)';  // <5 min — green
  if (secs < 600)  return 'var(--color-warning)';  // 5-10 min — yellow
  return 'var(--color-error)';                      // >10 min — red
}

function fmt(s: number): string {
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

interface Props {
  /** Raw string from server, e.g. "7 mins ago" */
  lastBlockTime: string;
}

export const LiveBlockTimer: React.FC<Props> = ({ lastBlockTime }) => {
  const [elapsedSecs, setElapsedSecs] = useState<number>(() => {
    // Try loading persisted epoch first — gives continuity across page reloads
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const epoch = parseInt(stored, 10);
        if (!isNaN(epoch) && epoch > 0) {
          const sinceThen = Math.floor((Date.now() - epoch) / 1000);
          if (sinceThen >= 0 && sinceThen < 86400) return sinceThen; // sanity: <24h
        }
      }
    } catch {
      // ignore storage errors
    }
    return parseElapsedSecs(lastBlockTime);
  });

  // When server sends a fresh string (new block found or reconnect), re-sync
  useEffect(() => {
    const parsed = parseElapsedSecs(lastBlockTime);
    if (parsed === 0 && lastBlockTime !== '0 secs ago') return; // skip N/A

    setElapsedSecs(parsed);

    // Store estimated epoch so page reloads keep the timer running
    const epoch = Date.now() - parsed * 1000;
    try {
      localStorage.setItem(STORAGE_KEY, String(epoch));
    } catch {
      // ignore
    }
  }, [lastBlockTime]);

  // Tick every second
  useEffect(() => {
    const t = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const color = colorForSecs(elapsedSecs);

  return (
    <span
      style={{
        fontFamily: 'var(--font-vt323)',
        fontSize: '22px',
        color,
        textShadow: `0 0 8px ${color}`,
        transition: 'color 0.5s ease, text-shadow 0.5s ease',
        letterSpacing: '1px',
      }}
      title={`Elapsed since last block: ${fmt(elapsedSecs)}`}
    >
      {fmt(elapsedSecs)}
    </span>
  );
};
