import { useState, useEffect, useCallback } from 'react';
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

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(category);
      setNotifications(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [category, setNotifications]);

  useEffect(() => {
    load();
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const markRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark notification read');
    }
  };

  const markAllReadFn = async () => {
    try {
      await markAllRead();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all notifications read');
    }
  };

  const deleteFn = async (id: string) => {
    try {
      await deleteNotification(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete notification');
    }
  };

  const clearRead = async () => {
    try {
      await clearReadNotifications();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear read notifications');
    }
  };

  const clearAll = async () => {
    try {
      await clearAllNotifications();
      await load();
    } catch (e) {
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
