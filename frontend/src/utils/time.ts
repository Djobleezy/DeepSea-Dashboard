/** Parses "X mins ago" / "X hours ago" / "X secs ago" → elapsed seconds */
export function parseElapsedSecs(str: string): number {
  if (!str || str === 'N/A') return 0;
  const m = str.match(/(\d+)\s*(sec|min|hour)/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('sec')) return n;
  if (unit.startsWith('min')) return n * 60;
  if (unit.startsWith('hour')) return n * 3600;
  return 0;
}
