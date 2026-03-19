import React, { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationList } from '../components/NotificationList';
import type { NotificationCategory } from '../types';

type NotificationFilter = NotificationCategory | 'all';

const CATEGORIES: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'hashrate', label: 'HASH' },
  { value: 'block', label: 'BLOCK' },
  { value: 'worker', label: 'WORKER' },
  { value: 'earnings', label: 'EARN' },
  { value: 'system', label: 'SYS' },
];

export const Notifications: React.FC = () => {
  const [category, setCategory] = useState<NotificationFilter>('all');

  const {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
    deleteNotification,
    clearRead,
    clearAll,
  } = useNotifications(category);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>ALERTS</h1>
          {unreadCount > 0 && (
            <span
              style={{
                background: 'var(--color-error)',
                color: '#fff',
                borderRadius: '12px',
                padding: '2px 10px',
                fontSize: '13px',
              }}
            >
              {unreadCount} UNREAD
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn" onClick={markAllRead}>✓ MARK ALL READ</button>
          <button className="btn" onClick={clearRead}>⊘ CLEAR READ</button>
          <button className="btn btn-danger" onClick={clearAll}>✗ CLEAR ALL</button>
          <button className="btn" onClick={refresh}>⟳</button>
        </div>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', animation: 'stagger-in 0.4s ease-out 0.05s both' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            className={`btn ${category === c.value ? 'btn-primary' : ''}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
          LOADING...
        </div>
      ) : error ? (
        <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
          {error}
        </div>
      ) : (
        <NotificationList
          notifications={notifications}
          onMarkRead={markRead}
          onDelete={deleteNotification}
        />
      )}
    </div>
  );
};
