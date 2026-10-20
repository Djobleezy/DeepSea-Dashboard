import { describe, expect, it } from 'vitest';
import { chartSamples, chartSeries, chartUnit, chartValue, reduceChartSamples } from '../utils/hashrateChart';

const base = Date.UTC(2026, 9, 20);
const point = (offset: number, value = 1, gapBefore?: boolean) => ({ ts: base + offset, value, gapBefore });

describe('Hashrate chart time geometry', () => {
  it('keeps identical clock times on different days distinct and orders absolute timestamps', () => {
    const points = [point(86_400_000), point(0), point(60_000)];
    const rows = chartSamples(points, points, base, base + 86_400_000);
    expect(rows.map((r) => r.x)).toEqual([base, base + 60_000, base + 86_400_000]);
    expect(rows[2].gapBefore).toBe(true);
    expect(chartSeries(rows, 'short', 1).map((r) => r.y)).toEqual([1, 1, null, 1]);
  });

  it('honors source continuity after server reduction instead of inventing outages', () => {
    const points = [point(0), point(3_600_000, 2, false), point(7_200_000, 0, true)];
    const rows = chartSamples(points, points, base, base + 7_200_000);
    expect(rows.map((r) => r.gapBefore)).toEqual([false, false, true]);
    expect(chartSeries(rows, 'short', 1).filter((p) => p.y === null)).toHaveLength(1);
    expect(rows[2].short).toBe(0);
  });

  it('excludes malformed, negative, future and outside-window data without replacing them with zero', () => {
    const points = [point(-1), point(0, NaN), point(1, Infinity), point(2, -1), point(3, 0), point(4, 2), point(10)];
    const rows = chartSamples(points, points, base, base + 5);
    expect(rows.map((r) => r.short)).toEqual([0, 2]);
  });

  it('bounds dense rendering while retaining extrema of both series and all end points', () => {
    const points = Array.from({ length: 10_080 }, (_, i) => point(i * 60_000, i === 5001 ? 1000 : i === 2001 ? 0 : 10));
    const average = points.map((p, i) => ({ ...p, value: i === 7121 ? 1500 : i === 3111 ? 0 : 9 }));
    const rows = chartSamples(points, average, base, base + 10_080 * 60_000);
    rows[5010].gapBefore = true;
    const reduced = reduceChartSamples(rows);
    expect(reduced.length).toBeLessThanOrEqual(1200);
    expect(reduced[0].x).toBe(rows[0].x);
    expect(reduced[reduced.length - 1].x).toBe(rows[rows.length - 1].x);
    expect(Math.max(...reduced.map((r) => r.short!))).toBe(1000);
    expect(Math.min(...reduced.map((r) => r.short!))).toBe(0);
    expect(Math.max(...reduced.map((r) => r.average!))).toBe(1500);
    expect(Math.min(...reduced.map((r) => r.average!))).toBe(0);
    expect(chartSeries(reduced, 'short', 1).some((p) => p.y === null)).toBe(true);
  });

  it('does not round a small positive reading to zero beside a much larger peak', () => {
    expect(Number(chartValue(0.0001))).toBeGreaterThan(0);
    expect(chartValue(0)).toBe('0');
  });

  it.each([[0, 'TH/s'], [0.0001, 'MH/s'], [0.1, 'GH/s'], [100, 'TH/s'], [1000, 'PH/s'], [1e6, 'EH/s']])('selects a readable scale for %s TH/s', (value, unit) => {
    expect(chartUnit(value as number).unit).toBe(unit);
  });
});
