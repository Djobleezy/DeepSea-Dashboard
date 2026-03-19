import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../stores/store';
import { ThemeToggle } from './ThemeToggle';
import { AudioPlayer } from './AudioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { EasterEgg } from './EasterEgg';

const NAV_LINKS = [
  { to: '/dashboard', label: '◈ DASHBOARD' },
  { to: '/workers', label: '⚙ WORKERS' },
  { to: '/blocks', label: '⛏ BLOCKS' },
  { to: '/earnings', label: '₿ EARNINGS' },
  { to: '/notifications', label: '🔔 ALERTS' },
  { to: '/config', label: '⚡ CONFIG' },
];

interface Props {
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({ children }) => {
  useKeyboardShortcuts(); // Alt+1..5 navigation shortcuts
  const sseConnected = useAppStore((s) => s.sseConnected);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const lastUpdated = useAppStore((s) => s.lastUpdated);

  const fmtTime = (ts: number | null) => {
    if (!ts) return '---';
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
      }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: '56px',
          gap: '24px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 2px 12px var(--border-glow)',
        }}
      >
        <NavLink
          to="/dashboard"
          style={{ textDecoration: 'none' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-vt323)',
              fontSize: '28px',
              color: 'var(--primary)',
              textShadow: '0 0 10px var(--primary-glow)',
              letterSpacing: '3px',
            }}
          >
            ⚓ DEEPSEA
          </span>
        </NavLink>

        <nav style={{ display: 'flex', gap: '4px', flex: 1 }}>
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              style={({ isActive }) => ({
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: isActive ? 'var(--primary)' : 'var(--text-dim)',
                textDecoration: 'none',
                padding: '6px 10px',
                borderRadius: '4px',
                background: isActive ? 'var(--bg-hover)' : 'transparent',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                textShadow: isActive ? '0 0 6px var(--primary-glow)' : 'none',
                position: 'relative',
              })}
            >
              {link.label}
              {link.to === '/notifications' && unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    background: 'var(--color-error)',
                    color: '#fff',
                    fontSize: '9px',
                    borderRadius: '8px',
                    padding: '0 4px',
                    minWidth: '14px',
                    textAlign: 'center',
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* SSE status indicator */}
          <span
            title={sseConnected ? 'Live feed connected' : 'Connecting...'}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: sseConnected ? 'var(--color-success)' : 'var(--color-warning)',
              boxShadow: sseConnected ? '0 0 8px var(--color-success)' : 'none',
              display: 'inline-block',
            }}
          />
          {lastUpdated && (
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
              {fmtTime(lastUpdated)}
            </span>
          )}
          <AudioPlayer />
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          padding: '24px',
          maxWidth: '1400px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {children}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 24px',
          fontSize: '10px',
          color: 'var(--text-dim)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>DEEPSEA DASHBOARD v2.0 — OCEAN.XYZ MINING MONITOR</span>
        <span style={{ color: sseConnected ? 'var(--color-success)' : 'var(--color-warning)' }}>
          {sseConnected ? '● LIVE' : '○ CONNECTING'}
        </span>
      </footer>

      {/* Easter egg — keyboard/konami/whale effects */}
      <EasterEgg />
    </div>
  );
};
