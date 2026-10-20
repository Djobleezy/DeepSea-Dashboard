import React from 'react';
import { useElapsedTime } from '../hooks/useElapsedTime';
import { formatElapsedSecs } from '../utils/time';

interface Props {
  lastBlockTime: string;
  targetMinutes?: number | null;
}

/** Live block age; server durations remain authoritative across page reloads. */
export const LiveBlockTimer: React.FC<Props> = ({ lastBlockTime, targetMinutes = 10 }) => {
  const elapsedSecs = useElapsedTime(lastBlockTime);
  const requestedTargetSecs = typeof targetMinutes === 'number' ? targetMinutes * 60 : NaN;
  const targetSecs = Number.isFinite(requestedTargetSecs) && requestedTargetSecs > 0
    ? Math.max(1, Math.round(requestedTargetSecs)) : null;
  const color = elapsedSecs === null || targetSecs === null
    ? 'var(--text-dim)' : elapsedSecs >= targetSecs ? 'var(--color-warning)' : 'var(--primary)';
  const label = elapsedSecs === null ? 'Block time unavailable' : formatElapsedSecs(elapsedSecs);

  return (
    <span
      style={{
        fontFamily: 'var(--font-vt323)', fontSize: '22px', color,
        textShadow: '0 0 8px currentColor', letterSpacing: '1px',
      }}
      title={elapsedSecs === null ? label : `Elapsed since last block: ${label}`}
    >
      {label}
    </span>
  );
};
