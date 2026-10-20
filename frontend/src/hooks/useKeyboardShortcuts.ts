import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SHORTCUT_MAP: Record<string, string> = {
  '1': '/dashboard',
  '2': '/workers',
  '3': '/earnings',
  '4': '/blocks',
  '5': '/notifications',
};

// Reset only this browser's cached display state. Saved server settings,
// notifications, and wallet-scoped database history are deliberately retained.
export function resetBrowserCache(): void {
  const keys = Object.keys(localStorage).filter((key) =>
    key === 'deepsea_payout_history' ||
    key.startsWith('deepsea_payout_history:') ||
    key.startsWith('blockAnnotations') ||
    key === 'liveBlockTimer_lastBlockEpoch' ||
    key === 'workerPowerOverrides' ||
    key === 'workerPowerCost' ||
    key === 'fleetPowerCostPerKwh',
  );
  for (const key of keys) localStorage.removeItem(key);
  sessionStorage.removeItem('deepsea_boot_shown');
  window.location.reload();
}

/**
 * Registers Alt+1..5 keyboard shortcuts for SPA navigation.
 * Alt+1 → Dashboard, Alt+2 → Workers, Alt+3 → Earnings,
 * Alt+4 → Blocks, Alt+5 → Notifications
 *
 * Alt+W → Reset browser cache (with confirmation dialog)
 */
export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;

      // Navigation shortcuts
      const route = SHORTCUT_MAP[e.key];
      if (route) {
        e.preventDefault();
        navigate(route);
        return;
      }

      // Alt+W — reset browser cache
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        const confirmed = window.confirm(
          'RESET BROWSER CACHE\n\n' +
          'Clear cached payout display, block annotations, and legacy local power settings?\n\n' +
          'Your wallet, saved settings, notifications, and server history will be kept. ' +
          'The page will reload and fetch current data.'
        );
        if (confirmed) {
          resetBrowserCache();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
