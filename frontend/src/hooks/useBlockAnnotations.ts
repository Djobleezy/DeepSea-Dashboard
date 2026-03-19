/**
 * useBlockAnnotations — tracks block height changes from metrics and stores
 * annotation timestamps in localStorage so they persist across page refreshes.
 *
 * Ported from v1 block-annotations.js, rewritten as a typed React hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/store';

const STORAGE_KEY = 'blockAnnotations_v2';
const DEFAULT_WINDOW_MIN = 180;
const MAX_ENTRIES = 100;

/** Show a celebratory toast when a new block is found */
type ClearBlockAnnotationsFn = () => void;

declare global {
  interface Window {
    clearBlockAnnotations?: ClearBlockAnnotationsFn;
  }
}

function showBlockToast(blockHeight: number) {
  // Remove existing toast if any
  const existing = document.getElementById('block-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'block-toast';
  toast.textContent = `⛏️ NEW BLOCK FOUND: #${blockHeight.toLocaleString()}`;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '70px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--bg-card)',
    color: 'var(--primary)',
    border: '1px solid var(--primary)',
    borderRadius: '8px',
    padding: '12px 24px',
    fontFamily: 'var(--font-vt323)',
    fontSize: '20px',
    letterSpacing: '2px',
    textShadow: '0 0 10px var(--primary-glow)',
    boxShadow: '0 0 20px var(--primary-glow), 0 4px 20px rgba(0,0,0,0.5)',
    zIndex: '9999',
    animation: 'blockToastIn 0.4s ease-out',
    whiteSpace: 'nowrap',
  });

  // Inject animation keyframes if not already present
  if (!document.getElementById('block-toast-style')) {
    const style = document.createElement('style');
    style.id = 'block-toast-style';
    style.textContent = `
      @keyframes blockToastIn {
        0% { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.9); }
        100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }
      @keyframes blockToastOut {
        0% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Fade out and remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'blockToastOut 0.4s ease-in forwards';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

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

  // Load persisted annotations on mount (and when annotation window changes)
  useEffect(() => {
    const loaded = loadFromStorage(windowMinutes);
    setAnnotations(loaded);
    initialized.current = true;
  }, [windowMinutes]);

  // Detect new block events when last_block_height changes
  useEffect(() => {
    if (!initialized.current) return;
    // Need both current and previous metrics
    if (!metrics || !prevMetrics) return;
    // Skip if previous had no real block height (first load, container restart, etc.)
    if (!prevMetrics.last_block_height) return;
    // No change
    if (metrics.last_block_height === prevMetrics.last_block_height) return;

    const now = Date.now();
    // Label must match the format used in the chart's x-axis
    const label = new Date().toLocaleTimeString();
    const newEntry: AnnotationEntry = { timestamp: now, label };

    // 🔊 Play block found sound
    try {
      const audio = new Audio('/audio/block.mp3');
      audio.volume = 0.7;
      audio.play().catch(() => {}); // ignore autoplay restrictions
    } catch {}

    // 🎉 Show congrats toast
    showBlockToast(metrics.last_block_height);

    setAnnotations((prev) => {
      const pruned = pruneEntries(prev, windowMinutes);
      // Deduplicate by label
      if (pruned.some((e) => e.label === label)) return pruned;
      const updated = [...pruned, newEntry];
      saveToStorage(updated);
      return updated;
    });
  }, [metrics, prevMetrics, windowMinutes]);

  const clear = useCallback(() => {
    setAnnotations([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('[BlockAnnotations] Error clearing storage', e);
    }
    console.log('[BlockAnnotations] Annotations cleared');
  }, []);

  // Expose clearBlockAnnotations() globally (Alt+W in keyboard shortcuts)
  useEffect(() => {
    window.clearBlockAnnotations = clear;
    return () => {
      delete window.clearBlockAnnotations;
    };
  }, [clear]);

  return { annotations };
}
