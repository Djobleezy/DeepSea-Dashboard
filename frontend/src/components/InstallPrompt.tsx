import React, { useEffect, useState } from 'react';

const DISMISS_KEY = 'deepsea_install_dismissed';
const DISMISS_DAYS = 30;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if dismissed recently
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
      if (daysSince < DISMISS_DAYS) return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    // Always clear the deferred prompt — per spec it can only be used once,
    // regardless of whether the user accepts or dismisses.
    const prompt = deferredPrompt;
    setDeferredPrompt(null);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    } else {
      // User dismissed the browser prompt — also hide our custom UI
      // and record the dismiss time so we don't nag immediately
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShow(false);
  };

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes installSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .install-prompt {
          position: fixed;
          bottom: 44px; /* above OfflineIndicator height */
          left: 0;
          right: 0;
          z-index: 8900;
          background: var(--bg-card, #0d1520);
          border-top: 1px solid var(--border, rgba(0,212,255,0.2));
          border-bottom: 1px solid var(--border, rgba(0,212,255,0.2));
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 13px;
          letter-spacing: 1px;
          color: var(--text, #e0e0e0);
          box-shadow: 0 -2px 16px rgba(0, 212, 255, 0.08);
          animation: installSlideUp 0.35s ease forwards;
        }
        .install-prompt-text {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .install-prompt-btn {
          background: var(--primary, #00d4ff);
          color: var(--bg, #0a0e14);
          border: none;
          border-radius: 3px;
          padding: 5px 14px;
          font-family: var(--font-mono, 'Share Tech Mono', monospace);
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }
        .install-prompt-btn:hover {
          opacity: 0.85;
        }
        .install-prompt-close {
          background: none;
          border: none;
          color: var(--text-dim, #666);
          font-size: 16px;
          cursor: pointer;
          padding: 4px 6px;
          line-height: 1;
          flex-shrink: 0;
          transition: color 0.15s;
        }
        .install-prompt-close:hover {
          color: var(--text, #e0e0e0);
        }
      `}</style>
      <div className="install-prompt" role="complementary" aria-label="Install app prompt">
        <span style={{ fontSize: '18px' }}>📱</span>
        <span className="install-prompt-text">Install DeepSea Dashboard</span>
        <button className="install-prompt-btn" onClick={handleInstall}>
          Install
        </button>
        <button
          className="install-prompt-close"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
        >
          ✕
        </button>
      </div>
    </>
  );
};
