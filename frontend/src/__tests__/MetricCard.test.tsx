import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '../components/MetricCard';

describe('MetricCard', () => {
  it('renders label', () => {
    render(<MetricCard label="Hashrate" value="100 TH/s" />);
    expect(screen.getByText('Hashrate')).toBeInTheDocument();
  });

  it('renders value', () => {
    render(<MetricCard label="Hashrate" value="100 TH/s" />);
    expect(screen.getByText('100 TH/s')).toBeInTheDocument();
  });

  it('renders unit when provided', () => {
    render(<MetricCard label="Hashrate" value={100} unit="TH/s" />);
    expect(screen.getByText('TH/s')).toBeInTheDocument();
  });

  it('renders subtext when provided', () => {
    render(<MetricCard label="Hashrate" value="100" subtext="last 60s" />);
    expect(screen.getByText('last 60s')).toBeInTheDocument();
  });

  it('applies large style when large prop set', () => {
    const { container } = render(<MetricCard label="X" value="Y" large />);
    const card = container.querySelector('.card');
    expect(card).toHaveStyle({ minHeight: '120px' });
  });

  it('applies default (non-large) style', () => {
    const { container } = render(<MetricCard label="X" value="Y" />);
    const card = container.querySelector('.card');
    expect(card).toHaveStyle({ minHeight: '90px' });
  });

  it('renders children', () => {
    render(
      <MetricCard label="X" value="Y">
        <span>child-content</span>
      </MetricCard>
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });
});
