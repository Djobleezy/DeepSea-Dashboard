import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Boot } from '../pages/Boot';
import { BootSequence } from '../components/BootSequence';
import { Layout } from '../components/Layout';
import { fetchConfig, fetchTimezones, updateConfig } from '../api/client';

const { store } = vi.hoisted(() => ({ store: {
  theme: 'deepsea', sseConnected: true, unreadCount: 0,
  setWallet: vi.fn(), requestMetricsRefresh: vi.fn(),
} }));
vi.mock('../stores/store', () => ({ useAppStore: Object.assign((selector: (value: typeof store) => unknown) => selector(store), { getState: () => store }) }));
vi.mock('../api/client', () => ({ fetchConfig: vi.fn(), fetchTimezones: vi.fn(), updateConfig: vi.fn() }));
vi.mock('../hooks/useCurrency', () => ({ invalidateCurrencyCache: vi.fn() }));
vi.mock('../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('../hooks/useRetroRefresh', () => ({ useRetroRefresh: vi.fn() }));
vi.mock('../hooks/useThemeColor', () => ({ useThemeColor: vi.fn() }));
vi.mock('../components/AudioPlayer', () => ({ AudioPlayer: () => <button>Audio</button> }));
vi.mock('../components/ThemeToggle', () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock('../components/EasterEgg', () => ({ EasterEgg: () => null }));
vi.mock('../components/UnderwaterBubbles', () => ({ UnderwaterBubbles: () => null }));
vi.mock('../components/MatrixRain', () => ({ MatrixRain: () => null }));
vi.mock('../components/OfflineIndicator', () => ({ OfflineIndicator: () => null }));
vi.mock('../components/UpdatePrompt', () => ({ UpdatePrompt: () => null }));
vi.mock('../components/InstallPrompt', () => ({ InstallPrompt: () => null }));
const config = { wallet: 'wallet-a', power_cost: .12, power_usage: 3000, currency: 'USD', timezone: 'UTC', network_fee: .5, extended_history: false };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(fetchConfig).mockResolvedValue(config);
  vi.mocked(fetchTimezones).mockResolvedValue({ timezones: ['UTC'] });
  vi.mocked(updateConfig).mockResolvedValue({ ...config, wallet: 'wallet-b' });
});

describe('Configuration accessibility and save behavior', () => {
  it('names every field and resets wallet state only after a successful save', async () => {
    render(<MemoryRouter><Boot /></MemoryRouter>);
    const wallet = await screen.findByRole('textbox', { name: 'Bitcoin wallet address' });
    expect(screen.getByRole('spinbutton', { name: 'Electricity rate ($/kWh)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Fallback power draw (W)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Pool fee estimate (%)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Display currency' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toBeInTheDocument();
    fireEvent.change(wallet, { target: { value: 'wallet-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(store.setWallet).toHaveBeenCalledWith('wallet-b'));
    expect(store.requestMetricsRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Settings saved');
  });

  it('does not offer editable defaults after configuration loading fails', async () => {
    vi.mocked(fetchConfig).mockRejectedValue(new Error('Unavailable'));
    render(<MemoryRouter><Boot /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchConfig).toHaveBeenCalledTimes(2));
  });

  it('keeps saved wallet state unchanged if saving fails', async () => {
    vi.mocked(updateConfig).mockRejectedValue(new Error('Unavailable'));
    render(<MemoryRouter><Boot /></MemoryRouter>);
    await screen.findByRole('textbox');
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(store.setWallet).not.toHaveBeenCalled();
  });
});

describe('Mobile menu', () => {
  it('removes closed links from the focus order, focuses the open menu and returns focus on Escape', () => {
    render(<MemoryRouter><Layout><h1>Content</h1></Layout></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Toggle menu' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getAllByRole('button', { name: 'Audio' })[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Welcome intro', () => {
  it('can be skipped for future visits and does not claim connection success', () => {
    const complete = vi.fn();
    render(<BootSequence onComplete={complete} />);
    expect(screen.queryByText(/all systems nominal/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(complete).toHaveBeenCalledOnce();
    expect(localStorage.getItem('deepsea_skip_intro')).toBe('1');
  });
});
