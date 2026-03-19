import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAllNotifications } from '../api/client';

const SHORTCUT_MAP: Record<string, string> = {
  '1': '/dashboard',
  '2': '/workers',
  '3': '/earnings',
  '4': '/blocks',
  '5': '/notifications',
};

// LocalStorage keys cleared on wallet reset
const WALLET_RESET_KEYS = [
  'deepsea_payout_history',  // usePayoutTracking
  'blockAnnotations',         // useBlockAnnotations
  'workerPowerOverrides',     // Workers page
  'workerPowerCost',          // Workers page
  'deepsea_boot_shown',       // boot sequence flag
];

function showSystemResetToast(): void {
  const existing = document.getElementById('system-reset-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'system-reset-toast';
  toast.textContent = '⚠ SYSTEM RESET — CLEARING ALL DATA...';
  Object.assign(toast.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'var(--color-error, #ff4444)',
    color: '#000',
    fontFamily: 'var(--font-vt323, monospace)',
    fontSize: '28px',
    letterSpacing: '3px',
    padding: '20px 36px',
    zIndex: '9999',
    boxShadow: '0 0 30px var(--color-error, #ff4444)',
    border: '2px solid #fff',
    textAlign: 'center',
  });

  // Inject keyframes once
  if (!document.getElementById('system-reset-toast-style')) {
    const style = document.createElement('style');
    style.id = 'system-reset-toast-style';
    style.textContent = `
      @keyframes resetPulse {
        0% { opacity: 1; box-shadow: 0 0 30px #ff4444; }
        50% { opacity: 0.7; box-shadow: 0 0 60px #ff4444; }
        100% { opacity: 1; box-shadow: 0 0 30px #ff4444; }
      }
    `;
    document.head.appendChild(style);
  }
  toast.style.animation = 'resetPulse 0.4s ease-in-out infinite';

  document.body.appendChild(toast);
}

async function executeWalletReset(): Promise<void> {
  // Show toast
  showSystemResetToast();

  // Clear localStorage keys
  WALLET_RESET_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  });

  // Clear notifications via API (fire-and-forget, don't block reload)
  try {
    await clearAllNotifications();
  } catch {
    // Ignore API errors during reset — we reload anyway
  }

  // Short delay so the toast is visible before reload
  await new Promise((resolve) => setTimeout(resolve, 1500));
  window.location.reload();
}

/**
 * Registers Alt+1..5 keyboard shortcuts for SPA navigation.
 * Alt+1 → Dashboard, Alt+2 → Workers, Alt+3 → Earnings,
 * Alt+4 → Blocks, Alt+5 → Notifications
 *
 * Alt+W → Wallet reset (with confirmation dialog)
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

      // Alt+W — wallet reset
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        const confirmed = window.confirm(
          '⚠ WALLET RESET\n\n' +
          'This will clear ALL local dashboard data:\n' +
          '• Payout history\n' +
          '• Block annotations\n' +
          '• Worker power overrides\n' +
          '• Chart data\n' +
          '• All notifications\n\n' +
          'The page will reload after reset.\n\n' +
          'Are you sure?'
        );
        if (confirmed) {
          void executeWalletReset();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
