import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart, LineController, LineElement, PointElement, LinearScale, Filler, Tooltip,
  type ChartConfiguration, type Plugin,
} from 'chart.js';
import Annotation, { type AnnotationOptions } from 'chartjs-plugin-annotation';
import type { AnnotationEntry } from '../hooks/useBlockAnnotations';
import { useAppStore } from '../stores/store';
import { chartSamples, chartSeries, chartUnit, chartValue, fullChartTime, reduceChartSamples, type HashrateChartPoint } from '../utils/hashrateChart';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip, Annotation);

const crosshair: Plugin<'line'> = {
  id: 'hashrateCrosshair',
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements()[0];
    if (!active || !chart.chartArea) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(active.element.x, chartArea.top);
    ctx.lineTo(active.element.x, chartArea.bottom);
    ctx.strokeStyle = '#94a3b866';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

interface Props {
  data60s: HashrateChartPoint[];
  data3hr: HashrateChartPoint[];
  avg24hr?: number;
  blockAnnotations?: AnnotationEntry[];
  lowHashrateMode?: boolean;
  hours?: number;
  now?: number;
}

export function HashrateChart({ data60s, data3hr, avg24hr, blockAnnotations = [], lowHashrateMode = false, hours = 24, now = Date.now() }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'line', { x: number; y: number | null }[]> | null>(null);
  const theme = useAppStore((s) => s.theme);
  const [showShort, setShowShort] = useState(true);
  const [showAverage, setShowAverage] = useState(true);
  const [showReference, setShowReference] = useState(true);
  const windowStart = now - hours * 3_600_000;
  const samples = useMemo(() => chartSamples(data60s, data3hr, windowStart, now), [data60s, data3hr, windowStart, now]);
  const rendered = useMemo(() => reduceChartSamples(samples), [samples]);
  const peak = samples.reduce((value, row) => Math.max(value, row.short ?? 0, row.average ?? 0),
    Number.isFinite(avg24hr) && avg24hr! >= 0 ? avg24hr! : 0);
  const { divisor, unit } = chartUnit(peak);
  // Fit the collected portion of the selected range as history builds up.
  const start = samples.length ? Math.max(windowStart, Math.min(samples[0].x, now - 300_000)) : windowStart;
  const hasGaps = samples.some((row) => row.gapBefore);
  const validReference = Number.isFinite(avg24hr) && avg24hr! >= 0;
  const latest = samples[samples.length - 1];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--primary').trim() || '#39bdf8';
    const text = style.getPropertyValue('--text').trim() || '#a0d4f5';
    const muted = style.getPropertyValue('--text-dim').trim() || '#93adbf';
    const background = style.getPropertyValue('--bg-card').trim() || '#0d1a24';
    const secondary = '#b8a4ff';
    const spansDates = new Date(start).toDateString() !== new Date(now).toDateString();
    const timeTicks = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
    const dateTicks = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 350);
    gradient.addColorStop(0, `${primary}30`);
    gradient.addColorStop(1, `${primary}00`);
    const annotations: Record<string, AnnotationOptions> = {};
    if (showReference && validReference) annotations.reference = {
      type: 'line', yMin: avg24hr! / divisor, yMax: avg24hr! / divisor,
      borderColor: `${muted}88`, borderWidth: 1, borderDash: [5, 5], adjustScaleRange: false,
    };
    blockAnnotations.filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= start && entry.timestamp <= now)
      .slice(-100).forEach((entry, index) => {
        annotations[`block${index}`] = {
          type: 'line', xMin: entry.timestamp, xMax: entry.timestamp,
          borderColor: '#f7931a88', borderWidth: 1, borderDash: [3, 5], adjustScaleRange: false,
        };
      });
    const datasets = [
      { label: '60 sec', data: chartSeries(rendered, 'short', divisor), hidden: !showShort, borderColor: primary,
        backgroundColor: gradient, borderWidth: lowHashrateMode ? 1.5 : 2,
        fill: !lowHashrateMode, pointRadius: samples.length === 1 ? 3 : 0, pointHoverRadius: 4 },
      { label: '3 hr average', data: chartSeries(rendered, 'average', divisor), hidden: !showAverage, borderColor: secondary,
        backgroundColor: lowHashrateMode ? `${secondary}12` : 'transparent', borderWidth: 2,
        fill: lowHashrateMode, pointRadius: samples.length === 1 ? 3 : 0, pointHoverRadius: 4 },
    ];
    const options: ChartConfiguration<'line', { x: number; y: number | null }[]>['options'] = {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      elements: { line: { tension: 0, spanGaps: false }, point: { hitRadius: 12 } },
      layout: { padding: { top: 10, right: 8 } },
      plugins: {
        tooltip: {
          backgroundColor: background, borderColor: primary, borderWidth: 1, padding: 12,
          titleColor: text, bodyColor: text, displayColors: true,
          titleFont: { family: 'Share Tech Mono', size: 11 }, bodyFont: { family: 'Share Tech Mono', size: 12 },
          callbacks: {
            title: (items) => items.length ? fullChartTime(items[0].parsed.x ?? 0) : '',
            label: (item) => ` ${item.dataset.label}: ${chartValue(item.parsed.y ?? 0)} ${unit}`,
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear', min: start, max: now,
          border: { display: false }, grid: { display: false },
          ticks: {
            maxTicksLimit: canvas.clientWidth < 500 ? 4 : 7, maxRotation: 0, color: muted,
            font: { family: 'Share Tech Mono', size: 11 },
            callback: (value) => spansDates ? [dateTicks.format(Number(value)), timeTicks.format(Number(value))] : timeTicks.format(Number(value)),
          },
        },
        y: {
          type: 'linear', beginAtZero: true, min: 0, max: peak > 0 ? peak / divisor * 1.12 : 1,
          border: { display: false }, grid: { color: `${muted}16`, drawTicks: false },
          ticks: { maxTicksLimit: 5, includeBounds: false, padding: 10, color: muted, font: { family: 'Share Tech Mono', size: 11 }, callback: (value) => chartValue(Number(value)) },
          title: { display: true, text: unit, color: muted, font: { family: 'Share Tech Mono', size: 11 } },
        },
      },
    };
    if (chartRef.current) {
      chartRef.current.data.datasets = datasets;
      chartRef.current.options = options;
      chartRef.current.update('none');
    } else {
      chartRef.current = new Chart(ctx, { type: 'line', data: { datasets }, options, plugins: [crosshair] });
    }
  }, [rendered, samples.length, theme, divisor, unit, peak, lowHashrateMode, showShort, showAverage, showReference, validReference, avg24hr, blockAnnotations, start, now]);

  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);

  return <>
    <div className="hashrate-legend" role="group" aria-label="Visible hashrate series">
      <button type="button" className="hashrate-series" aria-pressed={showShort} onClick={() => setShowShort((value) => !value)}>
        <span className="hashrate-swatch hashrate-swatch-short" />60 sec{lowHashrateMode ? ' · variable' : ''}
      </button>
      <button type="button" className="hashrate-series" aria-pressed={showAverage} onClick={() => setShowAverage((value) => !value)}>
        <span className="hashrate-swatch hashrate-swatch-average" />3 hr average{lowHashrateMode ? ' · primary' : ''}
      </button>
      {validReference && <button type="button" className="hashrate-series" aria-pressed={showReference} onClick={() => setShowReference((value) => !value)}>
        <span className="hashrate-swatch hashrate-swatch-reference" />24 hr reference · {chartValue(avg24hr! / divisor)} {unit}
      </button>}
      {blockAnnotations.some((entry) => entry.timestamp >= start && entry.timestamp <= now) && <span className="hashrate-series" title="Recent Ocean pool blocks"><span className="hashrate-swatch hashrate-swatch-block" />Pool blocks</span>}
    </div>
    <div className="chart-container">
      <canvas ref={canvasRef} role="img" aria-label={`Hashrate history over up to ${hours} hours. ${samples.length} readings. ${hasGaps ? 'Gaps indicate missing data.' : ''}`}>
        {latest ? `Latest reading: ${chartValue((latest.short ?? 0) / divisor)} ${unit}; 3 hour average: ${chartValue((latest.average ?? 0) / divisor)} ${unit}.` : 'Waiting for hashrate history.'}
      </canvas>
    </div>
    <div className="hashrate-chart-caption">
      <span>{samples.length.toLocaleString()} readings{rendered.length < samples.length ? ' · peaks preserved in overview' : ''}</span>
      <span>{hasGaps ? 'Breaks in the line show missing readings' : 'Zero readings are included'}</span>
    </div>
  </>;
}
