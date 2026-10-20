/** Shared server-calibrated clock for source timestamps and chart windows. */
let offsetMs = 0;
export let lastSyncAt = 0;

export function getServerTime(): number {
  return Date.now() + offsetMs;
}

export function getClockOffset(): number {
  return offsetMs;
}

export function syncServerTime(serverTimestamp: unknown, clientBefore = Date.now(), clientAfter = Date.now()): boolean {
  if (typeof serverTimestamp !== 'number' || !Number.isFinite(serverTimestamp) || serverTimestamp <= 0) return false;
  const serverMs = serverTimestamp * 1000;
  if (!Number.isSafeInteger(Math.round(serverMs)) || serverMs > 8.64e15 ||
      !Number.isFinite(clientBefore) || !Number.isFinite(clientAfter) || clientAfter < clientBefore) return false;
  offsetMs = serverMs - (clientBefore + clientAfter) / 2;
  lastSyncAt = clientAfter;
  return true;
}

/** Clear calibration when resetting the app clock in tests. */
export function resetServerClock(): void {
  offsetMs = 0;
  lastSyncAt = 0;
}
