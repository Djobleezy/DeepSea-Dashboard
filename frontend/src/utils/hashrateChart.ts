/** Chart geometry uses source timestamps, never formatted clock labels. */
export interface HashrateChartPoint { ts: number; value: number; gapBefore?: boolean }
export interface HashrateSample { x: number; short: number | null; average: number | null; gapBefore: boolean }
export const HISTORY_GAP_MS = 150_000;
export const MAX_RENDER_SAMPLES = 1_200;

export function chartSamples(short: HashrateChartPoint[], average: HashrateChartPoint[], start: number, end: number): HashrateSample[] {
  const rows = new Map<number, HashrateSample & { explicitGap?: boolean }>();
  const collect = (points: HashrateChartPoint[], field: 'short' | 'average') => {
    for (const point of points) {
      if (!Number.isFinite(point.ts) || point.ts <= 0 || point.ts < start || point.ts > end || !Number.isFinite(point.value) || point.value < 0) continue;
      const row = rows.get(point.ts) ?? { x: point.ts, short: null, average: null, gapBefore: false };
      row[field] = point.value;
      if (typeof point.gapBefore === 'boolean') row.explicitGap = point.gapBefore;
      rows.set(point.ts, row);
    }
  };
  collect(short, 'short');
  collect(average, 'average');
  const sorted = [...rows.values()].sort((a, b) => a.x - b.x);
  return sorted.map((row, index) => ({ x: row.x, short: row.short, average: row.average,
    gapBefore: index > 0 && (row.explicitGap ?? row.x - sorted[index - 1].x > HISTORY_GAP_MS) }));
}

/** Preserve both series' extrema, endpoints, and missing-data breaks at a bounded rendering cost. */
export function reduceChartSamples(rows: HashrateSample[], limit = MAX_RENDER_SAMPLES): HashrateSample[] {
  if (rows.length <= limit) return rows;
  const selected = new Set<number>([0, rows.length - 1]);
  const buckets = Math.max(1, Math.floor((limit - 2) / 4));
  for (let bucket = 0; bucket < buckets; bucket++) {
    const first = 1 + Math.floor(bucket * (rows.length - 2) / buckets);
    const last = 1 + Math.floor((bucket + 1) * (rows.length - 2) / buckets);
    for (const field of ['short', 'average'] as const) {
      let min = -1, max = -1;
      for (let i = first; i < last; i++) {
        const value = rows[i][field];
        if (value === null) continue;
        if (min < 0 || value < rows[min][field]!) min = i;
        if (max < 0 || value > rows[max][field]!) max = i;
      }
      if (min >= 0) selected.add(min);
      if (max >= 0) selected.add(max);
    }
  }
  let previous = -1;
  return [...selected].sort((a, b) => a - b).map((index) => {
    const gapBefore = rows.slice(previous + 1, index + 1).some((row) => row.gapBefore);
    previous = index;
    return { ...rows[index], gapBefore };
  });
}

export function chartSeries(rows: HashrateSample[], field: 'short' | 'average', divisor: number) {
  const points: { x: number; y: number | null }[] = [];
  rows.forEach((row, index) => {
    if (row.gapBefore && index > 0) points.push({ x: rows[index - 1].x + (row.x - rows[index - 1].x) / 2, y: null });
    points.push({ x: row.x, y: row[field] === null ? null : row[field]! / divisor });
  });
  return points;
}

export function chartUnit(peak: number) {
  if (peak >= 1_000_000) return { divisor: 1_000_000, unit: 'EH/s' };
  if (peak >= 1_000) return { divisor: 1_000, unit: 'PH/s' };
  if (peak >= 1 || peak === 0) return { divisor: 1, unit: 'TH/s' };
  if (peak >= 0.001) return { divisor: 0.001, unit: 'GH/s' };
  return { divisor: 0.000001, unit: 'MH/s' };
}

export function chartValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 }).format(value);
}

export function fullChartTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(timestamp);
}
