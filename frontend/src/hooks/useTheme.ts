import { useEffect } from 'react';
import { useAppStore } from '../stores/store';
import { applyTheme } from '../theme/themes';
import { useCrossTabSync } from './useCrossTabSync';
import type { Theme } from '../types';

export function useTheme() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // Sync theme changes from other tabs
  useCrossTabSync();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycleTheme = () => {
    const order: Theme[] = ['deepsea', 'bitcoin', 'matrix'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  };

  return { theme, setTheme, cycleTheme };
}
