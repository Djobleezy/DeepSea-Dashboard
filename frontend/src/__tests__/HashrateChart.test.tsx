import { StrictMode } from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HashrateChart } from '../components/HashrateChart';
import { useAppStore } from '../stores/store';
import type { ChartConfiguration } from 'chart.js';
type Config = ChartConfiguration<'line', { x: number; y: number | null }[]>;
type MockChart = { destroyed: boolean; data: Config['data']; options: NonNullable<Config['options']>; update: ReturnType<typeof vi.fn> };

const { instances } = vi.hoisted(() => ({ instances: [] as MockChart[] }));
vi.mock('chart.js', () => ({
  Chart: class {
    static register() {}
    destroyed = false;
    data: Config['data'];
    options: NonNullable<Config['options']>;
    update = vi.fn();
    constructor(_context: unknown, config: Config) { this.data = config.data; this.options = config.options!; instances.push(this); }
    destroy() { this.destroyed = true; }
  },
  LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {}, Filler: {}, Tooltip: {},
}));
vi.mock('chartjs-plugin-annotation', () => ({ default: {} }));

const now = Date.UTC(2026, 9, 20, 10);
const data = [{ ts: now - 60_000, value: 1 }, { ts: now, value: 2 }];
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  instances.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.documentElement.style.removeProperty('--font-mono');
});

describe('Hashrate chart lifecycle', () => {
  it('recreates a live chart during StrictMode replay and destroys every instance on unmount', () => {
    const view = render(<StrictMode><HashrateChart data60s={data} data3hr={data} now={now} /></StrictMode>);
    expect(instances.filter((i) => !i.destroyed)).toHaveLength(1);
    view.unmount();
    expect(instances.every((i) => i.destroyed)).toBe(true);
  });

  it('updates data, units, theme and visibility without replacing the chart instance', () => {
    const view = render(<HashrateChart data60s={data} data3hr={data} now={now} />);
    const chart = instances[0];
    const larger = data.map((p) => ({ ...p, value: 2000 }));
    view.rerender(<HashrateChart data60s={larger} data3hr={larger} now={now} />);
    act(() => useAppStore.getState().setTheme('bitcoin'));
    fireEvent.click(screen.getByRole('button', { name: '60 sec' }));
    expect(instances).toHaveLength(1);
    expect(chart.destroyed).toBe(false);
    expect(chart.data.datasets[0].hidden).toBe(true);
    expect(chart.data.datasets[0].data[0].y).toBe(2);
    expect(chart.options.scales?.y?.title?.text).toBe('PH/s');
    expect(chart.options.elements?.line).toMatchObject({ tension: 0, spanGaps: false });
    expect(chart.options.animation).toBe(false);
  });

  it('redraws the existing chart in the brand font when a cold font load finishes', async () => {
    const fonts = new EventTarget();
    let loaded = false;
    let finishLoading!: () => void;
    Object.assign(fonts, {
      check: () => loaded,
      ready: new Promise<void>((resolve) => { finishLoading = resolve; }),
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const removeListener = vi.spyOn(fonts, 'removeEventListener');
    const family = '"Share Tech Mono", "Courier New", monospace';
    document.documentElement.style.setProperty('--font-mono', family);

    const view = render(<HashrateChart data60s={data} data3hr={data} now={now} />);
    const chart = instances[0];
    expect(chart.options.scales?.x?.ticks?.font).toMatchObject({ family: 'monospace' });
    const initialUpdates = chart.update.mock.calls.length;

    await act(async () => {
      loaded = true;
      finishLoading();
    });

    expect(instances).toHaveLength(1);
    expect(chart.destroyed).toBe(false);
    expect(chart.update.mock.calls.length).toBeGreaterThan(initialUpdates);
    expect(chart.options.scales?.x?.ticks?.font).toMatchObject({ family });
    expect(chart.options.scales?.y?.ticks?.font).toMatchObject({ family });
    expect(chart.options.scales?.y?.title?.font).toMatchObject({ family });
    expect(chart.options.plugins?.tooltip?.titleFont).toMatchObject({ family });
    expect(chart.options.plugins?.tooltip?.bodyFont).toMatchObject({ family });

    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));
    const finalUpdates = chart.update.mock.calls.length;
    act(() => fonts.dispatchEvent(new Event('loadingdone')));
    expect(chart.update.mock.calls.length).toBe(finalUpdates);
  });
});
