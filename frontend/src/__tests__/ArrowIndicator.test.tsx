import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArrowIndicator } from '../components/ArrowIndicator';
import { updateArrowPrev, getArrowPrev } from '../utils/arrowState';

describe('ArrowIndicator', () => {
  it('renders nothing when previous is undefined', () => {
    const { container } = render(<ArrowIndicator current={100} />);
    // No arrow state in map → null
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when current equals previous', () => {
    const { container } = render(<ArrowIndicator current={100} previous={100} metricKey="test_eq" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when previous is NaN', () => {
    const { container } = render(<ArrowIndicator current={100} previous={NaN} metricKey="test_nan" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('updateArrowPrev / getArrowPrev', () => {
  it('stores and retrieves previous values', () => {
    updateArrowPrev('test_metric', 42);
    expect(getArrowPrev('test_metric')).toBe(42);
  });

  it('returns undefined for unknown keys', () => {
    expect(getArrowPrev('nonexistent_key')).toBeUndefined();
  });
});
