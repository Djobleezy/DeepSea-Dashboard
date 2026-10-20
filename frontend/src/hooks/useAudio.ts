import { useEffect, useRef, useSyncExternalStore } from 'react';
import { audioEngine } from '../audio/engine';
import type { Theme } from '../types';

export function useAudio(theme: Theme) {
  const state = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot);
  const initialTheme = useRef(theme);
  useEffect(() => audioEngine.acquire(initialTheme.current), []);
  useEffect(() => audioEngine.setTheme(theme), [theme]);
  return { ...state, engine: audioEngine };
}
