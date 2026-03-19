import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { BootSequence } from './components/BootSequence';
import { Dashboard } from './pages/Dashboard';
import { Workers } from './pages/Workers';
import { Blocks } from './pages/Blocks';
import { Earnings } from './pages/Earnings';
import { Notifications } from './pages/Notifications';
import { Boot } from './pages/Boot';
import { useSSE } from './hooks/useSSE';
import { useMetrics } from './hooks/useMetrics';
import { useTheme } from './hooks/useTheme';
import { applyTheme } from './theme/themes';
import { useAppStore } from './stores/store';

const BOOT_SHOWN_KEY = 'deepsea_boot_shown';

function AppInner() {
  useSSE();
  useMetrics();
  useTheme();

  const [showBoot, setShowBoot] = useState(() => {
    return !sessionStorage.getItem(BOOT_SHOWN_KEY);
  });

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem(BOOT_SHOWN_KEY, '1');
    setShowBoot(false);
  }, []);

  if (showBoot) {
    return <BootSequence onComplete={handleBootComplete} />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workers" element={<Workers />} />
        <Route path="/blocks" element={<Blocks />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/config" element={<Boot />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
