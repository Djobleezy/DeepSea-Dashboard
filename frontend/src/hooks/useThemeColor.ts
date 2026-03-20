import { useEffect } from 'react';
import { useAppStore } from '../stores/store';
import type { Theme } from '../types';

const THEME_COLORS: Record<Theme, string> = {
  deepsea: '#0a0e14',
  bitcoin: '#1a1a2e',
  matrix: '#0d1117',
};

export function useThemeColor(): void {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const color = THEME_COLORS[theme] ?? '#0a0e14';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [theme]);
}
