import React, { useEffect, useMemo } from 'react';
import { getThemeQuote } from '../utils/themeQuotes';
import { useAppStore } from '../stores/store';

/** A short decorative welcome, not a connection test or system diagnostic. */
export const BootSequence: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const theme = useAppStore((state) => state.theme);
  const quote = useMemo(() => getThemeQuote(theme), [theme]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(onComplete, 1800);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  const skip = () => {
    localStorage.setItem('deepsea_skip_intro', '1');
    onComplete();
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-mark" aria-hidden="true">⚓</div>
      <p className="eyebrow">Your mining, in view</p>
      <h1>DEEPSEA</h1>
      <p className="page-description">Hashrate. Workers. Earnings.</p>
      <p className="welcome-quote">“{quote}”</p>
      <button className="btn" onClick={skip}>Skip intro</button>
    </div>
  );
};
