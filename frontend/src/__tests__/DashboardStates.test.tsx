import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../pages/Dashboard';

const { state } = vi.hoisted(() => ({ state: {
  wallet: '' as string | null, walletEpoch: 0, metrics: null as Record<string, unknown> | null, prevMetrics: null,
  metricsLoading: false, metricsError: null as string | null, requestMetricsRefresh: vi.fn(),
  chartData60s: [], chartData3hr: [], addChartPoint: vi.fn(), chartHydrated: true, hydrateChart: vi.fn(),
} }));
vi.mock('../stores/store', () => ({ useAppStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('../api/client', () => ({ fetchMetricHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('../hooks/useHashrateHistory', () => ({
  useHashrateHistory: () => ({ hours: 24, setHours: vi.fn(), loading: false, error: null, retry: vi.fn() }),
}));
vi.mock('../hooks/useDatumStatus', () => ({ useDatumStatus: () => ({ health: null, datum: null }) }));
vi.mock('../hooks/useBlockAnnotations', () => ({ useBlockAnnotations: () => ({ annotations: [] }) }));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ formatFiat: (value: number) => `$${value}`, formatFiatSigned: (value: number) => `$${value}` }) }));
vi.mock('../components/MetricCard', () => ({ MetricCard: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock('../components/PayoutSummary', () => ({ PayoutSummary: () => null }));
vi.mock('../components/HashrateNotices', () => ({ HashrateNotices: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.wallet = '';
  state.metrics = null;
  state.metricsError = null;
  state.metricsLoading = false;
});

function show() { return render(<MemoryRouter><Dashboard /></MemoryRouter>); }

describe('Dashboard source states', () => {
  it('guides an unconfigured installation to wallet setup instead of showing zero mining figures', () => {
    show();
    expect(screen.getByRole('link', { name: /Set up your dashboard/ })).toHaveAttribute('href', '/config');
    expect(screen.queryByText('Workers hashing')).not.toBeInTheDocument();
  });

  it('shows an actionable error instead of an indefinite loading message', () => {
    state.wallet = 'wallet-a';
    state.metricsError = 'Network failure';
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('Mining data is unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.requestMetricsRefresh).toHaveBeenCalledOnce();
  });

  it('labels retained readings stale and does not append a false chart sample', () => {
    state.wallet = 'wallet-a';
    state.metrics = {
      data_status: 'stale', data_updated_at: Date.now() / 1000 - 120,
      hashrate_60sec: 100, hashrate_60sec_unit: 'TH/s', hashrate_10min: 100, hashrate_10min_unit: 'TH/s',
      hashrate_3hr: 100, hashrate_3hr_unit: 'TH/s', hashrate_24hr: 100, hashrate_24hr_unit: 'TH/s',
      unpaid_earnings: 0, daily_profit_usd: 0, btc_price: 0, daily_mined_sats: 0,
      daily_revenue: 0, daily_power_cost: 0, monthly_profit_usd: 0,
      last_block_height: 0, pool_fees_percentage: 0, difficulty: 0,
      network_hashrate: 0, network_hashrate_unit: 'EH/s', pool_total_hashrate: 0, pool_total_hashrate_unit: 'PH/s',
    };
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('last available readings, not current mining status');
    expect(screen.getByText('Updated 2m ago')).toBeInTheDocument();
    expect(state.addChartPoint).not.toHaveBeenCalled();
  });

  it('resets elapsed time for a different block with the same rounded age', () => {
    vi.useFakeTimers();
    try {
      state.wallet = 'wallet-a';
      state.metrics = {
        data_status: 'fresh', data_updated_at: Date.now() / 1000,
        hashrate_60sec: 100, hashrate_60sec_unit: 'TH/s', hashrate_10min: 100, hashrate_10min_unit: 'TH/s',
        hashrate_3hr: 100, hashrate_3hr_unit: 'TH/s', hashrate_24hr: 100, hashrate_24hr_unit: 'TH/s',
        unpaid_earnings: 0, daily_profit_usd: 0, btc_price: 0, daily_mined_sats: 0,
        daily_revenue: 0, daily_power_cost: 0, monthly_profit_usd: 0,
        last_block_height: 100, last_block_time: '1 min ago', pool_fees_percentage: 0, difficulty: 0,
        network_hashrate: 1000, network_hashrate_unit: 'EH/s', pool_total_hashrate: 25, pool_total_hashrate_unit: 'EH/s',
      };
      const view = show();
      expect(screen.getByTitle('Elapsed since last block: 1m 0s')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByTitle('Elapsed since last block: 2m 0s')).toBeInTheDocument();
      state.metrics = { ...state.metrics, last_block_height: 101 };
      view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>);
      expect(screen.getByTitle('Elapsed since last block: 1m 0s')).toBeInTheDocument();
      expect(screen.getByText('1m 0s / 400m 0s estimated pool interval')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
