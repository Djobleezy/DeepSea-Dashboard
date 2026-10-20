import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchConfig, fetchMetrics, fetchWorkers, setApiWalletScope, updateConfig } from '../api/client';
import { getApiStatus, publishApiStatus, resetApiStatus } from '../api/status';
import { OfflineIndicator } from '../components/OfflineIndicator';

describe('snapshot connection state', () => {
  beforeEach(() => {
    setApiWalletScope('');
    resetApiStatus();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps cached metrics stale and preserves their source timestamp', async () => {
    setApiWalletScope('wallet-a');
    vi.mocked(fetch).mockResolvedValue(Response.json({ wallet: 'wallet-a', data_updated_at: 1234 }, { headers: { 'X-DeepSea-Cache': 'stale' } }));
    const data = await fetchMetrics();
    expect(data.data_status).toBe('stale');
    expect(data.data_updated_at).toBe(1234);
    expect(getApiStatus()).toMatchObject({ path: '/metrics', status: 'stale', updatedAt: 1234 });
    const requestHeaders = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
    expect(requestHeaders.get('X-DeepSea-Wallet')).toBe('wallet-a');
  });

  it('does not let a late config read restore the previous wallet scope', async () => {
    setApiWalletScope('wallet-a');
    let finishRead!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const oldRead = fetchConfig();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ wallet: 'wallet-b' }));
    await updateConfig({ wallet: 'wallet-b' });
    finishRead(Response.json({ wallet: 'wallet-a' }));
    await oldRead;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ wallet: 'wallet-b', data_status: 'fresh' }));
    await fetchMetrics();
    const requestHeaders = new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers);
    expect(requestHeaders.get('X-DeepSea-Wallet')).toBe('wallet-b');
  });

  it('retains a metrics failure when an unrelated worker request succeeds', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(fetchMetrics()).rejects.toThrow('offline');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ wallet: '', data_status: 'fresh' }));
    await fetchWorkers();
    expect(getApiStatus()).toMatchObject({ path: '/metrics', status: 'unavailable' });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ wallet: '', data_status: 'fresh' }));
    await fetchMetrics();
    expect(getApiStatus()).toBeNull();
  });

  it('shows a backend outage even when the browser remains online', () => {
    render(<OfflineIndicator />);
    act(() => publishApiStatus({ path: '/metrics', status: 'unavailable', updatedAt: null, error: 'unavailable' }));
    expect(screen.getByRole('status')).toHaveTextContent('Dashboard data is unavailable');
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.getByRole('status')).toHaveTextContent('Dashboard data is unavailable');
    act(() => publishApiStatus({ path: '/metrics', status: 'fresh', updatedAt: 1234, error: null }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
