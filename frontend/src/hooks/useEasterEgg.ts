import { useState, useEffect, useRef, useCallback } from 'react';

export type EasterEggState = {
  overlayVisible: boolean;
  overlayTheme: string;
  overlayMessage: string;
  overlayQuote: string;
  whaleMode: boolean;
  matrixRain: boolean;
};

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const MATRIX_WORD = ['m', 'a', 't', 'r', 'i', 'x'];

const STORAGE_KEY = 'easterEggActive';

export function useEasterEgg(
  theme: string,
  getQuote: (theme: string) => string,
  onMatrixActivate?: () => void,
) {
  const [state, setState] = useState<EasterEggState>(() => ({
    overlayVisible: false,
    overlayTheme: theme,
    overlayMessage: '',
    overlayQuote: '',
    whaleMode: localStorage.getItem(STORAGE_KEY) === 'true',
    matrixRain: false,
  }));

  const konamiIdx = useRef(0);
  const matrixIdx = useRef(0);
  const cursorClicks = useRef<number[]>([]);
  const headerTaps = useRef<number[]>([]);
  const lastWhaleTime = useRef(0);

  // Sync whaleMode to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(state.whaleMode));
  }, [state.whaleMode]);

  const triggerOverlay = useCallback(() => {
    const wasActive = state.whaleMode;
    const message = wasActive
      ? 'Easter Egg Disabled!'
      : theme === 'matrix'
        ? 'Entering the Matrix...'
        : theme === 'deepsea'
          ? 'Plunging into DeepSea!'
          : 'Embracing Bitcoin vibes!';

    setState((prev) => ({
      ...prev,
      overlayVisible: true,
      overlayTheme: theme,
      overlayMessage: message,
      overlayQuote: getQuote(theme),
      whaleMode: !wasActive,
    }));

    setTimeout(() => {
      setState((prev) => ({ ...prev, overlayVisible: false }));
    }, 15000);
  }, [state.whaleMode, theme, getQuote]);

  const triggerMatrixRain = useCallback(() => {
    setState((prev) => ({ ...prev, matrixRain: true }));
    onMatrixActivate?.();
    setTimeout(() => {
      setState((prev) => ({ ...prev, matrixRain: false }));
    }, 5000);
  }, [onMatrixActivate]);

  // Keyboard handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const key = e.key;

      // Matrix word sequence (only when egg is active)
      if (state.whaleMode) {
        if (key.toLowerCase() === MATRIX_WORD[matrixIdx.current]) {
          matrixIdx.current++;
          if (matrixIdx.current === MATRIX_WORD.length) {
            matrixIdx.current = 0;
            triggerMatrixRain();
            return;
          }
        } else {
          matrixIdx.current = 0;
        }
      }

      // Konami code
      if (key === KONAMI[konamiIdx.current]) {
        konamiIdx.current++;
        if (konamiIdx.current === KONAMI.length) {
          konamiIdx.current = 0;
          triggerOverlay();
        }
      } else {
        konamiIdx.current = 0;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state.whaleMode, triggerOverlay, triggerMatrixRain]);

  // Cursor triple-click handler (10 clicks within 2s)
  useEffect(() => {
    const handleCursorClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.id === 'terminal-cursor' || target.classList.contains('terminal-cursor')) {
        const now = Date.now();
        cursorClicks.current.push(now);
        cursorClicks.current = cursorClicks.current.filter((t) => now - t < 2000);
        if (cursorClicks.current.length >= 10) {
          cursorClicks.current = [];
          triggerOverlay();
        }
      }
    };

    window.addEventListener('click', handleCursorClick as EventListener);
    window.addEventListener('touchstart', handleCursorClick as EventListener);
    return () => {
      window.removeEventListener('click', handleCursorClick as EventListener);
      window.removeEventListener('touchstart', handleCursorClick as EventListener);
    };
  }, [triggerOverlay]);

  // Card header tap (10 taps within 2s while active)
  useEffect(() => {
    const handleHeaderTap = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.('.card-header')) {
        const now = Date.now();
        headerTaps.current.push(now);
        headerTaps.current = headerTaps.current.filter((t) => now - t < 2000);
        if (headerTaps.current.length >= 10 && state.whaleMode) {
          headerTaps.current = [];
          triggerMatrixRain();
        }
      }
    };

    window.addEventListener('click', handleHeaderTap as EventListener);
    window.addEventListener('touchstart', handleHeaderTap as EventListener);
    return () => {
      window.removeEventListener('click', handleHeaderTap as EventListener);
      window.removeEventListener('touchstart', handleHeaderTap as EventListener);
    };
  }, [state.whaleMode, triggerMatrixRain]);

  // Whale mousemove handler
  useEffect(() => {
    if (!state.whaleMode) return;

    const symbol = theme === 'matrix' ? '💲' : theme === 'deepsea' ? '🐳' : '₿';
    const color = theme === 'matrix' ? '#39ff14' : theme === 'bitcoin' ? '#f7931a' : undefined;

    const spawnWhale = (x: number, y: number) => {
      const now = Date.now();
      if (now - lastWhaleTime.current < 50) return;
      lastWhaleTime.current = now;

      for (let i = 0; i < 1; i++) {
        const el = document.createElement('span');
        el.className = 'easter-egg-whale';
        el.textContent = symbol;
        const angle = Math.random() * Math.PI * 2;
        const distance = 60 + Math.random() * 40;
        el.style.cssText = `
          position: fixed;
          pointer-events: none;
          z-index: 9999;
          left: ${x}px;
          top: ${y}px;
          font-size: 20px;
          animation: whale-burst 1s ease-out forwards;
          --wx: ${Math.cos(angle) * distance}px;
          --wy: ${Math.sin(angle) * distance}px;
          ${color ? `color: ${color};` : ''}
        `;
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
      }
    };

    const onMove = (e: MouseEvent) => spawnWhale(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) spawnWhale(t.clientX, t.clientY);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchstart', onTouch);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchstart', onTouch);
    };
  }, [state.whaleMode, theme]);

  return state;
}
