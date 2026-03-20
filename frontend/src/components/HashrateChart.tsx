import React, { useEffect, useRef, useCallback } from 'react';
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
  lowHashrateMode?: boolean;
}

/** Auto-scale TH/s values to the best display unit */
function autoScale(ths: number): { divisor: number; unit: string } {
  if (ths >= 1_000_000) return { divisor: 1_000_000, unit: 'EH/s' };
  if (ths >= 1_000) return { divisor: 1_000, unit: 'PH/s' };
  if (ths >= 1) return { divisor: 1, unit: 'TH/s' };
  if (ths >= 0.001) return { divisor: 0.001, unit: 'GH/s' };
  return { divisor: 1, unit: 'TH/s' };
}

const BLOCK_COLOR = '#f7931a'; // Bitcoin orange

export const HashrateChart: React.FC<Props> = ({ data60s, data3hr, avg24hr, blockAnnotations = [], lowHashrateMode = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const theme = useAppStore((s) => s.theme);
  // Track what triggered a rebuild vs an in-place update
  const prevThemeRef = useRef(theme);
  const prevLowHashrateRef = useRef(lowHashrateMode);

  const buildAnnotations = useCallback((
    labels: string[],
    scaledAvg: number | undefined,
    displayUnit: string,
    primary: string,
    primaryDim: string,
    bgCard: string,
    entries: AnnotationEntry[],
  ): Record<string, AnnotationOptions> => {
    const labelSet = new Set(labels);
    const defs: Record<string, AnnotationOptions> = {};

    entries.forEach((entry, idx) => {
      // Find matching label: exact match first, then nearest by timestamp
      let matchLabel = entry.label;
      if (!labelSet.has(matchLabel) && labels.length > 0) {
        // Parse label times to find nearest
        const entryDate = new Date(entry.timestamp);
        let bestDist = Infinity;
        let bestLabel = labels[0];
        for (const l of labels) {
          // Parse "h:mm:ss AM" style label back to today's date
          const parts = l.match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i);
          if (!parts) continue;
          let h = parseInt(parts[1], 10);
          const m = parseInt(parts[2], 10);
          const s = parseInt(parts[3], 10);
          if (parts[4].toUpperCase() === 'PM' && h !== 12) h += 12;
          if (parts[4].toUpperCase() === 'AM' && h === 12) h = 0;
          const labelDate = new Date(entryDate);
          labelDate.setHours(h, m, s, 0);
          const dist = Math.abs(labelDate.getTime() - entryDate.getTime());
          if (dist < bestDist) {
            bestDist = dist;
            bestLabel = l;
          }
        }
        // Only use nearest if within 2 minutes
        if (bestDist > 120_000) return;
        matchLabel = bestLabel;
      }
      defs[`blockEvent${idx}`] = {
        type: 'line',
        xMin: matchLabel,
        xMax: matchLabel,
        borderColor: BLOCK_COLOR,
        borderWidth: 2,
        borderDash: [4, 2],

        label: {
          display: true,
          content: '⛏️ BLOCK',
          backgroundColor: 'rgba(0,0,0,0.85)',
          color: BLOCK_COLOR,
          font: { family: "'VT323', monospace", size: 14, weight: 'bold' },
          padding: { top: 4, bottom: 4, left: 6, right: 6 },
          borderRadius: 0,
          position: 'start',
        },
      };
    });

    if (scaledAvg !== undefined && scaledAvg > 0) {
      defs['avg24hr'] = {
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
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          padding: { top: 2, bottom: 2, left: 6, right: 6 },
          borderRadius: 0,
          position: 'end',
        },
      };
    }

    return defs;
  }, []);

  // Full chart build — only on mount, theme change, or low-hashrate mode toggle
  const buildChart = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--primary').trim() || '#0088cc';
    const primaryDim = style.getPropertyValue('--primary-dim').trim() || '#005580';
    const textDim = style.getPropertyValue('--text-dim').trim() || '#4a8fa8';
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#0d1a24';
    const text = style.getPropertyValue('--text').trim() || '#a0d4f5';

    const labels = data60s.map((d) => d.label);
    const rawValues60s = data60s.map((d) => d.value);
    const rawValues3hr = data3hr.map((d) => d.value);

    const peakThs = Math.max(...rawValues60s, ...rawValues3hr, avg24hr ?? 0, 0.001);
    const { divisor, unit: displayUnit } = autoScale(peakThs);
    const values60s = rawValues60s.map((v) => v / divisor);
    const values3hr = rawValues3hr.map((v) => v / divisor);
    const scaledAvg = avg24hr !== undefined ? avg24hr / divisor : undefined;

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${primary}44`);
    gradient.addColorStop(1, `${primary}00`);

    const annotationDefs = buildAnnotations(labels, scaledAvg, displayUnit, primary, primaryDim, bgCard, blockAnnotations);

    const primaryData = lowHashrateMode ? values3hr : values60s;
    const secondaryData = lowHashrateMode ? values60s : values3hr;
    const primaryLabel = lowHashrateMode ? '3hr Hashrate' : '60s Hashrate';
    const secondaryLabel = lowHashrateMode ? '60s Hashrate' : '3hr Hashrate';

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: primaryLabel,
            data: primaryData,
            borderColor: primary,
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: secondaryLabel,
            data: secondaryData,
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
        animation: false,  // no animation on initial build (prevents diagonal annotations)
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
          annotation: { annotations: annotationDefs },
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
    // Re-enable animation after first render so data updates are smooth
    requestAnimationFrame(() => {
      if (chartRef.current) {
        chartRef.current.options.animation = { duration: 300 };
      }
    });
  }, [data60s, data3hr, avg24hr, blockAnnotations, lowHashrateMode, buildAnnotations]);

  useEffect(() => {
    const themeChanged = prevThemeRef.current !== theme;
    const modeChanged = prevLowHashrateRef.current !== lowHashrateMode;
    prevThemeRef.current = theme;
    prevLowHashrateRef.current = lowHashrateMode;

    // Full rebuild needed on first render, theme change, or mode change
    if (!chartRef.current || themeChanged || modeChanged) {
      buildChart();
      // No cleanup here — the separate unmount effect handles teardown.
      // Returning a cleanup would destroy the chart when the next data tick
      // re-runs this effect, causing a one-frame disappearance.
      return;
    }

    // --- In-place update: just swap data + annotations, no destroy ---
    const chart = chartRef.current;
    // Guard: canvas may have been unmounted between renders
    if (!chart.canvas?.ownerDocument) {
      chartRef.current = null;
      return;
    }
    const labels = data60s.map((d) => d.label);
    const rawValues60s = data60s.map((d) => d.value);
    const rawValues3hr = data3hr.map((d) => d.value);

    const peakThs = Math.max(...rawValues60s, ...rawValues3hr, avg24hr ?? 0, 0.001);
    const { divisor, unit: displayUnit } = autoScale(peakThs);
    const values60s = rawValues60s.map((v) => v / divisor);
    const values3hr = rawValues3hr.map((v) => v / divisor);
    const scaledAvg = avg24hr !== undefined ? avg24hr / divisor : undefined;

    const primaryData = lowHashrateMode ? values3hr : values60s;
    const secondaryData = lowHashrateMode ? values60s : values3hr;

    // Update labels + datasets in place
    chart.data.labels = labels;
    chart.data.datasets[0].data = primaryData;
    chart.data.datasets[1].data = secondaryData;

    // Update annotations (24hr avg + block events)
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--primary').trim() || '#0088cc';
    const primaryDim = style.getPropertyValue('--primary-dim').trim() || '#005580';
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#0d1a24';
    const annotationDefs = buildAnnotations(labels, scaledAvg, displayUnit, primary, primaryDim, bgCard, blockAnnotations);

    if (chart.options.plugins?.annotation) {
      (chart.options.plugins.annotation as { annotations: Record<string, AnnotationOptions> }).annotations = annotationDefs;
    }

    // Update Y-axis tick callback for potentially changed unit
    const yAxis = chart.options.scales?.y;
    if (yAxis && 'ticks' in yAxis && yAxis.ticks) {
      yAxis.ticks.callback = (v: string | number) => `${Number(v).toFixed(2)} ${displayUnit}`;
    }

    // Update tooltip callback
    const tooltipPlugin = chart.options.plugins?.tooltip;
    if (tooltipPlugin && 'callbacks' in tooltipPlugin && tooltipPlugin.callbacks) {
      tooltipPlugin.callbacks.label = (c) => ` ${(c.parsed.y ?? 0).toFixed(2)} ${displayUnit}`;
    }

    // Smooth transition — 'none' means no animation on data swap (instant, no flicker)
    chart.update('none');

    // No cleanup here — in-place updates don't need teardown.
    // Chart is only destroyed on full rebuild (theme/mode change) or unmount.
  }, [data60s, data3hr, avg24hr, blockAnnotations, theme, lowHashrateMode, buildChart, buildAnnotations]);

  // Unmount cleanup — separate effect with empty deps
  useEffect(() => {
    return () => { chartRef.current?.destroy(); };
  }, []);

  return (
    <div className="chart-container">
      <canvas ref={canvasRef} />
    </div>
  );
};
