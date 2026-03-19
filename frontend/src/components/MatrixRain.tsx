import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLUMN_WIDTH = 20;
const FONT_SIZE = 16;

// Character pools
const KATAKANA =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';
const GREEK = 'ΩβπΣΔΘΛΞΦΨαβγδεζηθικλμνξοπρστυφχψω';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()[]{}<>?/|~';

const CHAR_SET = KATAKANA + GREEK + LATIN + DIGITS + SYMBOLS;
const CHAR_ARRAY = Array.from(CHAR_SET);

// Cycling words injected periodically into columns
const CYCLING_WORDS = ['BITCOIN', 'MATRIX', 'OCEAN', 'HASHRATE', 'SATOSHI'];

// Color constants — classic matrix green
const HEAD_COLOR = '#ccffcc'; // bright white-green for lead char
const TRAIL_FADE = 'rgba(0, 0, 0, 0.12)'; // fade overlay per frame

// Timing — target ~24fps effective (rAF at 60fps, draw every ~2.5 frames)
const TARGET_FPS = 20;
const FRAME_MS = 1000 / TARGET_FPS;

// ---------------------------------------------------------------------------
// Column state
// ---------------------------------------------------------------------------
interface Column {
  // Current y position in grid rows (can be fractional for variable speed)
  y: number;
  // Speed in rows per frame
  speed: number;
  // Trail length in rows
  trailLength: number;
  // Injected word state (null when showing random chars)
  word: string | null;
  wordIndex: number;
  // Countdown until next word injection (frames)
  nextWordIn: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function randomChar(): string {
  return CHAR_ARRAY[Math.floor(Math.random() * CHAR_ARRAY.length)];
}

let wordCycleIndex = 0;
function nextWord(): string {
  const w = CYCLING_WORDS[wordCycleIndex % CYCLING_WORDS.length];
  wordCycleIndex++;
  return w;
}

function makeColumn(rows: number): Column {
  return {
    y: randomBetween(-rows, 0), // start staggered above viewport
    speed: randomBetween(0.3, 1.1),
    trailLength: randomInt(8, 28),
    word: null,
    wordIndex: 0,
    nextWordIn: randomInt(60, 600), // frames until next word
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const MatrixRain: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (theme !== 'matrix') return;

    // Respect prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // -----------------------------------------------------------------------
    // Sizing
    // -----------------------------------------------------------------------
    let cols: number;
    let rows: number;
    let logicalWidth = 0;
    let logicalHeight = 0;
    let columns: Column[] = [];

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      // HiDPI-safe sizing: keep CSS pixels for layout, scale backing store for sharp text.
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      logicalWidth = w;
      logicalHeight = h;

      const newCols = Math.ceil(w / COLUMN_WIDTH);
      const newRows = Math.ceil(h / FONT_SIZE);

      if (columns.length === 0) {
        // First init
        columns = Array.from({ length: newCols }, () => makeColumn(newRows));
      } else if (newCols > cols) {
        // Grew: add columns
        for (let i = cols; i < newCols; i++) {
          columns.push(makeColumn(newRows));
        }
      } else if (newCols < cols) {
        // Shrank: trim columns
        columns.length = newCols;
      }

      cols = newCols;
      rows = newRows;
    }

    resize();
    window.addEventListener('resize', resize);

    // -----------------------------------------------------------------------
    // Draw
    // -----------------------------------------------------------------------
    function draw() {
      if (!ctx || !canvas) return;

      // Fade overlay — paints a semi-transparent black over the whole canvas
      // to create the trailing effect. Lower alpha = longer trails.
      ctx.fillStyle = TRAIL_FADE;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      ctx.font = `${FONT_SIZE}px "MS Gothic", "Noto Sans JP", monospace`;
      ctx.textBaseline = 'top';

      for (let c = 0; c < cols; c++) {
        const col = columns[c];
        const x = c * COLUMN_WIDTH;

        // Skip columns fully above viewport (still advancing off-top)
        const headY = Math.floor(col.y);
        if (headY < -col.trailLength) {
          col.y += col.speed;
          continue;
        }

        // Skip columns fully below viewport
        if (headY > rows + 5) {
          // Reset column
          col.y = randomBetween(-10, -1);
          col.speed = randomBetween(0.3, 1.1);
          col.trailLength = randomInt(8, 28);
          col.word = null;
          col.wordIndex = 0;
          col.nextWordIn = randomInt(60, 600);
          continue;
        }

        // ----------------------------------------------------------------
        // Determine character for the head position
        // ----------------------------------------------------------------
        let headChar: string;

        if (col.word !== null) {
          headChar = col.word[col.wordIndex] ?? randomChar();
          col.wordIndex++;
          if (col.wordIndex >= col.word.length) {
            col.word = null;
            col.wordIndex = 0;
          }
        } else {
          col.nextWordIn--;
          if (col.nextWordIn <= 0) {
            col.word = nextWord();
            col.wordIndex = 0;
            col.nextWordIn = randomInt(120, 800);
          }
          headChar = randomChar();
        }

        // ----------------------------------------------------------------
        // Draw the head character (brightest)
        // ----------------------------------------------------------------
        if (headY >= 0 && headY < rows) {
          ctx.fillStyle = HEAD_COLOR;
          ctx.shadowColor = '#00ff41';
          ctx.shadowBlur = 8;
          ctx.fillText(headChar, x, headY * FONT_SIZE);
          ctx.shadowBlur = 0;
        }

        // ----------------------------------------------------------------
        // Advance column position
        // ----------------------------------------------------------------
        col.y += col.speed;
      }
    }

    // -----------------------------------------------------------------------
    // Animation loop — rAF with frame throttle
    // -----------------------------------------------------------------------
    let animId: number;
    let lastTime = 0;

    function loop(ts: number) {
      animId = requestAnimationFrame(loop);

      const elapsed = ts - lastTime;
      if (elapsed < FRAME_MS) return;
      lastTime = ts - (elapsed % FRAME_MS);

      draw();
    }

    animId = requestAnimationFrame(loop);

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      // Clear canvas on unmount
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [theme]);

  // Clear canvas when theme switches away from matrix
  useEffect(() => {
    if (theme === 'matrix') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [theme]);

  if (theme !== 'matrix') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.18,
      }}
    />
  );
};
