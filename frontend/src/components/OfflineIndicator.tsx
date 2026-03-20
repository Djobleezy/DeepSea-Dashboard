import React, { useEffect, useState } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, wasOffline } = useNetworkStatus();
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [visible, setVisible] = useState(false);

  // Show "BACK ONLINE" briefly when connection restores
  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowBackOnline(true);
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        // Give fade-out animation time before removing from DOM
        setTimeout(() => setShowBackOnline(false), 400);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  const showOfflineBanner = !isOnline;
  const show = showOfflineBanner || showBackOnline;

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes slideUpIn {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        .offline-indicator {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 9000;
          background: var(--bg-card, #0d1520);
          border-top: 2px solid var(--primary, #00d4ff);
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          box-shadow: 0 -4px 20px rgba(0, 212, 255, 0.15);
          animation: slideUpIn 0.3s ease forwards;
        }
        .offline-indicator.fading {
          animation: fadeOut 0.4s ease forwards;
        }
        .offline-indicator.back-online {
          border-top-color: var(--color-success, #00ff88);
          box-shadow: 0 -4px 20px rgba(0, 255, 136, 0.2);
          color: var(--color-success, #00ff88);
        }
        .offline-indicator.is-offline {
          color: var(--primary, #00d4ff);
        }
        .offline-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 6px currentColor;
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <div
        className={`offline-indicator ${showBackOnline && isOnline ? 'back-online' : 'is-offline'} ${showBackOnline && !visible ? 'fading' : ''}`}
        role="status"
        aria-live="polite"
      >
        <span className="offline-dot" />
        {isOnline
          ? '✓ BACK ONLINE'
          : '⚡ OFFLINE — showing cached data'}
      </div>
    </>
  );
};
