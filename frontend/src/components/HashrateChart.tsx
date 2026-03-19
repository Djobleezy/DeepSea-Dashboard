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
import Annotation from 'chartjs-plugin-annotation';
import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import type { AnnotationEntry } from '../hooks/useBlockAnnotations';
import { useAppStore } from '../stores/store';

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
  Annotation,
);

interface DataPoint {
  label: string;
  value: number;
}

interface Props {
  data60s: DataPoint[];
  data3hr: DataPoint[];
  avg24hr?: number;
  blockAnnotations?: AnnotationEntry[];
}

/** Auto-scale TH/s values to the best display unit */
function autoScale(ths: number): { divisor: number; unit: string } {
  if (ths >= 1_000_000) return { divisor: 1_000_000, unit: 'EH/s' };
  if (ths >= 1_000) return { divisor: 1_000, unit: 'PH/s' };
  if (ths >= 1) return { divisor: 1, unit: 'TH/s' };
  if (ths >= 0.001) return { divisor: 0.001, unit: 'GH/s' };
  return { divisor: 1, unit: 'TH/s' };
}

export const HashrateChart: React.FC<Props> = ({ data60s, data3hr, avg24hr, blockAnnotations = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Read live CSS vars — these update when theme changes
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--primary').trim() || '#0088cc';
    const primaryDim = style.getPropertyValue('--primary-dim').trim() || '#005580';
    const textDim = style.getPropertyValue('--text-dim').trim() || '#4a8fa8';
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#0d1a24';
    const text = style.getPropertyValue('--text').trim() || '#a0d4f5';

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = data60s.map((d) => d.label);
    const rawValues60s = data60s.map((d) => d.value);
    const rawValues3hr = data3hr.map((d) => d.value);
    const labelSet = new Set(labels);

    // Determine display unit from peak value (all values are in TH/s internally)
    const peakThs = Math.max(...rawValues60s, ...rawValues3hr, avg24hr ?? 0, 0.001);
    const { divisor, unit: displayUnit } = autoScale(peakThs);
    const values60s = rawValues60s.map((v) => v / divisor);
    const values3hr = rawValues3hr.map((v) => v / divisor);
    const scaledAvg = avg24hr !== undefined ? avg24hr / divisor : undefined;

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${primary}44`);
    gradient.addColorStop(1, `${primary}00`);

    // --- Block annotation vertical lines ---
    const BLOCK_COLOR = '#f7931a'; // Bitcoin orange — always stands out
    const annotationDefs: Record<string, AnnotationOptions> = {};

    blockAnnotations.forEach((entry, idx) => {
      if (!labelSet.has(entry.label)) return;
      annotationDefs[`blockEvent${idx}`] = {
        type: 'line',
        xMin: entry.label,
        xMax: entry.label,
        borderColor: BLOCK_COLOR,
        borderWidth: 2,
        borderDash: [4, 2],
        label: {
          display: true,
          content: '⛏️ BLOCK',
          backgroundColor: 'rgba(0,0,0,0.85)',
          color: BLOCK_COLOR,
          font: {
            family: "'VT323', monospace",
            size: 14,
            weight: 'bold',
          },
          padding: { top: 4, bottom: 4, left: 6, right: 6 },
          borderRadius: 0,
          position: 'start',
        },
      };
    });

    // --- 24hr average annotation ---
    if (scaledAvg !== undefined && scaledAvg > 0) {
      annotationDefs['avg24hr'] = {
        type: 'line',
        yMin: scaledAvg,
        yMax: scaledAvg,
        borderColor: `${primaryDim}aa`,
        borderWidth: 1,
        borderDash: [6, 3],
        label: {
          display: true,
          content: `24H AVG: ${scaledAvg.toFixed(2)} ${displayUnit}`,
          backgroundColor: `${bgCard}dd`,
          color: `${primary}cc`,
          font: {
            family: "'Share Tech Mono', monospace",
            size: 10,
          },
          padding: { top: 2, bottom: 2, left: 6, right: 6 },
          borderRadius: 0,
          position: 'end',
        },
      };
    }

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
            borderColor: `${primaryDim}cc`,
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
              color: textDim,
              font: { family: 'Share Tech Mono', size: 11 },
            },
          },
          tooltip: {
            backgroundColor: bgCard,
            borderColor: primary,
            borderWidth: 1,
            titleColor: primary,
            bodyColor: text,
            bodyFont: { family: 'Share Tech Mono' },
            callbacks: {
              label: (c) => ` ${(c.parsed.y ?? 0).toFixed(2)} ${displayUnit}`,
            },
          },
          annotation: {
            annotations: annotationDefs,
          },
        },
        scales: {
          x: {
            ticks: {
              color: textDim,
              font: { family: 'Share Tech Mono', size: 10 },
              maxTicksLimit: 8,
            },
            grid: { color: `${primary}11` },
          },
          y: {
            ticks: {
              color: textDim,
              font: { family: 'Share Tech Mono', size: 10 },
              callback: (v) => `${Number(v).toFixed(2)} ${displayUnit}`,
            },
            grid: { color: `${primary}11` },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
    // theme in deps → chart rebuilds with new CSS vars on theme change
  }, [data60s, data3hr, avg24hr, blockAnnotations, theme]);

  return (
    <div className="chart-container">
      <canvas ref={canvasRef} />
    </div>
  );
};
