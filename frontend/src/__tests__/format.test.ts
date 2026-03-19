import { describe, it, expect } from 'vitest';
import { fmtHashrate, fmtSats, autoScaleHashrate, formatBtc, formatSats, formatFiat, getCurrencySymbol } from '../utils/format';

describe('fmtHashrate', () => {
  it('formats TH/s values', () => {
    expect(fmtHashrate(100, 'TH/s')).toBe('100.00 TH/s');
  });

  it('scales up to PH/s for large values', () => {
    expect(fmtHashrate(2000, 'TH/s')).toBe('2.00 PH/s');
  });

  it('scales up to EH/s for very large values', () => {
    expect(fmtHashrate(2_000_000, 'TH/s')).toBe('2.00 EH/s');
  });

  it('handles zero', () => {
    expect(fmtHashrate(0)).toBe('0.00 MH/s');
  });

  it('scales down to GH/s for small values', () => {
    expect(fmtHashrate(0.5, 'TH/s')).toBe('500.00 GH/s');
  });
});

describe('fmtSats', () => {
  it('formats small sats as plain number', () => {
    expect(fmtSats(500)).toBe('500');
  });

  it('formats thousands with K suffix', () => {
    expect(fmtSats(5000)).toBe('5.0K');
  });

  it('formats millions with M suffix', () => {
    expect(fmtSats(2_000_000)).toBe('2.00M');
  });

  it('handles zero', () => {
    expect(fmtSats(0)).toBe('0');
  });

  it('formats 1000 as 1.0K', () => {
    expect(fmtSats(1000)).toBe('1.0K');
  });
});

describe('autoScaleHashrate', () => {
  it('returns TH/s for values around 1', () => {
    const result = autoScaleHashrate(1, 'TH/s');
    expect(result.unit).toBe('TH/s');
    expect(result.value).toBe(1);
  });

  it('returns PH/s for values >= 1000 TH/s', () => {
    const result = autoScaleHashrate(1000, 'TH/s');
    expect(result.unit).toBe('PH/s');
    expect(result.value).toBe(1);
  });

  it('returns display string and positive value', () => {
    const result = autoScaleHashrate(500, 'TH/s');
    expect(result.display).toBe('500.00');
    expect(result.value).toBe(500);
    expect(result.unit).toBe('TH/s');
  });

  it('accepts EH/s source unit', () => {
    const result = autoScaleHashrate(1, 'EH/s');
    expect(result.unit).toBe('EH/s');
    expect(result.value).toBe(1);
  });

  it('converts GH/s to TH/s range', () => {
    const result = autoScaleHashrate(5000, 'GH/s');
    expect(result.unit).toBe('TH/s');
    expect(result.value).toBe(5);
  });
});

describe('formatBtc', () => {
  it('formats BTC with 8 decimal places', () => {
    expect(formatBtc(0.00313765)).toBe('0.00313765 BTC');
  });

  it('handles zero', () => {
    expect(formatBtc(0)).toBe('0.00000000 BTC');
  });
});

describe('formatSats', () => {
  it('formats with commas and sats suffix', () => {
    expect(formatSats(313765)).toBe('313,765 sats');
  });

  it('handles zero', () => {
    expect(formatSats(0)).toBe('0 sats');
  });
});

describe('formatFiat', () => {
  it('formats USD by default', () => {
    const result = formatFiat(100);
    expect(result).toContain('100');
    expect(result).toContain('$');
  });

  it('converts to EUR with rate', () => {
    const result = formatFiat(100, 'EUR', 0.88);
    expect(result).toContain('88');
  });

  it('formats JPY without decimals', () => {
    const result = formatFiat(100, 'JPY', 148.5);
    expect(result).not.toContain('.');
  });
});

describe('getCurrencySymbol', () => {
  it('returns $ for USD', () => {
    expect(getCurrencySymbol('USD')).toBe('$');
  });

  it('returns € for EUR', () => {
    expect(getCurrencySymbol('EUR')).toBe('€');
  });

  it('defaults to $ for unknown', () => {
    expect(getCurrencySymbol()).toBe('$');
  });
});
