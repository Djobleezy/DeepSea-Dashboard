/** Parse all components of an elapsed duration, or return null when unavailable. */
export function parseElapsedSecs(value: string): number | null {
  const duration = value.trim().replace(/\s+ago$/i, '');
  if (!duration) return null;

  const component = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
  let seconds = 0;
  let end = 0;
  let found = false;
  for (const match of duration.matchAll(component)) {
    // Do not reinterpret fragments of negative/decimal numbers or unknown text.
    const separator = duration.slice(end, match.index).replace(/\band\b/gi, '');
    if (!/^[\s,]*$/.test(separator)) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit.startsWith('d') ? 86400 : unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
    seconds += amount * multiplier;
    if (!Number.isSafeInteger(seconds)) return null;
    end = match.index + match[0].length;
    found = true;
  }
  return found && duration.slice(end).trim() === '' ? seconds : null;
}

export function formatElapsedSecs(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
