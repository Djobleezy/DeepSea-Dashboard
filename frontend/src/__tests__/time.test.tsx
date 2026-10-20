import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { parseElapsedSecs } from '../utils/time';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';
import { LiveBlockTimer } from '../components/LiveBlockTimer';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('elapsed block ages', () => {
  it.each([
    ['12 hours, 18 mins ago', 44280],
    ['1 day, 2 hours, 3 mins and 4 secs ago', 93784],
    ['1 hr 2 min 3 sec', 3723],
    ['0 secs ago', 0],
    [' 5 minutes ago ', 300],
  ])('parses every component of %s', (value, seconds) => {
    expect(parseElapsedSecs(value)).toBe(seconds);
  });

  it.each(['', 'N/A', '-1 hour ago', '1.5 hours ago', '1 fortnight ago', '12 hourglass', '1 hour and invalid', '99999999999999999 secs'])('rejects unavailable or malformed age %j', value => {
    expect(parseElapsedSecs(value)).toBeNull();
  });

  it('keeps both visible timers accurate after a throttled browser interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    render(<><BitcoinProgressBar lastBlockTime="12 hours, 18 mins ago" /><LiveBlockTimer lastBlockTime="12 hours, 18 mins ago" /></>);
    expect(screen.getByTitle('Elapsed since last block: 738m 0s')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-10-20T12:00:35Z'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTitle('Elapsed since last block: 738m 36s')).toBeInTheDocument();
    expect(screen.getByText('738m 36s / 10m 0s target')).toBeInTheDocument();
  });

  it('uses the current server age rather than a stored previous block on mount', () => {
    localStorage.setItem('liveBlockTimer_lastBlockEpoch', String(Date.now() - 60_000));
    render(<LiveBlockTimer lastBlockTime="12 hours, 18 mins ago" />);
    expect(screen.getByTitle('Elapsed since last block: 738m 0s')).toBeInTheDocument();
  });

  it('keeps unknown block ages unavailable instead of running a zero timer', () => {
    vi.useFakeTimers();
    render(<><BitcoinProgressBar lastBlockTime="N/A" /><LiveBlockTimer lastBlockTime="N/A" /></>);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getAllByText(/Block time unavailable/)).toHaveLength(2);
    expect(screen.queryByText('60s')).not.toBeInTheDocument();
  });

  it('accepts a valid zero age and resynchronizes when a new block arrives', () => {
    vi.useFakeTimers();
    const { rerender } = render(<LiveBlockTimer lastBlockTime="2 hours, 10 mins ago" />);
    rerender(<LiveBlockTimer lastBlockTime="0 secs ago" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTitle('Elapsed since last block: 1s')).toBeInTheDocument();
  });

  it('uses the supplied pool interval and shows unknown estimates neutrally', () => {
    const { rerender, container } = render(<BitcoinProgressBar lastBlockTime="12 hours, 18 mins ago" targetMinutes={430} targetLabel="estimated pool interval" />);
    expect(screen.getByText('738m 0s / 430m 0s estimated pool interval')).toHaveStyle({ color: 'var(--color-warning)' });
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '100%' });
    rerender(<BitcoinProgressBar lastBlockTime="12 hours, 18 mins ago" targetMinutes={null} targetLabel="estimated pool interval" />);
    expect(screen.queryByText(/estimated pool interval/)).not.toBeInTheDocument();
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '0%' });
    rerender(<BitcoinProgressBar lastBlockTime="12 hours, 18 mins ago" targetMinutes={Number.MAX_VALUE} targetLabel="estimated pool interval" />);
    expect(screen.queryByText(/Infinity|estimated pool interval/)).not.toBeInTheDocument();
  });
});
