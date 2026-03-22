import React, { useEffect, useState, useMemo } from 'react';
import { getThemeQuote } from '../utils/themeQuotes';
import { useAppStore } from '../stores/store';
import { WaterDroplets } from './WaterDroplets';

/* ── Boot script ──────────────────────────────────────────────── */
/* Each entry: [text, delayAfter (ms), status]                    */
type Status = 'ok' | 'warn' | 'info' | 'done';
type BootEntry = [string, number, Status];

const BOOT_SCRIPT: BootEntry[] = [
  // Phase 1 — System init
  ['DEEPSEA DASHBOARD v2.0.4', 300, 'info'],
  ['KERNEL LOADED — ARM64 / DARWIN 25.3.0', 150, 'ok'],
  ['INITIALIZING RUNTIME ENVIRONMENT...', 250, 'ok'],
  ['MOUNTING ENCRYPTED VOLUMES...', 200, 'ok'],
  ['ENTROPY POOL: 4096 BITS — SUFFICIENT', 120, 'ok'],

  // Phase 2 — Network
  ['RESOLVING OCEAN.XYZ API ENDPOINT...', 350, 'ok'],
  ['TLS 1.3 HANDSHAKE — ESTABLISHED', 180, 'ok'],
  ['ESTABLISHING SSE STREAM TO /api/stream...', 300, 'ok'],
  ['WEBSOCKET FALLBACK: STANDBY', 100, 'info'],

  // Phase 3 — Mining subsystems
  ['LOADING WORKER FLEET MANIFEST...', 280, 'ok'],
  ['SCANNING ASIC MODELS — S21 XP / M66S+ / BITAXE', 220, 'ok'],
  ['HASHRATE NORMALIZER: TH/s → PH/s AUTO-SCALE', 150, 'ok'],
  ['BLOCK ANNOTATION ENGINE: ARMED', 120, 'ok'],
  ['NOTIFICATION ENGINE: 5 CHANNELS ACTIVE', 150, 'ok'],

  // Phase 4 — Data layer
  ['CONNECTING REDIS CACHE...', 250, 'ok'],
  ['SQLite WAL MODE — JOURNAL READY', 180, 'ok'],
  ['LOADING 24H METRIC HISTORY FROM DB...', 300, 'ok'],
  ['CHART HYDRATION: 360 DATA POINTS LOADED', 200, 'ok'],

  // Phase 5 — Display
  ['RENDERING CRT PHOSPHOR OVERLAY...', 200, 'ok'],
  ['SCANLINE GENERATOR: 2px / 60Hz', 120, 'ok'],
  ['THEME ENGINE: DEEPSEA / BITCOIN / MATRIX', 150, 'ok'],
  ['AUDIO SUBSYSTEM: 8 TRACKS LOADED', 130, 'ok'],

  // Phase 6 — Final checks
  ['RUNNING SELF-DIAGNOSTICS...', 400, 'ok'],
  ['ALL SYSTEMS NOMINAL', 200, 'done'],
  ['SYSTEM READY — DIVE DEEP ⚓', 0, 'done'],
];

/* ── Status colors ────────────────────────────────────────────── */
function statusColor(s: Status): string {
  switch (s) {
    case 'ok': return 'var(--color-success)';
    case 'warn': return 'var(--color-warning, #f0ad4e)';
    case 'done': return 'var(--primary)';
    default: return 'var(--text-dim)';
  }
}

function statusTag(s: Status): string {
  switch (s) {
    case 'ok': return '[ OK ]';
    case 'warn': return '[WARN]';
    case 'done': return '[DONE]';
    default: return '[INFO]';
  }
}

/* ── Component ────────────────────────────────────────────────── */
interface Props {
  onComplete: () => void;
}

export const BootSequence: React.FC<Props> = ({ onComplete }) => {
  const theme = useAppStore((s) => s.theme);
  const quote = useMemo(() => getThemeQuote(theme), [theme]);
  const [lines, setLines] = useState<Array<{ text: string; status: Status }>>([]);
  const [cursor, setCursor] = useState(true);
  const [done, setDone] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let i = 0;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const queueTimeout = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timeouts.push(id);
    };

    const addLine = () => {
      if (i < BOOT_SCRIPT.length) {
        const [text, delay, status] = BOOT_SCRIPT[i];
        setLines((prev) => [...prev, { text, status }]);
        setProgress(Math.round(((i + 1) / BOOT_SCRIPT.length) * 100));
        i++;
        // Add jitter for realism
        const jitter = Math.random() * 150;
        queueTimeout(addLine, delay + jitter);
      } else {
        setDone(true);
        // Quote animates in over 0.9s (0.3s delay + 0.6s duration),
        // then lingers for 0.6s before the 0.8s container fade-out begins.
        queueTimeout(() => setFadingOut(true), 1500);
        queueTimeout(onComplete, 2300);
      }
    };

    queueTimeout(addLine, 600);
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
        padding: '40px 20px',
        position: 'relative',
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.8s ease',
      }}
    >
      <WaterDroplets active={!done} />

      {/* Title */}
      <div
        style={{
          fontFamily: 'var(--font-vt323)',
          fontSize: '48px',
          color: 'var(--primary)',
          textShadow: '0 0 20px var(--primary-glow)',
          marginBottom: '16px',
          letterSpacing: '4px',
        }}
      >
        ⚓ DEEPSEA
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: '100%',
          maxWidth: '600px',
          height: '3px',
          background: 'var(--bg-card, rgba(255,255,255,0.05))',
          borderRadius: '2px',
          marginBottom: '24px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: done ? 'var(--color-success)' : 'var(--primary)',
            transition: 'width 0.2s ease',
            boxShadow: `0 0 8px ${done ? 'var(--color-success)' : 'var(--primary-glow)'}`,
          }}
        />
      </div>

      {/* Terminal output */}
      <div
        style={{
          width: '100%',
          maxWidth: '600px',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          lineHeight: '1.7',
          color: 'var(--text)',
          maxHeight: '60vh',
          overflowY: 'hidden',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              animation: 'boot-line 0.1s ease forwards',
              display: 'flex',
              gap: '8px',
            }}
          >
            <span
              style={{
                color: statusColor(line.status),
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
                fontSize: '11px',
                letterSpacing: '0.5px',
              }}
            >
              {statusTag(line.status)}
            </span>
            <span
              style={{
                color: line.status === 'done' ? 'var(--color-success)' : 'var(--text)',
              }}
            >
              {line.text}
            </span>
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
            opacity: 0,
            animation: 'stagger-in 0.6s ease 0.3s forwards',
          }}
        >
          &ldquo;{quote}&rdquo;
        </div>
      )}
    </div>
  );
};
