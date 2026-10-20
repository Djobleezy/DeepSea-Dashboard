import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PayoutSummary } from '../components/PayoutSummary';
import type { DashboardMetrics } from '../types';

vi.mock('../hooks/usePayoutTracking', () => ({ usePayoutTracking: () => ({ lastPayout: null, avgDaysBetweenPayouts: null, newPayoutDetected: false }) }));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ formatFiat: (amount: number) => `$${amount.toFixed(2)}` }) }));

it('expresses very long payout estimates in years for small miners', () => {
  const metrics = { unpaid_earnings: .00018799, daily_mined_sats: 31, btc_price: 82422, daily_profit_usd: .03 } as DashboardMetrics;
  render(<PayoutSummary metrics={metrics} />);
  expect(screen.getByText('~87 years')).toBeInTheDocument();
  expect(screen.queryByText(/1055 months/)).not.toBeInTheDocument();
});

describe('PayoutSummary estimate limits', () => {
  it('keeps an unavailable earnings estimate explicit', () => {
    const metrics = { unpaid_earnings: 0, daily_mined_sats: 0, btc_price: 0, daily_profit_usd: 0 } as DashboardMetrics;
    render(<PayoutSummary metrics={metrics} />);
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
  });
});
