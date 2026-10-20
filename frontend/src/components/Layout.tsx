import React, { useState, useCallback, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../stores/store';
import { ThemeToggle } from './ThemeToggle';
import { AudioPlayer } from './AudioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useRetroRefresh } from '../hooks/useRetroRefresh';
import { useThemeColor } from '../hooks/useThemeColor';
import { EasterEgg } from './EasterEgg';
import { UnderwaterBubbles } from './UnderwaterBubbles';
import { MatrixRain } from './MatrixRain';
import { OfflineIndicator } from './OfflineIndicator';
import { UpdatePrompt } from './UpdatePrompt';
import { InstallPrompt } from './InstallPrompt';

const NAV_LINKS = [
  { to: '/dashboard', icon: '◈', label: 'Dashboard' },
  { to: '/workers', icon: '⛭', label: 'Workers' },
  { to: '/blocks', icon: '⛏', label: 'Blocks' },
  { to: '/earnings', icon: '₿', label: 'Earnings' },
  { to: '/notifications', icon: '⚑', label: 'Alerts' },
  { to: '/config', icon: '⚙', label: 'Config' },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useKeyboardShortcuts();
  useRetroRefresh();
  useThemeColor();
  const sseConnected = useAppStore((s) => s.sseConnected);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const theme = useAppStore((s) => s.theme);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const onResize = () => { if (!query.matches) setMenuOpen(false); };
    query.addEventListener('change', onResize);
    return () => query.removeEventListener('change', onResize);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const drawer = drawerRef.current;
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ) ?? []);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
      if (event.key !== 'Tab') return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, closeMenu]);

  const links = NAV_LINKS.map((link) => (
    <NavLink key={link.to} to={link.to} aria-label={link.to === '/notifications' && unreadCount > 0 ? `${link.label}, ${unreadCount} unread` : undefined} className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
      <span aria-hidden="true">{link.icon}</span> {link.label}
      {link.to === '/notifications' && unreadCount > 0 && (
        <span className="unread-badge" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </NavLink>
  ));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {theme === 'deepsea' && <UnderwaterBubbles />}
      {theme === 'matrix' && <MatrixRain />}
      {menuOpen && (
        <>
          <div className="nav-overlay" onClick={closeMenu} aria-hidden="true" />
          <div ref={drawerRef} id="mobile-navigation" className="nav-drawer" role="dialog" aria-modal="true" aria-labelledby="navigation-title">
            <div className="drawer-heading">
              <span className="app-brand" id="navigation-title">⚓ DEEPSEA</span>
              <button className="btn icon-button" onClick={closeMenu} aria-label="Close menu">✕</button>
            </div>
            <nav aria-label="Mobile navigation">{links}</nav>
            <div className="drawer-controls">
              <span className="connection-label">{sseConnected ? '● Live connection' : '○ Reconnecting'}</span>
              <AudioPlayer />
            </div>
          </div>
        </>
      )}
      <header className="app-header">
        <button ref={triggerRef} className="nav-hamburger btn icon-button" onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle menu" aria-expanded={menuOpen} aria-controls={menuOpen ? 'mobile-navigation' : undefined}>☰</button>
        <NavLink to="/dashboard" className="app-brand" aria-label="DeepSea dashboard">⚓ DEEPSEA</NavLink>
        <nav className="nav-desktop" aria-label="Main navigation">{links}</nav>
        <div className="header-controls">
          <span className="connection-dot nav-desktop" role="img" title={sseConnected ? 'Live connection' : 'Reconnecting'} aria-label={sseConnected ? 'Live connection' : 'Reconnecting'}
            style={{ background: sseConnected ? 'var(--color-success)' : 'var(--color-warning)' }} />
          <span className="nav-desktop"><AudioPlayer /></span>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
      <footer className="app-footer">
        <span>DeepSea Dashboard v2.0.4</span>
        <a href="https://x.com/DJObleezy" target="_blank" rel="noopener noreferrer">Made by @DJO₿LEEZY</a>
        <span className="connection-label">{sseConnected ? '● Live connection' : '○ Reconnecting'}</span>
      </footer>
      <EasterEgg />
      <UpdatePrompt />
      <InstallPrompt />
      <OfflineIndicator />
    </div>
  );
};
