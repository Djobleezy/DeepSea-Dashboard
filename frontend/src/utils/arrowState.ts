/** Shared arrow indicator state — extracted for react-refresh compatibility */

const prevMap = new Map<string, number>();

export function updateArrowPrev(key: string, value: number): void {
  prevMap.set(key, value);
}

export function getArrowPrev(key: string): number | undefined {
  return prevMap.get(key);
}
