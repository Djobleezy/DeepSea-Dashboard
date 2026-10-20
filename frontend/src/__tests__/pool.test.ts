import { describe, expect, it } from 'vitest';
import { estimatePoolIntervalMinutes } from '../utils/pool';

describe('pool block interval', () => {
  it('uses the pool share of network hashrate across units', () => {
    expect(estimatePoolIntervalMinutes(1000, 'EH/s', 25000, 'PH/s')).toBe(400);
    expect(estimatePoolIntervalMinutes(1051.47, 'EH/s', 24.47, 'EH/s')).toBeCloseTo(429.6976, 3);
  });

  it.each([
    [0, 25], [1000, 0], [-1, 25], [1000, -1], [1000, 1001], [NaN, 25], [1000, Infinity],
  ])('does not invent an interval for unavailable or inconsistent rates (%s, %s)', (network, pool) => {
    expect(estimatePoolIntervalMinutes(network, 'EH/s', pool, 'EH/s')).toBeNull();
  });
});
