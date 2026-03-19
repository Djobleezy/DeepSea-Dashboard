import React, { useEffect, useState } from 'react';

interface Props {
  lastBlockTime: string; // e.g. "5 mins ago"
  targetMinutes?: number;
}

/** Parses "X mins ago" / "X hours ago" → elapsed seconds */
function parseElapsedSecs(str: string): number {
  if (!str || str === 'N/A') return 0;
  const m = str.match(/(\d+)\s*(sec|min|hour)/i);
  if (!m) return 0;
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('sec')) return n;
  if (unit.startsWith('min')) return n * 60;
  if (unit.startsWith('hour')) return n * 3600;
  return 0;
}

export const BitcoinProgressBar: React.FC<Props> = ({
  lastBlockTime,
  targetMinutes = 10,
}) => {
  const [elapsedSecs, setElapsedSecs] = useState(() =>
    parseElapsedSecs(lastBlockTime),
  );
  const targetSecs = targetMinutes * 60;

  // Tick every second
  useEffect(() => {
    setElapsedSecs(parseElapsedSecs(lastBlockTime));
    const t = setInterval(
      () => setElapsedSecs((s) => s + 1),
      1000,
    );
    return () => clearInterval(t);
  }, [lastBlockTime]);

  const pct = Math.min((elapsedSecs / targetSecs) * 100, 100);
  const color =
    pct < 50 ? 'var(--color-success)' : pct < 90 ? 'var(--color-warning)' : 'var(--color-error)';

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div>
      <div className="flex justify-between mb-1" style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
        <span>BLOCK AGE</span>
        <span style={{ color }}>
          {fmt(elapsedSecs)} / {fmt(targetSecs)} target
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
};
