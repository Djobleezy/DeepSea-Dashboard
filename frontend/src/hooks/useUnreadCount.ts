import { useEffect } from 'react';
import { fetchUnreadCount } from '../api/client';
import { useAppStore } from '../stores/store';

/** Global unread count is independent of the current page and its category filter. */
export function useUnreadCount(pollMs = 30000) {
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const refresh = async () => {
      const id = ++requestId;
      try {
        const result = await fetchUnreadCount();
        if (active && id === requestId) useAppStore.getState().setUnreadCount(result.unread_count);
      } catch { /* Keep the last known count when the network is unavailable. */ }
    };
    void refresh();
    const timer = setInterval(refresh, pollMs);
    window.addEventListener('deepsea:notifications-changed', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('deepsea:notifications-changed', refresh);
    };
  }, [pollMs]);
}
