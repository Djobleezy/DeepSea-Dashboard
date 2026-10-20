import { useEffect } from 'react';
import { fetchConfig } from '../api/client';
import { useAppStore } from '../stores/store';

/** Initialize the authoritative wallet once, and resync changes made in another tab. */
export function useWalletScope() {
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const refresh = async () => {
      const id = ++requestId;
      const epoch = useAppStore.getState().walletEpoch;
      try {
        const config = await fetchConfig();
        if (active && id === requestId && epoch === useAppStore.getState().walletEpoch) {
          useAppStore.getState().setWallet(config.wallet);
        }
      } catch {
        if (active && id === requestId && useAppStore.getState().wallet === null) {
          useAppStore.getState().setMetricsError('Could not load configuration. Open Config to retry.');
        }
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'deepsea_wallet') void refresh();
    };
    const retry = () => { if (useAppStore.getState().wallet === null) void refresh(); };
    void refresh();
    window.addEventListener('storage', storage);
    window.addEventListener('deepsea:refresh-metrics', retry);
    return () => {
      active = false;
      window.removeEventListener('storage', storage);
      window.removeEventListener('deepsea:refresh-metrics', retry);
    };
  }, []);
}
