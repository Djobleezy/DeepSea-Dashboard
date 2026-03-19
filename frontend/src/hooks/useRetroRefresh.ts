/**
 * useRetroRefresh — subtle CRT-style visual pulse when new SSE data arrives.
 *
 * Triggers on metrics changes (lastUpdated timestamp).
 * Creates a scan-flash overlay element + applies body animation class.
 * Duration: 280ms. Theme-aware via CSS custom properties.
 *
 * CSS classes and keyframes are defined in global.css:
 *   .crt-refresh-active, #crt-refresh-overlay
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/store';

const ANIMATION_MS = 280;

function ensureOverlay(): HTMLElement {
  let overlay = document.getElementById('crt-refresh-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'crt-refresh-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

export function useRetroRefresh() {
  const lastUpdated = useAppStore((s) => s.lastUpdated);
  const prevUpdated = useRef<number | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip very first update (page load)
    if (prevUpdated.current === null) {
      prevUpdated.current = lastUpdated;
      return;
    }
    // No change
    if (lastUpdated === prevUpdated.current) return;
    prevUpdated.current = lastUpdated;

    // Don't stack animations — clear any pending cleanup
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Trigger scan overlay
    const overlay = ensureOverlay();
    overlay.classList.remove('active');
    // Force reflow to restart animation
    void overlay.offsetWidth;
    overlay.classList.add('active');

    // Remove after animation
    timerRef.current = setTimeout(() => {
      overlay.classList.remove('active');
      timerRef.current = null;
    }, ANIMATION_MS + 50);
  }, [lastUpdated]);
}
