import React, { useEffect, useRef } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
);

interface DataPoint {
  label: string;
  value: number;
}

interface Props {
  data60s: DataPoint[];
  data3hr: DataPoint[];
  avg24hr?: number;
}

export const HashrateChart: React.FC<Props> = ({ data60s, data3hr, avg24hr }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim() || '#0088cc';

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = data60s.map((d) => d.label);
    const values60s = data60s.map((d) => d.value);
    const values3hr = data3hr.map((d) => d.value);

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${primary}44`);
    gradient.addColorStop(1, `${primary}00`);

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '60s Hashrate',
            data: values60s,
            borderColor: primary,
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: '3hr Hashrate',
            data: values3hr,
            borderColor: `${primary}88`,
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue('--text-dim')
                .trim(),
              font: { family: 'Share Tech Mono', size: 11 },
            },
          },
          tooltip: {
            backgroundColor: '#0d1a24',
            borderColor: primary,
            borderWidth: 1,
            titleColor: primary,
            bodyColor: '#a0d4f5',
            bodyFont: { family: 'Share Tech Mono' },
            callbacks: {
              label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)} TH/s`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue('--text-dim')
                .trim(),
              font: { family: 'Share Tech Mono', size: 10 },
              maxTicksLimit: 8,
            },
            grid: { color: `${primary}11` },
          },
          y: {
            ticks: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue('--text-dim')
                .trim(),
              font: { family: 'Share Tech Mono', size: 10 },
              callback: (v) => `${Number(v).toFixed(1)} TH`,
            },
            grid: { color: `${primary}11` },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [data60s, data3hr, avg24hr]);

  return (
    <div style={{ position: 'relative', height: '220px' }}>
      <canvas ref={canvasRef} />
    </div>
  );
};
