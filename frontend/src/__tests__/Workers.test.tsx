import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workers } from '../pages/Workers';
import { useAppStore } from '../stores/store';
import { fetchMetrics, fetchWorkers, fetchWorkerSettings, saveElectricityRate, saveWorkerSettings } from '../api/client';
import type { DashboardMetrics, Worker, WorkerSummary } from '../types';

vi.mock('../api/client', () => ({
  fetchMetrics: vi.fn(), fetchWorkers: vi.fn(), fetchWorkerSettings: vi.fn(),
  saveElectricityRate: vi.fn(), saveWorkerSettings: vi.fn(),
}));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ formatFiat: (value: number) => `$${value.toFixed(2)}` }) }));

const online: Worker = {
  name: 'garage-miner', status: 'online', model: 'Test ASIC', type: 'ASIC',
  hashrate_60sec: 100, hashrate_60sec_unit: 'TH/s', hashrate_3hr: 100, hashrate_3hr_unit: 'TH/s',
  efficiency: 30, power_consumption: 3000, earnings: 0.5, estimated_daily_btc: 0.0001,
  last_share: '', acceptance_rate: 100,
};
const offline: Worker = { ...online, name: 'offline-miner', status: 'offline', hashrate_3hr: 0, power_consumption: 0, earnings: 0, estimated_daily_btc: 0 };
const summary: WorkerSummary = {
  workers: [online, offline], workers_total: 2, workers_online: 1, workers_offline: 1,
  total_hashrate: 100, hashrate_unit: 'TH/s', total_earnings: 0.5,
  total_daily_earnings_btc: 0.0001, total_power_watts: 3000, timestamp: '',
};
const metrics = { btc_price: 100000 } as DashboardMetrics;

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({ workers: null, metrics });
  vi.mocked(fetchWorkers).mockResolvedValue(summary);
  vi.mocked(fetchMetrics).mockResolvedValue(metrics);
  vi.mocked(fetchWorkerSettings).mockResolvedValue({ overrides: {}, electricity_rate: 0.12 });
  vi.mocked(saveWorkerSettings).mockImplementation(async overrides => ({ overrides, electricity_rate: 0.12 }));
});

async function showSettings() {
  render(<Workers />);
  await screen.findByRole('article', { name: 'Worker garage-miner' });
  fireEvent.click(screen.getByRole('button', { name: /Fleet power settings/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save rate' })).not.toBeDisabled());
}

describe('Workers', () => {
  it('uses daily estimates for profit and keeps fleet totals independent of filters', async () => {
    await showSettings();
    expect(screen.getAllByText('+$1.36').length).toBe(2);
    expect(screen.getByRole('article', { name: 'Worker garage-miner' })).toHaveTextContent('50,000,000 sats');
    fireEvent.click(screen.getByRole('button', { name: 'offline' }));
    expect(screen.queryByRole('article', { name: 'Worker garage-miner' })).not.toBeInTheDocument();
    expect(screen.getByText('+$1.36')).toBeInTheDocument();
    expect(fetchWorkers).toHaveBeenCalledWith('all', 'hashrate_3hr', true);
  });

  it('keeps status filters applied after an incoming full-fleet update', async () => {
    render(<Workers />);
    await screen.findByRole('article', { name: 'Worker garage-miner' });
    fireEvent.click(screen.getByRole('button', { name: 'online' }));
    act(() => useAppStore.getState().setWorkers({ ...summary, workers: [{ ...online, hashrate_3hr: 110 }, offline] }));
    expect(screen.queryByRole('article', { name: 'Worker offline-miner' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'online' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('identifies a stale snapshot and its age while retaining the last worker list', async () => {
    vi.mocked(fetchWorkers).mockResolvedValue({ ...summary, data_status: 'stale', data_updated_at: Date.now() / 1000 - 185 });
    render(<Workers />);
    expect(await screen.findByText('Worker data is stale')).toBeInTheDocument();
    expect(screen.getByText(/last successful update from 3 minutes ago/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Worker garage-miner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry worker data' })).toBeInTheDocument();
  });

  it('rejects an invalid electricity rate without changing active calculations', async () => {
    await showSettings();
    fireEvent.change(screen.getByLabelText('Electricity cost (USD/kWh)'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('between 0 and 10');
    expect(saveElectricityRate).not.toHaveBeenCalled();
    expect(screen.getAllByText('+$1.36').length).toBe(2);
  });

  it('shows failed saves and retains the previous saved rate in calculations', async () => {
    vi.mocked(saveElectricityRate).mockRejectedValue(new Error('offline'));
    await showSettings();
    fireEvent.change(screen.getByLabelText('Electricity cost (USD/kWh)'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Electricity rate was not saved');
    expect(screen.getAllByText('+$1.36').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Save rate' })).not.toBeDisabled();
  });

  it('saves zero watts without deriving an invalid zero efficiency', async () => {
    vi.mocked(saveWorkerSettings).mockImplementation(async overrides => {
      vi.mocked(fetchWorkers).mockResolvedValue({ ...summary, workers: [{ ...online, power_consumption: 0 }, offline], total_power_watts: 0 });
      return { overrides, electricity_rate: 0.12 };
    });
    await showSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust power settings for garage-miner' }));
    const card = screen.getByRole('article', { name: 'Worker garage-miner' });
    fireEvent.change(within(card).getByLabelText('Power (watts)'), { target: { value: '0' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save worker' }));
    await waitFor(() => expect(saveWorkerSettings).toHaveBeenCalledWith({
      'garage-miner': { asicId: null, efficiency: null, power: 0 },
    }));
    expect(await screen.findByText('Worker settings saved.')).toBeInTheDocument();
    expect(card).toHaveTextContent('0 W');
  });

  it('does not present failed override writes as saved', async () => {
    vi.mocked(saveWorkerSettings).mockRejectedValue(new Error('offline'));
    await showSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust power settings for offline-miner' }));
    const card = screen.getByRole('article', { name: 'Worker offline-miner' });
    fireEvent.change(within(card).getByLabelText('Power (watts)'), { target: { value: '2000' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save worker' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('previous settings are still active');
    expect(card).toHaveTextContent('0 W');
    expect(within(card).getByRole('button', { name: 'Save worker' })).not.toBeDisabled();
  });

  it('keeps editing disabled and hides cost estimates when saved settings cannot load', async () => {
    vi.mocked(fetchWorkerSettings).mockRejectedValue(new Error('offline'));
    await showSettingsWithoutWaitingForSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load saved power settings');
    expect(screen.getByRole('button', { name: 'Save rate' })).toBeDisabled();
    expect(screen.queryByText('+$1.36')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

async function showSettingsWithoutWaitingForSave() {
  render(<Workers />);
  await screen.findByRole('article', { name: 'Worker garage-miner' });
  fireEvent.click(screen.getByRole('button', { name: /Fleet power settings/ }));
}
