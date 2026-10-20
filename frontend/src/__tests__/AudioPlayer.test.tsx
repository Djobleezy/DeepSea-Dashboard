import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../components/AudioPlayer';

vi.mock('../stores/store', () => ({
  useAppStore: (select: (state: { theme: 'bitcoin' }) => unknown) => select({ theme: 'bitcoin' }),
}));

class MediaStub extends EventTarget {
  src = '';
  paused = true;
  ended = false;
  volume = 1;
  loop = false;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn();
}

let media: MediaStub[];
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('audioPaused', 'false');
  media = [];
  vi.stubGlobal('Audio', function () {
    const audio = new MediaStub();
    media.push(audio);
    return audio;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shares playback state between the desktop and mobile controls', async () => {
  render(<><AudioPlayer /><AudioPlayer /></>);
  await act(async () => { await Promise.resolve(); });
  expect(media).toHaveLength(2);
  expect(media.filter(audio => !audio.paused)).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Pause audio' })).toHaveLength(2);

  fireEvent.click(screen.getAllByRole('button', { name: 'Pause audio' })[0]);
  expect(screen.getAllByRole('button', { name: 'Play audio' })).toHaveLength(2);
  expect(media.every(audio => audio.paused)).toBe(true);

  fireEvent.click(screen.getAllByRole('button', { name: 'Play audio' })[1]);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getAllByRole('button', { name: 'Pause audio' })).toHaveLength(2);
  expect(media.filter(audio => !audio.paused)).toHaveLength(1);
});
