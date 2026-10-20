import { normalizeToTHs } from './format';

/** Expected pool block interval from its share of the Bitcoin network. */
export function estimatePoolIntervalMinutes(
  networkHashrate: number,
  networkUnit: string,
  poolHashrate: number,
  poolUnit: string,
): number | null {
  const network = normalizeToTHs(networkHashrate, networkUnit);
  const pool = normalizeToTHs(poolHashrate, poolUnit);
  if (!Number.isFinite(network) || !Number.isFinite(pool) || network <= 0 || pool <= 0 || pool > network) {
    return null;
  }
  const interval = 10 * network / pool;
  return Number.isFinite(interval) ? interval : null;
}
