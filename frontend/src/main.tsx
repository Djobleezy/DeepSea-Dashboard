import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme/global.css'
import { postClientError } from './api/client'

// ---------------------------------------------------------------------------
// Global error tracking
// ---------------------------------------------------------------------------

function reportError(payload: {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  url?: string;
}) {
  // Structured console log regardless of debug mode
  console.error('[DeepSea]', JSON.stringify({
    type: 'global_error',
    ...payload,
    ts: new Date().toISOString(),
  }));
  // Best-effort POST to backend (fire-and-forget)
  postClientError(payload);
}

window.onerror = (message, source, lineno, colno, error) => {
  reportError({
    message: String(message),
    source,
    lineno: lineno ?? undefined,
    colno: colno ?? undefined,
    stack: error?.stack,
    url: window.location.href,
  });
  return false; // don't suppress default browser error handling
};

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : String(reason ?? 'Unhandled promise rejection');
  reportError({
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
    url: window.location.href,
  });
});

// ---------------------------------------------------------------------------
// Debug mode — Alt+D toggle
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'd') {
    const current = localStorage.getItem('debugMode') === 'true';
    const next = !current;
    localStorage.setItem('debugMode', String(next));

    // Show a subtle toast
    const el = document.createElement('div');
    el.textContent = `Debug ${next ? 'ON' : 'OFF'}`;
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(13, 26, 36, 0.92)',
      color: next ? '#00ff9d' : '#a0d4f5',
      border: `1px solid ${next ? '#00ff9d' : '#0055aa'}`,
      borderRadius: '4px',
      padding: '8px 20px',
      fontSize: '12px',
      fontFamily: 'var(--font-mono, monospace)',
      letterSpacing: '2px',
      zIndex: '9999',
      opacity: '0',
      transition: 'opacity 0.2s',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 2000);

    if (next) {
      console.debug('[DeepSea] Debug mode enabled');
    }
  }
});

// ---------------------------------------------------------------------------
// Service Worker — full lifecycle with update detection
// ---------------------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('[SW] Registered:', registration.scope);

      // Listen for a new SW found during update checks
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          // New SW installed and waiting — notify the app so it can prompt user
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[SW] Update available — new service worker waiting');
            window.dispatchEvent(new CustomEvent('sw-update-available', {
              detail: {
                /**
                 * Call this from the app's update prompt to activate the new SW.
                 * The SW will call skipWaiting() → triggers controllerchange →
                 * we reload the page with the latest assets.
                 */
                acceptUpdate: () => {
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                },
              },
            }));
          }
        });
      });

      // When the SW controller changes (new SW took over), reload for fresh assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[SW] Controller changed — reloading for fresh assets');
        window.location.reload();
      });

    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
