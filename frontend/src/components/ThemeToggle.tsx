import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { THEMES } from '../theme/themes';

export const ThemeToggle: React.FC = () => {
  const { theme, cycleTheme } = useTheme();
  const def = THEMES[theme];

  return (
    <button
      onClick={cycleTheme}
      className="btn"
      title={`Current theme: ${def.label}. Click to cycle.`}
      style={{ fontSize: '13px', padding: '4px 10px' }}
    >
      {def.label}
    </button>
  );
};
