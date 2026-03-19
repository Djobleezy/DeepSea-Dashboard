import React from 'react';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export const Sparkline: React.FC<Props> = ({
  data,
  width = 120,
  height = 30,
  color = 'var(--primary)',
}) => {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const polyline = pts.join(' ');
  // Filled area
  const area = `${pts[0].split(',')[0]},${height} ${polyline} ${pts[pts.length - 1].split(',')[0]},${height}`;

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
};
