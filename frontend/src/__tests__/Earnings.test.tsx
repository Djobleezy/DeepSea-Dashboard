import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Earnings } from '../pages/Earnings';
import { fetchEarnings } from '../api/client';

vi.mock('../api/client', () => ({ fetchEarnings: vi.fn() }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatFiat: (amount: number) => `$${amount.toFixed(2)}` }),
}));

describe('Earnings', () => {
  it('labels incomplete payout totals when only part of the history is available', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue({
      payments: [], total_sats: 0, total_btc: 0, monthly_summary: [], currency: 'USD',
      data_status: 'partial', data_error: 'Some payouts may be missing.',
    });
    render(<Earnings />);
    expect(await screen.findByRole('status')).toHaveTextContent('Some payouts may be missing.');
  });

  it('shows payment types and links Lightning and on-chain payouts to their explorers', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue({
      payments: [
        {
          date: '2026-10-19 12:00',
          txid: '',
          lightning_txid: 'lightning-payment-id',
          amount_sats: 100,
          amount_btc: 0.000001,
          status: 'confirmed',
        },
        {
          date: '2026-10-18 12:00',
          txid: 'onchain-transaction-id',
          lightning_txid: '',
          amount_sats: 200,
          amount_btc: 0.000002,
          status: 'confirmed',
        },
      ],
      total_sats: 300,
      total_btc: 0.000003,
      monthly_summary: [],
      currency: 'USD',
    });

    render(<Earnings />);

    expect(await screen.findByText('⚡ LIGHTNING')).toBeInTheDocument();
    expect(screen.getByText('⛓ ON-CHAIN')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', 'https://ocean.xyz/info/tx/lightning/lightning-payment-id');
    expect(links[1]).toHaveAttribute('href', 'https://mempool.space/tx/onchain-transaction-id');
  });
});
