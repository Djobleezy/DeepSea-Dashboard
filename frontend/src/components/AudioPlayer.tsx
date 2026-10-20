/** Theme-aware controls for the single shared ambient-audio session. */
import React from 'react';
import { useAppStore } from '../stores/store';
import { useAudio } from '../hooks/useAudio';

export const AudioPlayer: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const { playing, muted, volume, trackIndex: safeIndex, trackCount, error, engine } = useAudio(theme);
  const setVolume = (next: number | ((current: number) => number)) =>
    engine.setVolume(typeof next === 'function' ? next(engine.getSnapshot().volume) : next);
  const setMuted = (next: boolean | ((current: boolean) => boolean)) =>
    engine.setMuted(typeof next === 'function' ? next(engine.getSnapshot().muted) : next);
  const togglePlay = engine.togglePlay;
  const prevTrack = engine.previousTrack;
  const nextTrack = engine.nextTrack;
  const toggleMute = () => setMuted((value) => !value);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '6px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
      }}
      title={error ?? `Theme audio — ${theme} playlist (track ${safeIndex + 1}/${trackCount})`}
    >
      {error && <span role="status" style={{ flexBasis: '100%', fontSize: '11px', color: 'var(--color-warning)', maxWidth: '170px' }}>{error}</span>}
      {/* Prev */}
      {trackCount > 1 && (
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
      {trackCount > 1 && (
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

      {/* Volume slider — custom div-based for consistent cross-browser styling */}
      <div
        role="slider"
        aria-label="Volume"
        aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        title={`Volume: ${Math.round(volume * 100)}%`}
        style={{
          width: '56px',
          height: '20px',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          position: 'relative',
          opacity: muted ? 0.4 : 1,
          touchAction: 'none',
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.05;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            setVolume((v) => Math.max(0, v - step));
            setMuted(false);
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            setVolume((v) => Math.min(1, v + step));
            setMuted(false);
          }
          if (e.key === 'Home') {
            e.preventDefault();
            setVolume(0);
            setMuted(true);
          }
          if (e.key === 'End') {
            e.preventDefault();
            setVolume(1);
            setMuted(false);
          }
        }}
        onPointerDown={(e) => {
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const update = (ev: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
            const rect = el.getBoundingClientRect();
            const v = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            setVolume(v);
            if (muted && v > 0) setMuted(false);
          };
          update(e);
          const onMove = (ev: PointerEvent) => update(ev);
          const onUp = () => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
          };
          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup', onUp);
        }}
      >
        {/* Track */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '4px',
            borderRadius: '2px',
            background: 'var(--border)',
          }}
        />
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${(muted ? 0 : volume) * 100}%`,
            height: '4px',
            borderRadius: '2px',
            background: 'var(--primary)',
            boxShadow: '0 0 4px var(--primary-glow)',
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${(muted ? 0 : volume) * 100}% - 5px)`,
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'var(--primary)',
            boxShadow: '0 0 6px var(--primary-glow)',
            border: '1px solid var(--bg)',
            transition: 'left 0.05s',
          }}
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
  padding: '6px',
  minWidth: '28px',
  minHeight: '32px',
  lineHeight: 1,
  opacity: 0.8,
};
