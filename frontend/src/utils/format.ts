/**
 * Auto-scale a hashrate value (assumed TH/s) to the appropriate unit.
 * Works for any magnitude — TH, PH, EH, GH, etc.
 */
export function autoScaleHashrate(
  value: number,
  sourceUnit = 'TH/s',
): { display: string; value: number; unit: string } {
  // Normalize everything to TH/s first
  const normalized = normalizeToTHs(value, sourceUnit);

  if (normalized >= 1_000_000)
    return { display: `${(normalized / 1_000_000).toFixed(2)}`, value: normalized / 1_000_000, unit: 'EH/s' };
  if (normalized >= 1_000)
    return { display: `${(normalized / 1_000).toFixed(2)}`, value: normalized / 1_000, unit: 'PH/s' };
  if (normalized >= 1)
    return { display: `${normalized.toFixed(2)}`, value: normalized, unit: 'TH/s' };
  if (normalized >= 0.001)
    return { display: `${(normalized * 1_000).toFixed(2)}`, value: normalized * 1_000, unit: 'GH/s' };
  return { display: `${(normalized * 1_000_000).toFixed(2)}`, value: normalized * 1_000_000, unit: 'MH/s' };
}

function normalizeToTHs(value: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '');
  if (u.startsWith('eh')) return value * 1_000_000;
  if (u.startsWith('ph')) return value * 1_000;
  if (u.startsWith('th')) return value;
  if (u.startsWith('gh')) return value / 1_000;
  if (u.startsWith('mh')) return value / 1_000_000;
  return value; // assume TH/s
}

export function fmtHashrate(value: number, unit = 'TH/s'): string {
  const scaled = autoScaleHashrate(value, unit);
  return `${scaled.display} ${scaled.unit}`;
}

export function fmtSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return String(sats);
}
