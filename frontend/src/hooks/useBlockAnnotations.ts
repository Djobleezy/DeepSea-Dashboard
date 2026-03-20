/**
 * useBlockAnnotations — tracks block height changes from metrics and stores
 * annotation timestamps in localStorage so they persist across page refreshes.
 *
 * Ported from v1 block-annotations.js, rewritten as a typed React hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/store';
import { fetchPoolBlocks } from '../api/client';

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

/** Launch animated confetti particles for 3-4 seconds when a new block is found */
function showBlockCelebration() {
  // Inject CSS if needed (keyframes defined in global.css)
  const CONFETTI_COLORS = [
    '#f7931a', // bitcoin orange
    '#00cc66', // green
    '#0088cc', // deepsea blue
    '#ffaa00', // gold
    '#ff4444', // red
    '#ffffff',
  ];

  const isMobile = window.innerWidth < 768;
  const count = isMobile ? 30 : 60;
  const container = document.body;
  const particles: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';

    const left  = Math.random() * 100;                    // 0-100% horizontal start
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const size  = Math.floor(Math.random() * 8) + 5;      // 5-13px
    const dur   = (Math.random() * 1.5 + 2.5).toFixed(2); // 2.5-4s
    const delay = (Math.random() * 0.8).toFixed(2);        // 0-0.8s stagger
    const drift = Math.round(Math.random() * 100 - 50);   // -50 to +50px

    el.style.left       = `${left}%`;
    el.style.width      = `${size}px`;
    el.style.height     = `${size}px`;
    el.style.background = color;
    el.style.boxShadow  = `0 0 4px ${color}`;
    (el.style as unknown as Record<string, string>)['--duration'] = `${dur}s`;
    (el.style as unknown as Record<string, string>)['--delay']    = `${delay}s`;
    (el.style as unknown as Record<string, string>)['--drift']    = `${drift}px`;

    container.appendChild(el);
    particles.push(el);
  }

  // Cleanup after longest possible animation (4.8s = 4s + 0.8s max delay)
  setTimeout(() => {
    particles.forEach((p) => {
      if (p.parentNode) p.parentNode.removeChild(p);
    });
  }, 4800);
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

  // Load persisted annotations on mount, then backfill from pool blocks API
  useEffect(() => {
    // One-time migration: flush false positives from network-block bug
    const MIGRATION_KEY = 'blockAnnotations_v2_migrated_pool';
    let stored: AnnotationEntry[] = [];
    if (!localStorage.getItem(MIGRATION_KEY)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(MIGRATION_KEY, '1');
    } else {
      stored = loadFromStorage(windowMinutes);
    }

    // Backfill: fetch recent Ocean pool blocks and seed any within window
    const hours = Math.ceil(windowMinutes / 60);
    fetchPoolBlocks(hours)
      .then(({ blocks }) => {
        const cutoff = Date.now() - windowMinutes * 60 * 1000;
        const existingTs = new Set(stored.map((e) => e.timestamp));
        let merged = [...stored];
        for (const b of blocks) {
          // Skip if already tracked (within 60s tolerance)
          const alreadyTracked = stored.some(
            (e) => Math.abs(e.timestamp - b.timestamp) < 60_000,
          );
          if (alreadyTracked || b.timestamp < cutoff) continue;
          merged.push({
            timestamp: b.timestamp,
            label: new Date(b.timestamp).toLocaleTimeString(),
          });
        }
        merged = pruneEntries(merged, windowMinutes);
        saveToStorage(merged);
        setAnnotations(merged);
      })
      .catch(() => {
        // Fallback to local storage only
        setAnnotations(stored);
      });

    initialized.current = true;
  }, [windowMinutes]);

  // Detect new block events when last_block_height changes
  useEffect(() => {
    if (!initialized.current) return;
    // Need both current and previous metrics
    if (!metrics || !prevMetrics) return;
    // last_block_height comes from Ocean's /v1/blocks endpoint (pool blocks only,
    // NOT network blocks). It only changes when Ocean finds a block.
    if (!prevMetrics.last_block_height) return;
    // No change
    if (metrics.last_block_height === prevMetrics.last_block_height) return;
    // Only celebrate height increases (not decreases from reorgs/resets)
    if (metrics.last_block_height <= prevMetrics.last_block_height) return;

    const now = Date.now();
    // Label must match the format used in the chart's x-axis
    const label = new Date().toLocaleTimeString();
    const newEntry: AnnotationEntry = { timestamp: now, label };

    // 🔊 Play block found sound with background music ducking (v1 behavior)
    try {
      const blockAudio = new Audio('/audio/block.mp3');
      blockAudio.volume = 0.7;

      // Duck background audio to 30% during block sound
      const bgAudio = document.getElementById('backgroundAudio') as HTMLAudioElement | null;
      let originalVolume: number | null = null;
      if (bgAudio && !bgAudio.muted && !bgAudio.paused) {
        originalVolume = bgAudio.volume;
        bgAudio.volume = Math.max(0, bgAudio.volume * 0.3);
      }
      const restoreVolume = () => {
        if (originalVolume !== null && bgAudio) {
          bgAudio.volume = originalVolume as number;
        }
      };
      blockAudio.addEventListener('ended', restoreVolume);
      blockAudio.addEventListener('error', restoreVolume);
      blockAudio.play().catch(restoreVolume);
    } catch (_err) {
      // ignore missing/blocked audio
    }

    // 🎉 Show congrats toast
    showBlockToast(metrics.last_block_height);

    // 🎊 Full-screen confetti celebration (3-4 seconds)
    showBlockCelebration();

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
