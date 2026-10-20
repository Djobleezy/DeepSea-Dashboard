import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../audio/engine';

class MediaStub extends EventTarget {
  src = '';
  paused = true;
  ended = false;
  volume = 1;
  currentTime = 0;
  duration = 120;
  loop = false;
  failure: Error | null = null;
  play = vi.fn(async () => {
    if (this.failure) throw this.failure;
    this.paused = false;
    this.ended = false;
  });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(() => { this.paused = true; this.ended = false; this.currentTime = 0; });
  removeAttribute = vi.fn(() => { this.src = ''; });
  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture() {
  const media: MediaStub[] = [];
  const engine = new AudioEngine(() => {
    const audio = new MediaStub();
    media.push(audio);
    return audio as unknown as HTMLAudioElement;
  });
  return { engine, media };
}

describe('shared audio engine', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-resumes one session for two controls and survives one control unmounting', async () => {
    localStorage.setItem('audioPaused', 'false');
    const { engine, media } = fixture();
    const releaseDesktop = engine.acquire('bitcoin');
    const releaseMobile = engine.acquire('bitcoin');
    await flush();
    expect(media).toHaveLength(2);
    expect(media.filter(audio => !audio.paused)).toHaveLength(1);
    expect(engine.getSnapshot().playing).toBe(true);

    releaseDesktop();
    expect(media[0].paused).toBe(false);
    engine.pause();
    expect(media.every(audio => audio.paused)).toBe(true);
    expect(localStorage.getItem('audioPaused')).toBe('true');
    releaseMobile();
  });

  it('keeps the next track playing after a transition and can advance again', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('bitcoin');
    await engine.play();
    media[0].finish();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, trackIndex: 1 });
    expect(media[1].src).toBe('/audio/bitcoin1.mp3');
    expect(media[1].paused).toBe(false);
    expect(media[0].paused).toBe(true);
    expect(media[0].src).toBe('/audio/bitcoin2.mp3');

    media[1].finish();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, trackIndex: 2 });
    expect(media[0].src).toBe('/audio/bitcoin2.mp3');
    expect(media[0].paused).toBe(false);
    release();
  });

  it('pauses both tracks and cancels an in-progress crossfade', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('matrix');
    await engine.play();
    media[0].currentTime = 119;
    media[0].dispatchEvent(new Event('timeupdate'));
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(media.filter(audio => !audio.paused)).toHaveLength(2);
    expect(media[0].volume).toBeCloseTo(0.375);
    expect(media[1].volume).toBeCloseTo(0.125);

    engine.pause();
    await vi.advanceTimersByTimeAsync(3000);
    expect(media.every(audio => audio.paused)).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, trackIndex: 0 });
    release();
  });

  it('shows rejected autoplay as paused and supports a user retry', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('deepsea');
    media[0].failure = new DOMException('Gesture required', 'NotAllowedError');
    await engine.play();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, error: 'Press play to enable audio.' });
    expect(localStorage.getItem('audioPaused')).toBe('true');
    media[0].failure = null;
    await engine.play();
    expect(engine.getSnapshot()).toMatchObject({ playing: true, error: null });
    expect(media[0].loop).toBe(true);
    release();
  });

  it('does not claim playback when starting the following track fails', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('bitcoin');
    await engine.play();
    media[1].failure = new Error('Missing audio file');
    media[0].finish();
    await flush();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, error: 'Audio unavailable. Press play to retry.' });
    expect(media.every(audio => audio.paused)).toBe(true);
    release();
  });

  it('keeps the current track when the next file fails during a crossfade', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('bitcoin');
    await engine.play();
    media[0].currentTime = 119;
    media[0].dispatchEvent(new Event('timeupdate'));
    await flush();
    media[1].dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, trackIndex: 0 });
    expect(engine.getSnapshot().error).toContain('Next audio track unavailable');
    expect(media[0].paused).toBe(false);
    expect(media[1].paused).toBe(true);
    release();
  });

  it('cancels old transitions on a theme change and resets the saved track', async () => {
    const { engine, media } = fixture();
    const release = engine.acquire('bitcoin');
    await engine.play();
    media[0].currentTime = 119;
    media[0].dispatchEvent(new Event('timeupdate'));
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    engine.setTheme('matrix');
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, theme: 'matrix', trackIndex: 0 });
    expect(media[0].src).toBe('/audio/matrix.mp3');
    expect(media[0].paused).toBe(false);
    expect(media[1].paused).toBe(true);
    expect(localStorage.getItem('audioTrackIndex')).toBe('0');
    release();
  });

  it('notifies every control and bounds persisted volume values', () => {
    localStorage.setItem('audioVolume', '5');
    const { engine, media } = fixture();
    const release = engine.acquire('deepsea');
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = engine.subscribe(first);
    const stopSecond = engine.subscribe(second);
    expect(media[0].volume).toBe(1);
    engine.setVolume(0.2);
    engine.setMuted(true);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot()).toMatchObject({ volume: 0.2, muted: true });
    expect(media[0].volume).toBe(0);
    expect(localStorage.getItem('audioVolume')).toBe('0.2');
    stopFirst(); stopSecond(); release();
  });
});
