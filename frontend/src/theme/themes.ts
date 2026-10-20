import { Theme } from '../types';

export interface ThemeDefinition {
  id: Theme;
  label: string;
  primary: string;
  primaryDim: string;
  primaryGlow: string;
  bg: string;
  bgCard: string;
  bgHover: string;
  text: string;
  textDim: string;
  border: string;
  borderGlow: string;
  scanlineColor: string;
}

export const THEMES: Record<Theme, ThemeDefinition> = {
  deepsea: {
    id: 'deepsea',
    label: '🌊 DeepSea',
    primary: '#39bdf8',
    primaryDim: '#005580',
    primaryGlow: 'rgba(57, 189, 248, 0.18)',
    bg: '#0a0f14',
    bgCard: '#0d1a24',
    bgHover: '#112233',
    text: '#a0d4f5',
    textDim: '#93adbf',
    border: '#0055aa',
    borderGlow: 'rgba(57, 189, 248, 0.12)',
    scanlineColor: 'rgba(0, 136, 204, 0.012)',
  },
  bitcoin: {
    id: 'bitcoin',
    label: '₿ Bitcoin',
    primary: '#f2a900',
    primaryDim: '#765000',
    primaryGlow: 'rgba(242, 169, 0, 0.18)',
    bg: '#0a0800',
    bgCard: '#1a1200',
    bgHover: '#221800',
    text: '#f5d680',
    textDim: '#baa56f',
    border: '#6a4d00',
    borderGlow: 'rgba(242, 169, 0, 0.12)',
    scanlineColor: 'rgba(242, 169, 0, 0.012)',
  },
  matrix: {
    id: 'matrix',
    label: '🟩 Matrix',
    primary: '#39ff14',
    primaryDim: '#206b15',
    primaryGlow: 'rgba(57, 255, 20, 0.16)',
    bg: '#000a00',
    bgCard: '#001400',
    bgHover: '#002200',
    text: '#88ff66',
    textDim: '#80ae74',
    border: '#005500',
    borderGlow: 'rgba(57, 255, 20, 0.10)',
    scanlineColor: 'rgba(57, 255, 20, 0.01)',
  },
};

export function applyTheme(theme: Theme): void {
  const t = THEMES[theme];
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--primary-dim', t.primaryDim);
  root.style.setProperty('--primary-glow', t.primaryGlow);
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--bg-card', t.bgCard);
  root.style.setProperty('--bg-hover', t.bgHover);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--text-dim', t.textDim);
  root.style.setProperty('--border', t.border);
  root.style.setProperty('--border-glow', t.borderGlow);
  root.style.setProperty('--scanline', t.scanlineColor);
}
