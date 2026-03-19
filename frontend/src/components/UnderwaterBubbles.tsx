import React, { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/store';

interface Bubble {
  id: number;
  left: number;      // % from left
  size: number;      // px
  duration: number;  // s
  drift: number;     // px, ±30
  delay: number;     // s, slight stagger
}

let nextId = 0;

function createBubble(): Bubble {
  return {
    id: nextId++,
    left: Math.random() * 100,
    size: 5 + Math.random() * 12,          // 5–17px
    duration: 8 + Math.random() * 12,      // 8–20s
    drift: (Math.random() - 0.5) * 60,     // ±30px
    delay: Math.random() * 0.5,            // tiny stagger so batch looks natural
  };
}

const DENSITY_DESKTOP = 12;
const DENSITY_MOBILE = 3;
const SPAWN_INTERVAL_DESKTOP = 2000; // ms
const SPAWN_INTERVAL_MOBILE = 4000;

export const UnderwaterBubbles: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const [bubbles, setBubbles] = React.useState<Bubble[]>([]);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const density = isMobile ? DENSITY_MOBILE : DENSITY_DESKTOP;
  const spawnInterval = isMobile ? SPAWN_INTERVAL_MOBILE : SPAWN_INTERVAL_DESKTOP;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const spawnBatch = useCallback(() => {
    setBubbles((prev) => [
      ...prev,
      createBubble(),
    ]);
  }, []);

  useEffect(() => {
    if (theme !== 'deepsea') {
      setBubbles([]);
      return;
    }

    // Initial population — stagger a bit so they don't all start at once
    const initial: Bubble[] = [];
    for (let i = 0; i < density; i++) {
      const b = createBubble();
      // Distribute initial bubbles across the animation timeline
      b.delay = (i / density) * b.duration;
      initial.push(b);
    }
    setBubbles(initial);

    // Continuously spawn new bubbles
    timerRef.current = setInterval(spawnBatch, spawnInterval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [theme, density, spawnInterval, spawnBatch]);

  const removeBubble = useCallback((id: number) => {
    setBubbles((prev) => prev.filter((b) => b.id !== id));
  }, []);

  if (theme !== 'deepsea' || bubbles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes bubble-rise {
          0% {
            transform: translateY(0) translateX(0) scale(1);
            opacity: 0.6;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            transform: translateY(-100vh) translateX(var(--bubble-drift)) scale(0.7);
            opacity: 0;
          }
        }
      `}</style>
      {bubbles.map((b) => (
        <div
          key={b.id}
          onAnimationEnd={() => removeBubble(b.id)}
          style={{
            position: 'absolute',
            bottom: '-20px',
            left: `${b.left}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            background:
              'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.2))',
            borderRadius: '50%',
            opacity: 0.6,
            boxShadow: '0 0 4px rgba(0, 136, 204, 0.4), 0 0 8px rgba(0, 136, 204, 0.2)',
            animation: `bubble-rise ${b.duration}s linear ${b.delay}s 1 forwards`,
            // CSS custom property for drift
            ['--bubble-drift' as string]: `${b.drift}px`,
          }}
        />
      ))}
    </div>
  );
};
