import React, { useState, useCallback, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../stores/store';
import { ThemeToggle } from './ThemeToggle';
import { AudioPlayer } from './AudioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useRetroRefresh } from '../hooks/useRetroRefresh';
import { EasterEgg } from './EasterEgg';
import { UnderwaterBubbles } from './UnderwaterBubbles';
import { MatrixRain } from './MatrixRain';

const NAV_LINKS = [
  { to: '/dashboard', icon: '◈', label: 'DASHBOARD' },
  { to: '/workers', icon: '⛭', label: 'WORKERS' },
  { to: '/blocks', icon: '⛏', label: 'BLOCKS' },
  { to: '/earnings', icon: '₿', label: 'EARNINGS' },
  { to: '/notifications', icon: '⚑', label: 'ALERTS' },
  { to: '/config', icon: '⚙', label: 'CONFIG' },
];

interface Props {
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({ children }) => {
  useKeyboardShortcuts();
  useRetroRefresh();
  const sseConnected = useAppStore((s) => s.sseConnected);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);
  const theme = useAppStore((s) => s.theme);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {theme === 'deepsea' && <UnderwaterBubbles />}
      {theme === 'matrix' && <MatrixRain />}

      {/* CSS for responsive nav */}
      <style>{`
        .nav-desktop { display: flex; }
        .nav-hamburger { display: none; }
        .nav-drawer { display: none; }
        .nav-overlay { display: none; }

        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-hamburger { display: flex !important; }
          .nav-drawer {
            display: flex !important;
            position: fixed;
            top: 0;
            left: 0;
            width: 260px;
            height: 100vh;
            background: var(--bg-card);
            border-right: 1px solid var(--border);
            flex-direction: column;
            padding: 16px 0;
            z-index: 1001;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            box-shadow: 4px 0 20px rgba(0,0,0,0.5);
          }
          .nav-drawer.open { transform: translateX(0); }
          .nav-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 1000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s;
          }
          .nav-overlay.open {
            opacity: 1;
            pointer-events: auto;
          }
        }
        nav::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Mobile overlay */}
      <div
        className={`nav-overlay ${menuOpen ? 'open' : ''}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Mobile drawer */}
      <div className={`nav-drawer ${menuOpen ? 'open' : ''}`}>
        <div style={{
          padding: '8px 20px 20px',
          borderBottom: '1px solid var(--border)',
          marginBottom: '8px',
        }}>
          <span style={{
            fontFamily: 'var(--font-vt323)',
            fontSize: '28px',
            color: 'var(--primary)',
            textShadow: '0 0 10px var(--primary-glow)',
            letterSpacing: '3px',
          }}>
            ⚓ DEEPSEA
          </span>
        </div>
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            style={({ isActive }) => ({
              fontFamily: 'var(--font-mono)',
              fontSize: '15px',
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: isActive ? 'var(--primary)' : 'var(--text-dim)',
              textDecoration: 'none',
              padding: '12px 20px',
              background: isActive ? 'var(--bg-hover)' : 'transparent',
              borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
              textShadow: isActive ? '0 0 6px var(--primary-glow)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              position: 'relative',
            })}
          >
            <span style={{ fontSize: '18px', width: '24px', textAlign: 'center' }}>{link.icon}</span>
            {link.label}
            {link.to === '/notifications' && unreadCount > 0 && (
              <span style={{
                background: 'var(--color-error)',
                color: '#fff',
                fontSize: '10px',
                borderRadius: '8px',
                padding: '0 5px',
                marginLeft: 'auto',
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: sseConnected ? 'var(--color-success)' : 'var(--color-warning)',
              boxShadow: sseConnected ? '0 0 8px var(--color-success)' : 'none',
            }} />
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              {sseConnected ? 'LIVE FEED CONNECTED' : 'CONNECTING...'}
            </span>
          </div>
          <AudioPlayer />
        </div>
      </div>

      {/* Header */}
      <header style={{
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
      }}>
        {/* Hamburger — mobile only */}
        <button
          className="nav-hamburger"
          onClick={toggleMenu}
          aria-label="Toggle menu"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            flexDirection: 'column',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          <span style={{
            width: '20px', height: '2px', background: 'var(--primary)',
            borderRadius: '1px', transition: 'transform 0.2s',
            transform: menuOpen ? 'rotate(45deg) translateY(6px)' : 'none',
          }} />
          <span style={{
            width: '20px', height: '2px', background: 'var(--primary)',
            borderRadius: '1px', transition: 'opacity 0.2s',
            opacity: menuOpen ? 0 : 1,
          }} />
          <span style={{
            width: '20px', height: '2px', background: 'var(--primary)',
            borderRadius: '1px', transition: 'transform 0.2s',
            transform: menuOpen ? 'rotate(-45deg) translateY(-6px)' : 'none',
          }} />
        </button>

        <NavLink to="/dashboard" style={{ textDecoration: 'none', flexShrink: 0 }}>
          <span style={{
            fontFamily: 'var(--font-vt323)',
            fontSize: '28px',
            color: 'var(--primary)',
            textShadow: '0 0 10px var(--primary-glow)',
            letterSpacing: '3px',
          }}>
            ⚓ DEEPSEA
          </span>
        </NavLink>

        {/* Desktop nav */}
        <nav className="nav-desktop" style={{
          gap: '2px',
          flex: 1,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          minWidth: 0,
        }}>
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
              {link.icon} {link.label}
              {link.to === '/notifications' && unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '2px', right: '2px',
                  background: 'var(--color-error)', color: '#fff',
                  fontSize: '10px', borderRadius: '8px',
                  padding: '0 4px', minWidth: '14px', textAlign: 'center',
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: 'auto' }}>
          <span
            title={sseConnected ? 'Live feed connected' : 'Connecting...'}
            style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: sseConnected ? 'var(--color-success)' : 'var(--color-warning)',
              boxShadow: sseConnected ? '0 0 8px var(--color-success)' : 'none',
              display: 'inline-block', flexShrink: 0,
            }}
          />
          <span className="nav-desktop" style={{ display: 'flex' }}><AudioPlayer /></span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '16px',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {children}
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '8px 16px',
        fontSize: '10px',
        color: 'var(--text-dim)',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
      }}>
        <span>DEEPSEA DASHBOARD v2.0.2</span>
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

      <EasterEgg />
    </div>
  );
};
