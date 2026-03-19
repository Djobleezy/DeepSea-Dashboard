import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SHORTCUT_MAP: Record<string, string> = {
  '1': '/dashboard',
  '2': '/workers',
  '3': '/earnings',
  '4': '/blocks',
  '5': '/notifications',
};

/**
 * Registers Alt+1..5 keyboard shortcuts for SPA navigation.
 * Alt+1 → Dashboard, Alt+2 → Workers, Alt+3 → Earnings,
 * Alt+4 → Blocks, Alt+5 → Notifications
 */
export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const route = SHORTCUT_MAP[e.key];
      if (route) {
        e.preventDefault();
        navigate(route);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
