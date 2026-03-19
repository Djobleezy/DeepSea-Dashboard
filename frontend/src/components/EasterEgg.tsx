import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/store';
import { useEasterEgg } from '../hooks/useEasterEgg';
import { getThemeQuote } from '../utils/themeQuotes';

/* -----------------------------------------------------------
   Inline styles injected once so we don't need an extra CSS file.
   ----------------------------------------------------------- */
const STYLE = `
@keyframes whale-burst {
  0%   { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(var(--wx), var(--wy)) scale(0); opacity: 0; }
}
@keyframes egg-icon-slide {
  0%   { transform: translateX(-150px) rotate(0deg); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateX(calc(100vw + 150px)) rotate(720deg); opacity: 0; }
}
@keyframes egg-overlay-fade {
  0%   { opacity: 0; transform: scale(0.9); }
  10%  { opacity: 1; transform: scale(1); }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes matrix-rain-char {
  0%   { transform: translateY(-100%); opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { transform: translateY(100vh); opacity: 0; }
}

.easter-egg-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  animation: egg-overlay-fade 15s ease forwards;
  pointer-events: none;
}
.easter-egg-overlay.deepsea {
  background: rgba(0, 20, 40, 0.92);
  border: 2px solid #0088cc;
}
.easter-egg-overlay.bitcoin {
  background: rgba(20, 12, 0, 0.92);
  border: 2px solid #f7931a;
}
.easter-egg-overlay.matrix {
  background: rgba(0, 15, 0, 0.92);
  border: 2px solid #39ff14;
}

.easter-egg-title {
  font-family: var(--font-vt323);
  font-size: clamp(28px, 6vw, 64px);
  letter-spacing: 4px;
  margin-bottom: 16px;
  z-index: 1;
}
.easter-egg-overlay.deepsea .easter-egg-title { color: #0088cc; text-shadow: 0 0 20px #0088cc; }
.easter-egg-overlay.bitcoin .easter-egg-title { color: #f7931a; text-shadow: 0 0 20px #f7931a; }
.easter-egg-overlay.matrix  .easter-egg-title { color: #39ff14; text-shadow: 0 0 20px #39ff14; }

.easter-egg-quote {
  font-family: var(--font-mono);
  font-size: clamp(12px, 2vw, 16px);
  max-width: 60%;
  text-align: center;
  opacity: 0.85;
  z-index: 1;
  padding: 0 16px;
}
.easter-egg-overlay.deepsea .easter-egg-quote { color: #a0d4f5; }
.easter-egg-overlay.bitcoin .easter-egg-quote { color: #ffd580; }
.easter-egg-overlay.matrix  .easter-egg-quote { color: #39ff14; }

.egg-icon {
  position: absolute;
  animation: egg-icon-slide linear infinite;
  user-select: none;
}

.matrix-rain-overlay {
  position: fixed;
  inset: 0;
  z-index: 8999;
  pointer-events: none;
  overflow: hidden;
  background: rgba(0, 10, 0, 0.85);
  display: flex;
  gap: 0;
}
.matrix-rain-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.matrix-rain-char {
  font-family: var(--font-vt323);
  font-size: 18px;
  color: #39ff14;
  text-shadow: 0 0 6px #39ff14;
  animation: matrix-rain-char linear forwards;
  text-align: center;
  width: 100%;
}
`;

const MATRIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
const SEA_ICONS = ['🐳', '🐠', '🦀', '💰'];
const MATRIX_ICONS = ['💻', '🖥️', '⌨️'];

function randomChar() {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
}

interface MatrixRainProps {
  visible: boolean;
}

const MatrixRain: React.FC<MatrixRainProps> = ({ visible }) => {
  if (!visible) return null;
  const cols = Math.max(10, Math.floor(window.innerWidth / 20));
  return (
    <div className="matrix-rain-overlay">
      {Array.from({ length: cols }).map((_, ci) => (
        <div key={ci} className="matrix-rain-col">
          {Array.from({ length: 20 }).map((__, ri) => (
            <span
              key={ri}
              className="matrix-rain-char"
              style={{
                animationDuration: `${2 + Math.random() * 3}s`,
                animationDelay: `${Math.random() * 3}s`,
              }}
            >
              {randomChar()}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

interface EggOverlayProps {
  visible: boolean;
  theme: string;
  message: string;
  quote: string;
}

const EggOverlay: React.FC<EggOverlayProps> = ({ visible, theme, message, quote }) => {
  if (!visible) return null;

  const iconCount = Math.max(10, Math.floor(window.innerHeight / 30));
  const useMatrix = theme === 'matrix';
  const useDeepSea = theme === 'deepsea';
  const icons = useMatrix ? MATRIX_ICONS : useDeepSea ? SEA_ICONS : ['₿'];

  return (
    <div className={`easter-egg-overlay ${theme}`}>
      <div className="easter-egg-title">{message}</div>
      <div className="easter-egg-quote">"{quote}"</div>

      {Array.from({ length: iconCount }).map((_, i) => (
        <span
          key={i}
          className="egg-icon"
          style={{
            top: `${Math.random() * 100}%`,
            fontSize: useMatrix
              ? `${3 + Math.random() * 1.5}rem`
              : useDeepSea
                ? `${2 + Math.random() * 2}rem`
                : `${4 + Math.random() * 2}rem`,
            animationDuration: `${8 + Math.random() * 4}s`,
            animationDelay: `${Math.random() * 6}s`,
            color: useMatrix ? '#39ff14' : useDeepSea ? undefined : '#f7931a',
          }}
        >
          {icons[Math.floor(Math.random() * icons.length)]}
        </span>
      ))}
    </div>
  );
};

export const EasterEgg: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const styleInjected = useRef(false);

  // Inject CSS once
  useEffect(() => {
    if (styleInjected.current) return;
    styleInjected.current = true;
    const tag = document.createElement('style');
    tag.textContent = STYLE;
    document.head.appendChild(tag);
    return () => { tag.remove(); styleInjected.current = false; };
  }, []);

  const eggState = useEasterEgg(theme, getThemeQuote);

  return (
    <>
      <EggOverlay
        visible={eggState.overlayVisible}
        theme={eggState.overlayTheme}
        message={eggState.overlayMessage}
        quote={eggState.overlayQuote}
      />
      <MatrixRain visible={eggState.matrixRain} />
    </>
  );
};
