import React, { useEffect, useState } from 'react';
import { parseElapsedSecs } from '../utils/time';

interface Props {
  lastBlockTime: string; // e.g. "5 mins ago"
  targetMinutes?: number;
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
      <div className="flex justify-between mb-1" style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
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
