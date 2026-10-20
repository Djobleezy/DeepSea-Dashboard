import React from 'react';
import { useElapsedTime } from '../hooks/useElapsedTime';
import { formatElapsedSecs } from '../utils/time';

interface Props {
  lastBlockTime: string;
  targetMinutes?: number | null;
  targetLabel?: string;
}

export const BitcoinProgressBar: React.FC<Props> = ({
  lastBlockTime,
  targetMinutes = 10,
  targetLabel = 'target',
}) => {
  const elapsedSecs = useElapsedTime(lastBlockTime);
  const requestedTargetSecs = typeof targetMinutes === 'number' ? targetMinutes * 60 : NaN;
  const targetSecs = Number.isFinite(requestedTargetSecs) && requestedTargetSecs > 0
    ? Math.max(1, Math.round(requestedTargetSecs)) : null;
  const pct = elapsedSecs !== null && targetSecs !== null
    ? Math.min((elapsedSecs / targetSecs) * 100, 100) : 0;
  // Block intervals are estimates: an overdue block is not a mining failure.
  const color = elapsedSecs === null || targetSecs === null
    ? 'var(--text-dim)' : elapsedSecs >= targetSecs ? 'var(--color-warning)' : 'var(--primary)';

  return (
    <div>
      <div className="flex justify-between mb-1" style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
        <span>BLOCK AGE</span>
        <span style={{ color }}>
          {elapsedSecs === null ? 'Block time unavailable' : formatElapsedSecs(elapsedSecs)}
          {targetSecs !== null && ` / ${formatElapsedSecs(targetSecs)} ${targetLabel}`}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
};
