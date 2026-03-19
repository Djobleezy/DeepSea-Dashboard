import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../stores/store';
import { ThemeToggle } from './ThemeToggle';
import { AudioPlayer } from './AudioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { EasterEgg } from './EasterEgg';
import { UnderwaterBubbles } from './UnderwaterBubbles';

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
      {/* Underwater ambient bubbles (DeepSea theme only) */}
      <UnderwaterBubbles />

      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          minHeight: '56px',
          gap: '12px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 2px 12px var(--border-glow)',
          flexWrap: 'wrap',
        }}
      >
        <NavLink
          to="/dashboard"
          style={{ textDecoration: 'none', flexShrink: 0 }}
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

        {/* Mobile-scrollable nav */}
        <nav
          style={{
            display: 'flex',
            gap: '2px',
            flex: 1,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            minWidth: 0,
          }}
        >
          <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              style={({ isActive }) => ({
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
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
                    fontSize: '10px',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
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
              flexShrink: 0,
            }}
          />
          {lastUpdated && (
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'none' }}
              className="hide-mobile">
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
          padding: '16px',
          maxWidth: '1400px',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 16px',
          fontSize: '10px',
          color: 'var(--text-dim)',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
        }}
      >
        <span>DEEPSEA DASHBOARD v2.0</span>
        <a
          href="https://x.com/DJObleezy"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--primary)',
            textDecoration: 'none',
            textShadow: '0 0 6px var(--primary-glow)',
            fontFamily: 'var(--font-vt323)',
            fontSize: '13px',
            letterSpacing: '1px',
          }}
        >
          MADE BY @DJO₿LEEZY
        </a>
        <span style={{
          color: sseConnected ? 'var(--color-success)' : 'var(--color-warning)',
          textAlign: 'right',
        }}>
          {sseConnected ? '● LIVE' : '○ CONNECTING'}
        </span>
      </footer>

      {/* Easter egg — keyboard/konami/whale effects */}
      <EasterEgg />
    </div>
  );
};
