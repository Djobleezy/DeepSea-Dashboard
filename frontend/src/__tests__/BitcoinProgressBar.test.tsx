import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BitcoinProgressBar } from '../components/BitcoinProgressBar';

describe('BitcoinProgressBar', () => {
  it('renders BLOCK AGE label', () => {
    render(<BitcoinProgressBar lastBlockTime="5 mins ago" />);
    expect(screen.getByText('BLOCK AGE')).toBeInTheDocument();
  });

  it('renders with N/A time', () => {
    render(<BitcoinProgressBar lastBlockTime="N/A" />);
    expect(screen.getByText('BLOCK AGE')).toBeInTheDocument();
  });

  it('renders progress bar element', () => {
    const { container } = render(<BitcoinProgressBar lastBlockTime="5 mins ago" />);
    const bar = container.querySelector('.progress-bar');
    expect(bar).toBeInTheDocument();
  });

  it('shows default 10m target', () => {
    render(<BitcoinProgressBar lastBlockTime="5 mins ago" />);
    expect(screen.getByText(/10m 0s target/)).toBeInTheDocument();
  });

  it('accepts custom targetMinutes', () => {
    render(<BitcoinProgressBar lastBlockTime="5 mins ago" targetMinutes={20} />);
    expect(screen.getByText(/20m 0s target/)).toBeInTheDocument();
  });
});
