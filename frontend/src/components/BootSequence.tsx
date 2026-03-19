import React, { useEffect, useState, useMemo } from 'react';
import { getThemeQuote } from '../utils/themeQuotes';
import { useAppStore } from '../stores/store';

const BOOT_LINES = [
  'DEEPSEA DASHBOARD v2.0 — INITIALIZING',
  'LOADING SYSTEM MODULES...',
  'CONNECTING TO OCEAN.XYZ API...',
  'ESTABLISHING SSE STREAM...',
  'FETCHING HASHRATE DATA...',
  'LOADING WORKER FLEET...',
  'SYSTEM READY',
];

interface Props {
  onComplete: () => void;
}

export const BootSequence: React.FC<Props> = ({ onComplete }) => {
  const theme = useAppStore((s) => s.theme);
  const quote = useMemo(() => getThemeQuote(theme), [theme]);
  const [lines, setLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const queueTimeout = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timeouts.push(id);
    };

    const addLine = () => {
      if (i < BOOT_LINES.length) {
        setLines((prev) => [...prev, BOOT_LINES[i]]);
        i++;
        queueTimeout(addLine, i === BOOT_LINES.length ? 300 : 200 + Math.random() * 200);
      } else {
        setDone(true);
        queueTimeout(onComplete, 800);
      }
    };

    queueTimeout(addLine, 400);
    const blink = setInterval(() => setCursor((c) => !c), 500);

    return () => {
      timeouts.forEach((id) => clearTimeout(id));
      clearInterval(blink);
    };
  }, [onComplete]);

  return (
    <div
      style={{
        background: 'var(--bg)',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '0',
        padding: '40px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-vt323)',
          fontSize: '48px',
          color: 'var(--primary)',
          textShadow: '0 0 20px var(--primary-glow)',
          marginBottom: '40px',
          letterSpacing: '4px',
        }}
      >
        ⚓ DEEPSEA
      </div>
      <div
        style={{
          width: '100%',
          maxWidth: '600px',
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          lineHeight: '1.8',
          color: 'var(--text)',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              animation: 'boot-line 0.1s ease forwards',
              color: i === lines.length - 1 && done ? 'var(--color-success)' : 'var(--text)',
            }}
          >
            <span style={{ color: 'var(--primary-dim)' }}>{'> '}</span>
            {line}
            {i === lines.length - 1 && !done && (
              <span style={{ opacity: cursor ? 1 : 0 }}> ▌</span>
            )}
          </div>
        ))}
      </div>

      {/* Theme quote */}
      {done && (
        <div
          style={{
            marginTop: '32px',
            maxWidth: '500px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-dim)',
            textAlign: 'center',
            fontStyle: 'italic',
            opacity: 0.75,
          }}
        >
          "{quote}"
        </div>
      )}
    </div>
  );
};
