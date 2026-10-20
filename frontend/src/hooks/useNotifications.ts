import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchNotifications,
  markNotificationRead,
  markAllRead,
  deleteNotification,
  clearReadNotifications,
  clearAllNotifications,
} from '../api/client';
import { useAppStore } from '../stores/store';

export function useNotifications(category = 'all', pollMs = 30000) {
  const setNotifications = useAppStore((s) => s.setNotifications);
  const notifications = useAppStore((s) => s.notifications);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const data = await fetchNotifications(category);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setNotifications(data);
      setError(null);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [category, setNotifications]);

  const refreshUnreadCount = () => {
    window.dispatchEvent(new Event('deepsea:notifications-changed'));
  };

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    load();
    const timer = setInterval(load, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load, pollMs]);

  const markRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      refreshUnreadCount();
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to mark notification read');
    }
  };

  const markAllReadFn = async () => {
    try {
      await markAllRead();
      refreshUnreadCount();
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to mark all notifications read');
    }
  };

  const deleteFn = async (id: string) => {
    try {
      await deleteNotification(id);
      refreshUnreadCount();
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to delete notification');
    }
  };

  const clearRead = async () => {
    try {
      await clearReadNotifications();
      refreshUnreadCount();
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to clear read notifications');
    }
  };

  const clearAll = async () => {
    try {
      await clearAllNotifications();
      refreshUnreadCount();
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to clear notifications');
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh: load,
    markRead,
    markAllRead: markAllReadFn,
    deleteNotification: deleteFn,
    clearRead,
    clearAll,
  };
}
