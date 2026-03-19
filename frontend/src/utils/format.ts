// Currency symbol map for supported currencies
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
  CHF: 'CHF ',
};

// Locale hints for Intl.NumberFormat per currency
const CURRENCY_LOCALES: Record<string, string> = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  CAD: 'en-CA',
  AUD: 'en-AU',
  JPY: 'ja-JP',
  CHF: 'de-CH',
};

/**
 * Format a BTC amount as "0.00313765 BTC"
 */
export function formatBtc(amount: number): string {
  return `${amount.toFixed(8)} BTC`;
}

/**
 * Format satoshis as "313,765 sats"
 */
export function formatSats(sats: number): string {
  return `${new Intl.NumberFormat('en-US').format(Math.round(sats))} sats`;
}

/**
 * Format a USD amount to local currency.
 * formatFiat(223.45, 'EUR', 0.88) → "€197.68"
 * formatFiat(223.45, 'JPY', 148.5) → "¥33,182"
 * Falls back to USD if currency/rate missing.
 */
export function formatFiat(
  amountUsd: number,
  currency = 'USD',
  rate = 1.0,
): string {
  const converted = amountUsd * rate;
  const cur = currency?.toUpperCase() ?? 'USD';
  const locale = CURRENCY_LOCALES[cur] ?? 'en-US';

  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: cur === 'JPY' ? 0 : 2,
      maximumFractionDigits: cur === 'JPY' ? 0 : 2,
    }).format(converted);
    return formatted;
  } catch {
    // Fallback for unknown currencies
    const symbol = CURRENCY_SYMBOLS[cur] ?? `${cur} `;
    return `${symbol}${converted.toFixed(cur === 'JPY' ? 0 : 2)}`;
  }
}

/**
 * Get the symbol for a given currency code.
 */
export function getCurrencySymbol(currency = 'USD'): string {
  return CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? '$';
}

/**
 * Auto-scale a hashrate value (assumed TH/s) to the appropriate unit.
 * Works for any magnitude — TH, PH, EH, GH, etc.
 */
export function autoScaleHashrate(
  value: number,
  sourceUnit = 'TH/s',
): { display: string; value: number; unit: string } {
  // Normalize everything to TH/s first
  const normalized = normalizeToTHs(value, sourceUnit);

  if (normalized >= 1_000_000)
    return { display: `${(normalized / 1_000_000).toFixed(2)}`, value: normalized / 1_000_000, unit: 'EH/s' };
  if (normalized >= 1_000)
    return { display: `${(normalized / 1_000).toFixed(2)}`, value: normalized / 1_000, unit: 'PH/s' };
  if (normalized >= 1)
    return { display: `${normalized.toFixed(2)}`, value: normalized, unit: 'TH/s' };
  if (normalized >= 0.001)
    return { display: `${(normalized * 1_000).toFixed(2)}`, value: normalized * 1_000, unit: 'GH/s' };
  return { display: `${(normalized * 1_000_000).toFixed(2)}`, value: normalized * 1_000_000, unit: 'MH/s' };
}

function normalizeToTHs(value: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '');
  if (u.startsWith('eh')) return value * 1_000_000;
  if (u.startsWith('ph')) return value * 1_000;
  if (u.startsWith('th')) return value;
  if (u.startsWith('gh')) return value / 1_000;
  if (u.startsWith('mh')) return value / 1_000_000;
  return value; // assume TH/s
}

export function fmtHashrate(value: number, unit = 'TH/s'): string {
  const scaled = autoScaleHashrate(value, unit);
  return `${scaled.display} ${scaled.unit}`;
}

export function fmtSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return String(sats);
}
