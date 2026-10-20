import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HashrateNotices } from '../components/HashrateNotices';
import type { DashboardMetrics } from '../types';

const sample = { workers_hashing: 0, hashrate_60sec: 0, hashrate_10min: 0, hashrate_3hr: 0, hashrate_24hr: 0, low_hashrate_mode: false } as DashboardMetrics;

describe('HashrateNotices', () => {
  it('does not call hardware offline when a small miner has a zero short window', () => {
    render(<HashrateNotices metrics={{ ...sample, hashrate_3hr: 0.72975, hashrate_24hr: 0.58, low_hashrate_mode: true }} />);
    expect(screen.getByText(/No active workers reported/)).toBeInTheDocument();
    expect(screen.getByText(/using 3hr average/)).toBeInTheDocument();
    expect(screen.queryByText(/mining offline/i)).not.toBeInTheDocument();
  });

  it('still reports no activity when all available readings are zero', () => {
    render(<HashrateNotices metrics={sample} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No worker activity reported — check your miners and connection');
    expect(screen.getByRole('alert')).toHaveClass('hashrate-notice-error');
  });

  it('does not treat a volatile 60-second rate as a failure in low mode', () => {
    render(<HashrateNotices metrics={{ ...sample, workers_hashing: 1, hashrate_60sec: 0.1, hashrate_3hr: 2, hashrate_24hr: 2, low_hashrate_mode: true }} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('using 3hr average');
    expect(screen.queryByText(/variance high|possible worker issue/)).not.toBeInTheDocument();
  });

  it('reports a complete long-window drop when the three-hour reading is zero', () => {
    render(<HashrateNotices metrics={{ ...sample, workers_hashing: 1, hashrate_3hr: 0, hashrate_24hr: 2, low_hashrate_mode: true }} />);
    expect(screen.getByText('⚠ 3hr average 100% below 24hr average — check sustained mining activity')).toBeInTheDocument();
  });

  it('still highlights a sustained long-window drop in low mode', () => {
    render(<HashrateNotices metrics={{ ...sample, workers_hashing: 1, hashrate_60sec: 0.1, hashrate_3hr: 1, hashrate_24hr: 2, low_hashrate_mode: true }} />);
    expect(screen.getByText('⚠ 3hr average 50% below 24hr average — check sustained mining activity')).toBeInTheDocument();
  });

  it('does not show a no-activity notice when the pool reports active workers', () => {
    render(<HashrateNotices metrics={{ ...sample, workers_hashing: 1, hashrate_60sec: 100, hashrate_3hr: 100, hashrate_24hr: 100 }} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
