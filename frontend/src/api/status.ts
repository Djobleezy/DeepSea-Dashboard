export type ApiDataStatus = 'fresh' | 'stale' | 'unavailable';

export interface ApiStatusUpdate {
  path: string;
  status: ApiDataStatus;
  updatedAt: number | null;
  error: string | null;
}

export const API_STATUS_EVENT = 'deepsea:api-status';
const statuses = new Map<string, ApiStatusUpdate>();

export function publishApiStatus(update: ApiStatusUpdate): void {
  if (update.status === 'fresh') statuses.delete(update.path);
  else statuses.set(update.path, update);
  window.dispatchEvent(new CustomEvent<ApiStatusUpdate>(API_STATUS_EVENT, { detail: update }));
}

export function resetApiStatus(): void {
  statuses.clear();
  window.dispatchEvent(new CustomEvent(API_STATUS_EVENT));
}

export function getApiStatus(): ApiStatusUpdate | null {
  const values = [...statuses.values()];
  return values.find((status) => status.status === 'unavailable') ?? values[0] ?? null;
}
