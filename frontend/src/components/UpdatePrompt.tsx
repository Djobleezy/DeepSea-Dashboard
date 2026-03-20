import React, { useEffect, useState } from 'react';

export const UpdatePrompt: React.FC = () => {
  const [show, setShow] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handleUpdateAvailable = (e: Event) => {
      const customEvent = e as CustomEvent<{ registration: ServiceWorkerRegistration }>;
      if (customEvent.detail?.registration) {
        setRegistration(customEvent.detail.registration);
      }
      setShow(true);
    };

    window.addEventListener('sw-update-available', handleUpdateAvailable);
    return () => window.removeEventListener('sw-update-available', handleUpdateAvailable);
  }, []);

  const handleRefresh = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // controllerchange event in main.tsx will trigger reload
    // But also set a fallback in case no controllerchange fires
    window.location.reload();
  };

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes slideDownIn {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .update-prompt {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9100;
          background: var(--bg-card, #0d1520);
          border-bottom: 2px solid var(--primary, #00d4ff);
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 13px;
          letter-spacing: 1px;
          color: var(--text, #e0e0e0);
          box-shadow: 0 4px 20px rgba(0, 212, 255, 0.15);
          animation: slideDownIn 0.3s ease forwards;
        }
        .update-prompt-btn {
          background: var(--primary, #00d4ff);
          color: var(--bg, #0a0e14);
          border: none;
          border-radius: 3px;
          padding: 4px 12px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          cursor: pointer;
          font-weight: 600;
          transition: opacity 0.15s;
        }
        .update-prompt-btn:hover {
          opacity: 0.85;
        }
        .update-prompt-dismiss {
          background: none;
          border: 1px solid var(--border, rgba(0,212,255,0.2));
          color: var(--text-dim, #666);
          border-radius: 3px;
          padding: 4px 8px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 11px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .update-prompt-dismiss:hover {
          border-color: var(--primary, #00d4ff);
          color: var(--text, #e0e0e0);
        }
      `}</style>
      <div className="update-prompt" role="alert">
        <span>🔄 Update available</span>
        <button className="update-prompt-btn" onClick={handleRefresh}>
          Refresh
        </button>
        <button className="update-prompt-dismiss" onClick={() => setShow(false)}>
          ✕
        </button>
      </div>
    </>
  );
};
