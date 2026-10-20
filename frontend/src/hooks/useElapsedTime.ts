import { useEffect, useState } from 'react';
import { parseElapsedSecs } from '../utils/time';

/** Keep a supplied elapsed age running accurately when browser timers are throttled. */
export function useElapsedTime(value: string): number | null {
  const [seconds, setSeconds] = useState(() => parseElapsedSecs(value));

  useEffect(() => {
    const parsed = parseElapsedSecs(value);
    setSeconds(parsed);
    if (parsed === null) return;
    const epoch = Date.now() - parsed * 1000;
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - epoch) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [value]);

  return seconds;
}
