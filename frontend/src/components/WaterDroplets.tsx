import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/store';

interface Droplet {
  id: number;
  x: number; // % from left
  y: number; // % from top
  size: number; // px
  dripping: boolean;
  dripDuration: number; // s
  condenseFadeDelay: number; // s before condensation fades in
}

let nextDropletId = 0;

function createDroplet(): Droplet {
  return {
    id: nextDropletId++,
    x: 5 + Math.random() * 90,
    y: 5 + Math.random() * 60,
    size: 12 + Math.random() * 24,
    dripping: false,
    dripDuration: 3 + Math.random() * 3,
    condenseFadeDelay: Math.random() * 0.5,
  };
}

const THEME_COLORS: Record<string, { bg: string; glow: string; trail: string }> = {
  deepsea: {
    bg: 'rgba(0, 136, 204, 0.3)',
    glow: 'rgba(0, 136, 204, 0.5)',
    trail: 'rgba(0, 136, 204, 0.2)',
  },
  matrix: {
    bg: 'rgba(57, 255, 20, 0.3)',
    glow: 'rgba(57, 255, 20, 0.5)',
    trail: 'rgba(57, 255, 20, 0.2)',
  },
  bitcoin: {
    bg: 'rgba(255, 255, 255, 0.2)',
    glow: 'rgba(247, 147, 26, 0.3)',
    trail: 'rgba(255, 255, 255, 0.15)',
  },
};

interface Props {
  active?: boolean;
}

export const WaterDroplets: React.FC<Props> = ({ active = true }) => {
  const theme = useAppStore((s) => s.theme);
  const [droplets, setDroplets] = React.useState<Droplet[]>([]);
  const [condensation, setCondensation] = React.useState(false);
  const spawnTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const colors = THEME_COLORS[theme] ?? THEME_COLORS.deepsea;

  const removeDroplet = (id: number) => {
    setDroplets((prev) => prev.filter((d) => d.id !== id));
  };

  useEffect(() => {
    if (!active) {
      setDroplets([]);
      setCondensation(false);
      return;
    }

    const condTimer = setTimeout(() => setCondensation(true), 300);

    let spawnCount = 0;
    const maxDroplets = 8;
    spawnTimer.current = setInterval(() => {
      if (spawnCount >= maxDroplets) {
        if (spawnTimer.current) clearInterval(spawnTimer.current);
        return;
      }
      setDroplets((prev) => [...prev, createDroplet()]);
      spawnCount++;
    }, 400);

    const dripTimer = setTimeout(() => {
      setDroplets((prev) => prev.map((d) => ({ ...d, dripping: true })));
    }, 3000);

    return () => {
      clearTimeout(condTimer);
      clearTimeout(dripTimer);
      if (spawnTimer.current) clearInterval(spawnTimer.current);
    };
  }, [active]);

  if (!active && droplets.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes droplet-condense {
          0%   { opacity: 0; transform: scale(0.3); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes droplet-drip {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          30%  { transform: translateY(8px) scale(0.95, 1.1); opacity: 1; }
          100% { transform: translateY(100vh) scale(0.6, 1.3); opacity: 0; }
        }
        @keyframes condensation-fade {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>

      {condensation && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at 50% 0%, ${colors.trail} 0%, transparent 70%)`,
            animation: 'condensation-fade 2s ease forwards',
          }}
        />
      )}

      {droplets.map((d) => (
        <div
          key={d.id}
          onAnimationEnd={(e) => {
            if (e.animationName === 'droplet-drip') {
              removeDroplet(d.id);
            }
          }}
          style={{
            position: 'absolute',
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: `${d.size}px`,
            height: `${d.size}px`,
            backgroundColor: colors.bg,
            borderRadius: '50%',
            boxShadow: `inset 5px 5px 10px rgba(255,255,255,0.3), inset -5px -5px 10px rgba(0,0,0,0.3), 0 0 5px ${colors.glow}`,
            backdropFilter: 'blur(2.5px) contrast(1.2)',
            WebkitBackdropFilter: 'blur(2.5px) contrast(1.2)',
            animation: d.dripping
              ? `droplet-drip ${d.dripDuration}s linear forwards`
              : `droplet-condense 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${d.condenseFadeDelay}s forwards`,
            opacity: d.dripping ? 1 : 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '10%',
              left: '15%',
              width: '30%',
              height: '30%',
              backgroundColor: 'rgba(255,255,255,0.7)',
              borderRadius: '50%',
            }}
          />
        </div>
      ))}
    </div>
  );
};
