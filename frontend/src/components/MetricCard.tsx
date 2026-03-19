import React from 'react';
import { ArrowIndicator } from './ArrowIndicator';

interface Props {
  label: string;
  value: string | number;
  unit?: string;
  previous?: number;
  current?: number;
  subtext?: string;
  className?: string;
  large?: boolean;
  children?: React.ReactNode;
}

export const MetricCard: React.FC<Props> = ({
  label,
  value,
  unit,
  previous,
  current,
  subtext,
  className = '',
  large = false,
  children,
}) => {
  const numVal = typeof current === 'number' ? current : typeof value === 'number' ? value : undefined;

  return (
    <div className={`card ${className}`} style={{ minHeight: large ? '120px' : '90px' }}>
      <div className="label">{label}</div>
      <div
        className={large ? 'value' : 'value-sm'}
        style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '6px' }}
      >
        <span className="glow">{value}</span>
        {unit && <span className="unit">{unit}</span>}
        {numVal !== undefined && (
          <ArrowIndicator current={numVal} previous={previous} />
        )}
      </div>
      {subtext && (
        <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px' }}>
          {subtext}
        </div>
      )}
      {children}
    </div>
  );
};
