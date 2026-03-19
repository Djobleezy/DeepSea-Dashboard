/**
 * useCurrency — fetches the configured currency from /api/config and the
 * exchange rate from /api/exchange-rates, then provides a formatFiat() helper
 * that converts USD amounts to the user's chosen currency.
 *
 * Re-fetches whenever the config changes (e.g. after Boot/config page save).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConfig } from '../api/client';
import { formatFiat as _formatFiat } from '../utils/format';

const RATES_ENDPOINT = '/api/exchange-rates';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — matches backend cache TTL

interface CurrencyState {
  currency: string;
  rate: number;
  loaded: boolean;
}

const DEFAULT_STATE: CurrencyState = {
  currency: 'USD',
  rate: 1.0,
  loaded: false,
};

// Module-level cache so sibling components don't each hit the API independently
let _cached: CurrencyState = { ...DEFAULT_STATE };
let _cacheExpiry = 0;
const _listeners: Set<() => void> = new Set();

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

async function refreshCurrencyCache(): Promise<void> {
  try {
    const [config, ratesResp] = await Promise.all([
      fetchConfig(),
      fetch(RATES_ENDPOINT).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    const currency = (config.currency ?? 'USD').toUpperCase();
    const rates: Record<string, number> = ratesResp?.rates ?? {};
    const rate = currency === 'USD' ? 1.0 : (rates[currency] ?? 1.0);

    _cached = { currency, rate, loaded: true };
    _cacheExpiry = Date.now() + REFRESH_INTERVAL_MS;
    notifyListeners();
  } catch {
    // Degrade gracefully — keep whatever we had
    _cached = { ..._cached, loaded: true };
    notifyListeners();
  }
}

/**
 * Hook: returns { currency, rate, formatFiat, loaded }
 *
 * formatFiat(amountUsd) converts a USD amount to the display currency
 * using Intl.NumberFormat for locale-aware output.
 */
export function useCurrency() {
  const [state, setState] = useState<CurrencyState>(_cached);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const update = () => {
      if (mounted.current) setState({ ..._cached });
    };

    _listeners.add(update);

    // Fetch if cache is stale or not yet loaded
    if (!_cached.loaded || Date.now() > _cacheExpiry) {
      refreshCurrencyCache();
    }

    return () => {
      mounted.current = false;
      _listeners.delete(update);
    };
  }, []);

  const formatFiat = useCallback(
    (amountUsd: number) => _formatFiat(amountUsd, state.currency, state.rate),
    [state.currency, state.rate],
  );

  // Prefix sign for positive/negative amounts (e.g. profit)
  const formatFiatSigned = useCallback(
    (amountUsd: number) => {
      const str = _formatFiat(Math.abs(amountUsd), state.currency, state.rate);
      return amountUsd >= 0 ? `+${str}` : `-${str}`;
    },
    [state.currency, state.rate],
  );

  return {
    currency: state.currency,
    rate: state.rate,
    loaded: state.loaded,
    formatFiat,
    formatFiatSigned,
  };
}

/**
 * Imperatively refresh the currency cache (call after config save).
 */
export function invalidateCurrencyCache(): void {
  _cacheExpiry = 0;
  refreshCurrencyCache();
}
