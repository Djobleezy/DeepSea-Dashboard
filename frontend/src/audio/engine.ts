import type { Theme } from '../types';

const PLAYLISTS: Record<Theme, string[]> = {
  bitcoin: ['/audio/bitcoin.mp3', '/audio/bitcoin1.mp3', '/audio/bitcoin2.mp3'],
  deepsea: ['/audio/ocean.mp3'],
  matrix: ['/audio/matrix.mp3', '/audio/matrix1.mp3', '/audio/matrix2.mp3'],
};

const FADE_MS = 2000;

function saved(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function persist(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Private mode or full storage. */ }
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export interface AudioState {
  theme: Theme;
  playing: boolean;
  muted: boolean;
  volume: number;
  trackIndex: number;
  trackCount: number;
  error: string | null;
}

/** One playback session shared by the desktop and mobile controls. */
export class AudioEngine {
  private state: AudioState = {
    theme: 'deepsea', playing: false,
    muted: saved('audioMuted', 'false') === 'true',
    volume: clampVolume(Number(saved('audioVolume', '0.5'))),
    trackIndex: Math.max(0, Number.parseInt(saved('audioTrackIndex', '0'), 10) || 0),
    trackCount: 1, error: null,
  };
  private listeners = new Set<() => void>();
  private consumers = 0;
  private current: HTMLAudioElement | null = null;
  private upcoming: HTMLAudioElement | null = null;
  private generation = 0;
  private fading = false;
  private fadeStep = 0;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private wantsPlayback = false;
  private failedTransition = false;

  constructor(private readonly createAudio: () => HTMLAudioElement = () => new Audio()) {}

  getSnapshot = (): AudioState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(next: Partial<AudioState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }

  acquire(theme: Theme): () => void {
    this.consumers++;
    if (!this.current) {
      this.current = this.createAudio();
      this.upcoming = this.createAudio();
      for (const audio of [this.current, this.upcoming]) {
        audio.addEventListener('ended', this.onEnded);
        audio.addEventListener('timeupdate', this.onTimeUpdate);
        audio.addEventListener('error', this.onError);
      }
      const trackCount = PLAYLISTS[theme].length;
      this.update({ theme, trackCount, trackIndex: this.state.trackIndex % trackCount, error: null });
      this.prepareTracks();
      if (saved('audioPaused', 'true') === 'false') void this.play();
    } else {
      this.setTheme(theme);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.consumers === 0) this.dispose();
    };
  }

  private volume(): number { return this.state.muted ? 0 : this.state.volume; }

  private load(audio: HTMLAudioElement, index: number): void {
    audio.src = PLAYLISTS[this.state.theme][index];
    audio.loop = this.state.trackCount === 1;
    audio.load();
  }

  private prepareTracks(): void {
    if (!this.current || !this.upcoming) return;
    this.load(this.current, this.state.trackIndex);
    this.load(this.upcoming, (this.state.trackIndex + 1) % this.state.trackCount);
    this.current.volume = this.volume();
    this.upcoming.volume = 0;
    this.failedTransition = false;
  }

  private stopFade(): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.fading = false;
    this.fadeStep = 0;
    this.upcoming?.pause();
    if (this.current) this.current.volume = this.volume();
  }

  private failure(error: unknown): string {
    return error instanceof DOMException && error.name === 'NotAllowedError'
      ? 'Press play to enable audio.'
      : 'Audio unavailable. Press play to retry.';
  }

  async play(): Promise<void> {
    const audio = this.current;
    if (!audio) return;
    const generation = ++this.generation;
    this.wantsPlayback = true;
    this.failedTransition = false;
    this.update({ error: null });
    try {
      await audio.play();
      if (generation !== this.generation) return;
      this.update({ playing: true });
      persist('audioPaused', 'false');
    } catch (error) {
      if (generation !== this.generation) return;
      this.wantsPlayback = false;
      this.stopFade();
      audio.pause();
      this.update({ playing: false, error: this.failure(error) });
      persist('audioPaused', 'true');
    }
  }

  pause = (): void => {
    this.generation++;
    this.wantsPlayback = false;
    this.stopFade();
    this.current?.pause();
    this.update({ playing: false, error: null });
    persist('audioPaused', 'true');
  };

  togglePlay = (): void => {
    if (this.wantsPlayback) this.pause(); else void this.play();
  };

  setVolume = (value: number): void => {
    const volume = clampVolume(value);
    this.update({ volume });
    persist('audioVolume', String(volume));
    this.applyVolume();
  };

  setMuted = (muted: boolean): void => {
    this.update({ muted });
    persist('audioMuted', String(muted));
    this.applyVolume();
  };

  private applyVolume(): void {
    const progress = this.fading ? this.fadeStep / 20 : 0;
    if (this.current) this.current.volume = this.volume() * (1 - progress);
    if (this.upcoming) this.upcoming.volume = this.volume() * progress;
  }

  private changeTrack(index: number): void {
    const resume = this.wantsPlayback;
    this.generation++;
    this.stopFade();
    this.current?.pause();
    const trackIndex = (index + this.state.trackCount) % this.state.trackCount;
    this.update({ trackIndex, playing: false, error: null });
    persist('audioTrackIndex', String(trackIndex));
    this.prepareTracks();
    if (resume) void this.play();
  }

  previousTrack = (): void => this.changeTrack(this.state.trackIndex - 1);
  nextTrack = (): void => this.changeTrack(this.state.trackIndex + 1);

  setTheme = (theme: Theme): void => {
    if (theme === this.state.theme) return;
    this.update({ theme, trackCount: PLAYLISTS[theme].length });
    this.changeTrack(0);
  };

  private onEnded = (event: Event): void => {
    if (event.currentTarget !== this.current || !this.wantsPlayback) return;
    if (this.state.trackCount > 1) void this.advance();
  };

  private onTimeUpdate = (event: Event): void => {
    const audio = this.current;
    if (event.currentTarget !== audio || !audio || this.state.trackCount < 2 || !this.wantsPlayback || this.failedTransition) return;
    const remaining = audio.duration - audio.currentTime;
    if (Number.isFinite(remaining) && remaining > 0 && remaining <= FADE_MS / 1000) void this.advance();
  };

  private onError = (event: Event): void => {
    if (event.currentTarget === this.upcoming && this.fading) {
      this.generation++;
      this.stopFade();
      this.failedTransition = true;
      const playing = !!this.current && !this.current.paused && !this.current.ended;
      this.wantsPlayback = playing;
      this.update({ playing, error: 'Next audio track unavailable. Press next to retry.' });
      if (!playing) persist('audioPaused', 'true');
      return;
    }
    if (event.currentTarget !== this.current) return;
    this.pause();
    this.update({ error: 'Audio unavailable. Press play to retry.' });
  };

  private async advance(): Promise<void> {
    if (this.fading || !this.current || !this.upcoming) return;
    this.fading = true;
    const generation = ++this.generation;
    const previous = this.current;
    const next = this.upcoming;
    next.volume = 0;
    try {
      await next.play();
      if (generation !== this.generation) return;
    } catch (error) {
      if (generation !== this.generation) return;
      this.stopFade();
      this.failedTransition = true;
      const playing = !previous.paused && !previous.ended;
      this.wantsPlayback = playing;
      this.update({ playing, error: this.failure(error) });
      if (!playing) persist('audioPaused', 'true');
      return;
    }
    this.fadeTimer = setInterval(() => {
      if (generation !== this.generation) return;
      this.fadeStep++;
      this.applyVolume();
      if (this.fadeStep < 20) return;
      if (this.fadeTimer) clearInterval(this.fadeTimer);
      this.fadeTimer = null;
      // Swap the live elements: copying src would stop the newly playing track.
      previous.pause();
      this.current = next;
      this.upcoming = previous;
      this.fading = false;
      this.fadeStep = 0;
      const trackIndex = (this.state.trackIndex + 1) % this.state.trackCount;
      this.update({ trackIndex, playing: true, error: null });
      persist('audioTrackIndex', String(trackIndex));
      next.volume = this.volume();
      this.load(previous, (trackIndex + 1) % this.state.trackCount);
      previous.volume = 0;
    }, FADE_MS / 20);
  }

  private dispose(): void {
    this.generation++;
    this.stopFade();
    for (const audio of [this.current, this.upcoming]) {
      if (!audio) continue;
      audio.pause();
      audio.removeEventListener('ended', this.onEnded);
      audio.removeEventListener('timeupdate', this.onTimeUpdate);
      audio.removeEventListener('error', this.onError);
      audio.removeAttribute('src');
      audio.load();
    }
    this.current = null;
    this.upcoming = null;
    this.wantsPlayback = false;
    this.update({ playing: false });
  }
}

export const audioEngine = new AudioEngine();
