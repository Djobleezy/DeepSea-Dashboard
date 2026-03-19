/**
 * useBlockAnnotations — tracks block height changes from metrics and stores
 * annotation timestamps in localStorage so they persist across page refreshes.
 *
 * Ported from v1 block-annotations.js, rewritten as a typed React hook.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/store';

const STORAGE_KEY = 'blockAnnotations_v2';
const DEFAULT_WINDOW_MIN = 180;
const MAX_ENTRIES = 100;

export interface AnnotationEntry {
  /** Unix ms timestamp when the block was detected */
  timestamp: number;
  /** Locale time string matching chart x-axis labels */
  label: string;
}

function pruneEntries(entries: AnnotationEntry[], windowMinutes: number): AnnotationEntry[] {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const pruned = entries.filter((e) => e.timestamp >= cutoff);
  // Keep most recent entries only
  return pruned.length > MAX_ENTRIES ? pruned.slice(pruned.length - MAX_ENTRIES) : pruned;
}

function loadFromStorage(windowMinutes: number): AnnotationEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return pruneEntries(
      parsed.filter(
        (e): e is AnnotationEntry =>
          typeof e === 'object' && e !== null &&
          typeof e.timestamp === 'number' &&
          typeof e.label === 'string',
      ),
      windowMinutes,
    );
  } catch (e) {
    console.error('[BlockAnnotations] Error loading from storage', e);
    return [];
  }
}

function saveToStorage(entries: AnnotationEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('[BlockAnnotations] Error saving to storage', e);
  }
}

/**
 * @param windowMinutes – how far back to keep annotations (default 180 min)
 */
export function useBlockAnnotations(windowMinutes = DEFAULT_WINDOW_MIN) {
  const metrics = useAppStore((s) => s.metrics);
  const prevMetrics = useAppStore((s) => s.prevMetrics);
  const [annotations, setAnnotations] = useState<AnnotationEntry[]>([]);
  const initialized = useRef(false);

  // Load persisted annotations on mount
  useEffect(() => {
    const loaded = loadFromStorage(windowMinutes);
    setAnnotations(loaded);
    initialized.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect new block events when last_block_height changes
  useEffect(() => {
    if (!initialized.current) return;
    // Need both current and previous metrics
    if (!metrics || !prevMetrics) return;
    // Skip first load (no previous reference)
    if (prevMetrics.last_block_height === undefined || prevMetrics.last_block_height === null) return;
    // No change
    if (metrics.last_block_height === prevMetrics.last_block_height) return;

    const now = Date.now();
    // Label must match the format used in the chart's x-axis
    const label = new Date().toLocaleTimeString();
    const newEntry: AnnotationEntry = { timestamp: now, label };

    setAnnotations((prev) => {
      const pruned = pruneEntries(prev, windowMinutes);
      // Deduplicate by label
      if (pruned.some((e) => e.label === label)) return pruned;
      const updated = [...pruned, newEntry];
      saveToStorage(updated);
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics?.last_block_height]);

  // Expose clearBlockAnnotations() globally (Alt+W in keyboard shortcuts)
  useEffect(() => {
    const clear = () => {
      setAnnotations([]);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.error('[BlockAnnotations] Error clearing storage', e);
      }
      console.log('[BlockAnnotations] Annotations cleared');
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).clearBlockAnnotations = clear;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).clearBlockAnnotations;
    };
  }, []);

  return { annotations };
}
