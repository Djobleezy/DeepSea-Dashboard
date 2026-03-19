import React from 'react';
import type { Notification } from '../types';

interface Props {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}

const LEVEL_ICONS: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '🔴',
};

const CAT_LABELS: Record<string, string> = {
  hashrate: 'HASH',
  block: 'BLOCK',
  worker: 'WORKER',
  earnings: 'EARN',
  system: 'SYS',
};

export const NotificationList: React.FC<Props> = ({
  notifications,
  onMarkRead,
  onDelete,
}) => {
  if (notifications.length === 0) {
    return (
      <div
        className="text-center"
        style={{ color: 'var(--text-dim)', padding: '40px', fontSize: '14px' }}
      >
        [ NO NOTIFICATIONS ]
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`card notif-${n.level}`}
          style={{
            opacity: n.read ? 0.6 : 1,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '16px', flexShrink: 0 }}>
            {LEVEL_ICONS[n.level] || 'ℹ️'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
              <span
                className="badge"
                style={{
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderColor: 'var(--text-dim)',
                  color: 'var(--text-dim)',
                }}
              >
                {CAT_LABELS[n.category] || n.category.toUpperCase()}
              </span>
              {n.is_block && (
                <span
                  className="badge"
                  style={{ fontSize: '10px', padding: '1px 6px', borderColor: 'var(--color-success)', color: 'var(--color-success)' }}
                >
                  BLOCK
                </span>
              )}
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                {new Date(n.timestamp).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: n.read ? 'var(--text-dim)' : 'var(--text)' }}>
              {n.message}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            {!n.read && (
              <button
                className="btn"
                style={{ fontSize: '10px', padding: '2px 6px' }}
                onClick={() => onMarkRead(n.id)}
              >
                READ
              </button>
            )}
            {!n.is_block && (
              <button
                className="btn btn-danger"
                style={{ fontSize: '10px', padding: '2px 6px' }}
                onClick={() => onDelete(n.id)}
              >
                DEL
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
