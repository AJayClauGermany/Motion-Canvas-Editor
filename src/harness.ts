/**
 * Headless test harness: no editor UI, just the compiler and the engine.
 * `tools/e2e.ts` drives it with Playwright to render example scenes.
 */
import {apiNames} from './manim';
import {compileScene, defaultCompileOptions} from './runtime/compile';
import {civetToTsx, tsxToCivet} from './runtime/convert';
import {Engine, Timeline} from './runtime/engine';

const engine = new Engine();
document.getElementById('stage')!.append(engine.canvas);

let timeline: Timeline | null = null;
let diagnostics: unknown[] = [];
let duration = 0;
engine.on('timeline', t => (timeline = t));
engine.on('diagnostics', d => (diagnostics = d));
let gotDuration = false;
engine.on('duration', d => {
  duration = d;
  gotDuration = true;
});

const api = {
  engine,
  async run(source: string, options = {}, scene?: string) {
    timeline = null;
    gotDuration = false;
    const compiled = compileScene(source, {...defaultCompileOptions, ...options});
    const ok = await engine.load(compiled, scene);
    if (ok) await api.settle();
    return {ok, diagnostics: compiled.ok ? diagnostics : compiled.diagnostics, scenes: engine.scenes, ts: compiled.ts};
  },
  /** Wait until the player has recalculated and rendered. */
  async settle(timeout = 15000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      if (timeline || diagnostics.length || gotDuration) break;
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 80));
  },
  async seek(frame: number) {
    engine.togglePlayback(false);
    let done = false;
    const off = engine.on('rendered', () => (done = true));
    engine.seek(frame);
    const start = performance.now();
    while (!done && performance.now() - start < 5000) await new Promise(r => setTimeout(r, 10));
    off();
    await new Promise(r => setTimeout(r, 30));
  },
  info: () => ({timeline, diagnostics, duration, fps: engine.fps, outline: engine.outline()}),
};
/** Language conversions, so the e2e run can check that a converted scene behaves the same. */
(api as any).toTsx = (source: string) => civetToTsx(source, apiNames);
(api as any).toCivet = (source: string) => tsxToCivet(source);
(window as any).harness = api;

/** Render `count` evenly spaced frames into one contact sheet (PNG data URL). */
(api as any).sheet = async (count = 8, cols = 4, cellWidth = 480) => {
  const total = Math.max(1, duration);
  const cellHeight = Math.round((cellWidth * 9) / 16);
  const rows = Math.ceil(count / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cellWidth;
  sheet.height = rows * cellHeight;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < count; i++) {
    const frame = Math.round(((i + 0.5) / count) * total);
    await api.seek(frame);
    const x = (i % cols) * cellWidth;
    const y = Math.floor(i / cols) * cellHeight;
    ctx.drawImage(engine.canvas, x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '14px monospace';
    ctx.fillText(`${(frame / engine.fps).toFixed(2)}s`, x + 8, y + 18);
  }
  return sheet.toDataURL('image/png');
};
