/**
 * AudioPlayer — theme-aware ambient audio player
 *
 * Audio files live at /static/audio/ (served by FastAPI backend).
 * The component gracefully handles missing files (no crash, silent fail).
 *
 * Playlists:
 *   bitcoin  → bitcoin.mp3, bitcoin1.mp3, bitcoin2.mp3
 *   deepsea  → ocean.mp3
 *   matrix   → matrix.mp3, matrix1.mp3, matrix2.mp3
 *
 * State persisted to localStorage:
 *   audioVolume, audioTrackIndex, audioMuted, audioPaused
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../stores/store';
import type { Theme } from '../types';

const PLAYLISTS: Record<Theme, string[]> = {
  bitcoin: [
    '/audio/bitcoin.mp3',
    '/audio/bitcoin1.mp3',
    '/audio/bitcoin2.mp3',
  ],
  deepsea: ['/audio/ocean.mp3'],
  matrix: [
    '/audio/matrix.mp3',
    '/audio/matrix1.mp3',
    '/audio/matrix2.mp3',
  ],
};

const CROSSFADE_DURATION = 2; // seconds

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export const AudioPlayer: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const playlist = PLAYLISTS[theme];

  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const nextRef = useRef<HTMLAudioElement>(new Audio());
  const crossfadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCrossfadingRef = useRef(false);
  const trackIndexRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(() => load('audioMuted', 'false') === 'true');
  const [volume, setVolume] = useState<number>(() => {
    const v = parseFloat(load('audioVolume', '0.5'));
    return isNaN(v) ? 0.5 : v;
  });
  const [trackIndex, setTrackIndex] = useState<number>(() => {
    const idx = parseInt(load('audioTrackIndex', '0'), 10);
    return isNaN(idx) ? 0 : idx;
  });

  // Clamp track index whenever playlist changes (theme switch)
  const safeIndex = trackIndex % playlist.length;

  useEffect(() => {
    trackIndexRef.current = safeIndex;
  }, [safeIndex]);

  // ── helpers ──────────────────────────────────────────────────────────────
  const loadTrack = useCallback(
    (el: HTMLAudioElement, idx: number) => {
      el.src = playlist[idx % playlist.length];
      el.load();
      el.volume = volume;
    },
    [playlist, volume]
  );

  const startCrossfade = useCallback((nextIdx: number) => {
    if (isCrossfadingRef.current) return;
    isCrossfadingRef.current = true;

    const cur = audioRef.current;
    const nxt = nextRef.current;

    nxt.volume = 0;
    nxt.play().catch(() => {});

    const steps = 20;
    const stepMs = (CROSSFADE_DURATION * 1000) / steps;
    let step = 0;

    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
    }

    crossfadeIntervalRef.current = setInterval(() => {
      step++;
      const pct = step / steps;
      cur.volume = Math.max(0, volume * (1 - pct));
      nxt.volume = Math.min(volume, volume * pct);
      if (step >= steps) {
        if (crossfadeIntervalRef.current) {
          clearInterval(crossfadeIntervalRef.current);
          crossfadeIntervalRef.current = null;
        }
        cur.pause();
        cur.src = nxt.src;
        cur.volume = volume;
        isCrossfadingRef.current = false;
        // prepare following track
        const followingIdx = (nextIdx + 1) % playlist.length;
        loadTrack(nxt, followingIdx);
      }
    }, stepMs);
  }, [volume, playlist, loadTrack]);

  // ── initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    const cur = audioRef.current;
    loadTrack(cur, safeIndex);
    loadTrack(nextRef.current, (safeIndex + 1) % playlist.length);
    cur.loop = playlist.length === 1;

    // End-of-track handler
    const onEnded = () => {
      if (playlist.length === 1) return; // looping, won't fire
      const currentIdx = trackIndexRef.current;
      const nextIdx = (currentIdx + 1) % playlist.length;
      setTrackIndex(nextIdx);
      trackIndexRef.current = nextIdx;
      persist('audioTrackIndex', String(nextIdx));
      startCrossfade(nextIdx);
    };
    cur.addEventListener('ended', onEnded);

    // Auto-resume if was playing before
    const wasPaused = load('audioPaused', 'true') === 'true';
    if (!wasPaused) {
      cur.play().then(() => setPlaying(true)).catch(() => {});
    }

    return () => {
      cur.removeEventListener('ended', onEnded);
      if (crossfadeIntervalRef.current) {
        clearInterval(crossfadeIntervalRef.current);
        crossfadeIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once on mount

  // ── theme change → switch playlist ───────────────────────────────────────
  useEffect(() => {
    const cur = audioRef.current;
    const wasPlaying = playing;
    cur.pause();
    const newIdx = 0;
    setTrackIndex(newIdx);
    trackIndexRef.current = newIdx;
    loadTrack(cur, newIdx);
    loadTrack(nextRef.current, 1 % playlist.length);
    cur.loop = playlist.length === 1;
    if (wasPlaying) {
      cur.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // ── volume sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    audioRef.current.volume = muted ? 0 : volume;
    nextRef.current.volume = muted ? 0 : volume;
    persist('audioVolume', String(volume));
    persist('audioMuted', String(muted));
  }, [volume, muted]);

  // ── controls ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const cur = audioRef.current;
    if (playing) {
      cur.pause();
      setPlaying(false);
      persist('audioPaused', 'true');
    } else {
      cur.play().then(() => {
        setPlaying(true);
        persist('audioPaused', 'false');
      }).catch(() => {});
    }
  }, [playing]);

  const prevTrack = useCallback(() => {
    const newIdx = (safeIndex - 1 + playlist.length) % playlist.length;
    setTrackIndex(newIdx);
    trackIndexRef.current = newIdx;
    persist('audioTrackIndex', String(newIdx));
    const cur = audioRef.current;
    loadTrack(cur, newIdx);
    loadTrack(nextRef.current, (newIdx + 1) % playlist.length);
    if (playing) cur.play().catch(() => {});
  }, [safeIndex, playlist, playing, loadTrack]);

  const nextTrack = useCallback(() => {
    const newIdx = (safeIndex + 1) % playlist.length;
    setTrackIndex(newIdx);
    trackIndexRef.current = newIdx;
    persist('audioTrackIndex', String(newIdx));
    const cur = audioRef.current;
    loadTrack(cur, newIdx);
    loadTrack(nextRef.current, (newIdx + 1) % playlist.length);
    if (playing) cur.play().catch(() => {});
  }, [safeIndex, playlist, playing, loadTrack]);

  const toggleMute = () => setMuted((m) => !m);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
      }}
      title={`Theme audio — ${theme} playlist (track ${safeIndex + 1}/${playlist.length})`}
    >
      {/* Prev */}
      {playlist.length > 1 && (
        <button
          onClick={prevTrack}
          style={btnStyle}
          title="Previous track"
          aria-label="Previous track"
        >
          ⏮
        </button>
      )}

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        style={{ ...btnStyle, color: playing ? 'var(--primary)' : 'var(--text-dim)' }}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause audio' : 'Play audio'}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* Next */}
      {playlist.length > 1 && (
        <button
          onClick={nextTrack}
          style={btnStyle}
          title="Next track"
          aria-label="Next track"
        >
          ⏭
        </button>
      )}

      {/* Mute */}
      <button
        onClick={toggleMute}
        style={btnStyle}
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute audio' : 'Mute audio'}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {/* Volume slider */}
      <div style={{ position: 'relative', width: '60px', height: '20px', display: 'flex', alignItems: 'center' }}>
        <style>{`
          .audio-vol::-webkit-slider-runnable-track {
            height: 4px;
            background: var(--border);
            border-radius: 2px;
          }
          .audio-vol::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--primary);
            box-shadow: 0 0 6px var(--primary-glow);
            cursor: pointer;
            margin-top: -4px;
          }
          .audio-vol::-moz-range-track {
            height: 4px;
            background: var(--border);
            border-radius: 2px;
          }
          .audio-vol::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--primary);
            box-shadow: 0 0 6px var(--primary-glow);
            border: none;
            cursor: pointer;
          }
        `}</style>
        <input
          className="audio-vol"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            if (muted && v > 0) setMuted(false);
          }}
          style={{
            width: '100%',
            WebkitAppearance: 'none',
            appearance: 'none' as any,
            background: 'transparent',
            cursor: 'pointer',
            opacity: muted ? 0.4 : 1,
            margin: 0,
            padding: 0,
          }}
          title={`Volume: ${Math.round(volume * 100)}%`}
        />
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: '13px',
  padding: '2px 3px',
  lineHeight: 1,
  opacity: 0.8,
};
