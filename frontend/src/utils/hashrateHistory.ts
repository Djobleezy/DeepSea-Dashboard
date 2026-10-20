/** Mining samples use absolute source times; labels are presentation only. */
export interface ChartPoint {
  label: string;
  value: number;
  ts: number;
  /** Server-derived continuity, before any rendering/downsampling. */
  gapBefore?: boolean;
}

export interface MetricHistoryPoint {
  timestamp: number;
  hashrate_60sec: number;
  hashrate_3hr: number;
  gap_before?: boolean;
}

export const HISTORY_HOURS = [1, 6, 24, 168] as const;
export type HistoryHours = typeof HISTORY_HOURS[number];
export const MAX_CHART_POINTS = 7 * 24 * 60;
export const MAX_CHART_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const FUTURE_SAMPLE_TOLERANCE_MS = 5_000;
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

export function validHashrate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function sourceTimeMs(timestamp: unknown, now?: number): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const ms = Math.round(timestamp * 1000);
  // Date's supported range also keeps malformed values out of axis/label APIs.
  return Number.isSafeInteger(ms) && ms <= 8.64e15 &&
    (now === undefined || ms <= now + FUTURE_SAMPLE_TOLERANCE_MS) ? ms : null;
}

export function chartPoint(value: number, ts: number, label = timeFormatter.format(ts)): ChartPoint {
  return { ts, label, value };
}

const sampleKey = (point: ChartPoint) => Math.floor(point.ts / 1000);

function prune(points: ChartPoint[]): ChartPoint[] {
  if (!points.length) return points;
  const cutoff = points[points.length - 1].ts - MAX_CHART_AGE_MS;
  let start = Math.max(0, points.length - MAX_CHART_POINTS);
  while (start < points.length && points[start].ts < cutoff) start++;
  return start ? points.slice(start) : points;
}

/** O(n) copy for the usual append; no sorting or allocation for repeated events. */
export function appendChartPoint(points: ChartPoint[], point: ChartPoint): ChartPoint[] {
  const key = sampleKey(point);
  const last = points[points.length - 1];
  if (!last || key > sampleKey(last)) return prune([...points, point]);
  if (last.ts - point.ts > MAX_CHART_AGE_MS) return points;

  // Late/out-of-order deliveries are uncommon, but must not scramble time.
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sampleKey(points[middle]) < key) low = middle + 1;
    else high = middle;
  }
  const existing = points[low];
  if (existing && sampleKey(existing) === key) {
    if (existing.ts > point.ts || (existing.ts === point.ts && existing.value === point.value)) return points;
    const next = points.slice();
    next[low] = { ...point, gapBefore: point.gapBefore ?? existing.gapBefore };
    return next;
  }
  return prune([...points.slice(0, low), point, ...points.slice(low)]);
}

/** A live value wins a same-source-sample race against older persisted history. */
export function mergeChartPoints(historical: ChartPoint[], live: ChartPoint[]): ChartPoint[] {
  const merged = new Map<number, ChartPoint>();
  for (const point of historical) merged.set(sampleKey(point), point);
  for (const point of live) {
    const key = sampleKey(point);
    const previous = merged.get(key);
    // New persisted coverage may fill an earlier gap. Its continuity flag is
    // authoritative even when the already-rendered point carries older metadata.
    merged.set(key, previous?.gapBefore !== undefined
      ? { ...point, gapBefore: previous.gapBefore } : point);
  }
  return prune([...merged.values()].sort((a, b) => a.ts - b.ts));
}
