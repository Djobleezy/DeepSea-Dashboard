import React from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, apiStatus } = useNetworkStatus();
  const unavailable = !isOnline || apiStatus !== null;

  // Browser connectivity alone does not prove that the backend recovered.
  // Remove the notice only once its outstanding API failures have cleared.
  if (!unavailable) return null;

  let message = 'Dashboard data is unavailable. Retrying the connection.';
  if (!isOnline) {
    message = apiStatus?.status === 'stale'
      ? 'You are offline. Showing saved data; updates are paused.'
      : 'You are offline. Data updates are paused.';
  } else if (apiStatus?.status === 'unavailable') {
    message = 'Dashboard data is unavailable. Retrying the connection.';
  } else if (apiStatus?.status === 'stale') {
    const lastUpdate = apiStatus.updatedAt
      ? ` Last update: ${new Date(apiStatus.updatedAt * 1000).toLocaleTimeString()}.`
      : '';
    message = `Showing older data.${lastUpdate} Waiting for current data.`;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9000,
        padding: '12px 16px', background: 'var(--bg-card)',
        borderTop: '2px solid var(--color-warning)',
        color: 'var(--text)', textAlign: 'center', fontSize: '14px', lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
};
