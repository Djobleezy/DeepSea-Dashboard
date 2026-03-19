import React from 'react';

interface Props {
  current: number;
  previous?: number;
  threshold?: number;
}

export const ArrowIndicator: React.FC<Props> = ({
  current,
  previous,
  threshold = 0.01,
}) => {
  if (previous === undefined || previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < threshold) return null;

  const up = diff > 0;
  const color = up ? 'var(--color-success)' : 'var(--color-error)';
  return (
    <span
      style={{
        color,
        fontSize: '18px',
        marginLeft: '4px',
        verticalAlign: 'middle',
        textShadow: `0 0 6px ${color}`,
      }}
      title={`${up ? '+' : ''}${diff.toFixed(2)}`}
    >
      {up ? '↑' : '↓'}
    </span>
  );
};
