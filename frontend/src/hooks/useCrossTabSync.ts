/**
 * useCrossTabSync — syncs theme and arrow state across browser tabs
 * Uses the native `storage` event (fires in OTHER tabs when localStorage changes).
 */
import { useEffect } from 'react';
import { useAppStore } from '../stores/store';
import { applyTheme } from '../theme/themes';
import type { Theme } from '../types';

const THEME_KEY = 'theme';

export function useCrossTabSync() {
  const setTheme = useAppStore((s) => s.setTheme);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.newValue === null) return;

      // Theme sync — when another tab changes theme, apply it here
      if (e.key === THEME_KEY) {
        const newTheme = e.newValue as Theme;
        const validThemes: Theme[] = ['deepsea', 'bitcoin', 'matrix'];
        if (validThemes.includes(newTheme)) {
          // Update store (don't write back to localStorage — that would loop)
          useAppStore.setState({ theme: newTheme });
          applyTheme(newTheme);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [setTheme]);
}
