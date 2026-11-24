/**
 * Headless test harness: no editor UI, just the compiler and the engine.
 * `tools/e2e.cjs` drives it with Playwright to render example scenes, and the
 * editor loads it in a hidden iframe (`harness.html?agent`) to run code for a
 * connected AI agent without touching the user's document or playhead.
 */
import {apiNames} from './manim';
import {compileScene, defaultCompileOptions} from './runtime/compile';
import {civetToTsx, tsxToCivet} from './runtime/convert';
import {Engine, ItemId, OutlineNode, Timeline} from './runtime/engine';
import type {RenderControl, RenderOptions} from './runtime/export';

/**
 * Agent mode. The iframe usually runs while the editor tab is in the
 * background, where `requestAnimationFrame` never fires and timers are
 * throttled to once a second or less. A message-channel clock drives the
 * player instead, but only while a job runs (`begin`/`end`); between jobs
 * its frame requests wait, so an idle iframe costs nothing.
 */
const params = new URLSearchParams(location.search);
const agentMode = params.has('agent');
let busy = 0;
const channel = new MessageChannel();
const frameRequests = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let fakeTime = performance.now();
let scheduled = false;
const schedule = () => {
  if (busy && !scheduled && frameRequests.size) {
    scheduled = true;
    channel.port2.postMessage(0);
  }
};
if (agentMode) {
  channel.port1.onmessage = () => {
    scheduled = false;
    const batch = [...frameRequests.values()];
    frameRequests.clear();
    // Each tick is a whole frame later, so the player never skips one as "too soon".
    fakeTime += 50;
    for (const cb of batch) cb(fakeTime);
    schedule();
  };
  window.requestAnimationFrame = cb => {
    const id = nextFrameId++;
    frameRequests.set(id, cb);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = id => void frameRequests.delete(id);
}

/** Wait about `ms`; in agent mode without relying on (throttled) timers. */
const sleep = (ms: number) =>
  agentMode
    ? new Promise<void>(resolve => {
        const until = performance.now() + ms;
        const tick = new MessageChannel();
        tick.port1.onmessage = () => (performance.now() >= until ? resolve() : tick.port2.postMessage(0));
        tick.port2.postMessage(0);
      })
    : new Promise<void>(resolve => setTimeout(resolve, ms));

const engine = new Engine();
// An export runs in a page of its own, at the size and frame rate of the result.
if (Number(params.get('fps')) > 0) engine.fps = Number(params.get('fps'));
if (Number(params.get('scale')) > 0) engine.resolutionScale = Number(params.get('scale'));
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
    diagnostics = [];
    const compiled = compileScene(source, {...defaultCompileOptions, ...options});
    const ok = await engine.load(compiled, scene);
    if (ok) await api.settle();
    return {ok, diagnostics: compiled.ok ? diagnostics : compiled.diagnostics, scenes: engine.scenes, ts: compiled.ts};
  },
  /** Wait until the player has recalculated and rendered. */
  async settle(timeout = 15000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      // A native scene reports its timeline after the duration; wait for it a little longer.
      if (timeline || diagnostics.length || (gotDuration && performance.now() - start > 400)) break;
      await sleep(30);
    }
    await sleep(80);
  },
  async seek(frame: number) {
    engine.togglePlayback(false);
    const target = Math.max(0, Math.round(frame));
    // The player renders a seek and only then reports the new frame, so the
    // frame event is the reliable signal. A 'rendered' event can belong to a
    // render that was already under way (WebKit showed stale frames that way).
    let done = engine.frame === target;
    const off = engine.on('frame', f => {
      if (f === target) done = true;
    });
    engine.seek(target);
    const start = performance.now();
    while (!done && performance.now() - start < 5000) await sleep(10);
    off();
    await sleep(30);
  },
  info: () => ({timeline, diagnostics, duration, fps: engine.fps, outline: engine.outline()}),
};
/** Language conversions, so the e2e run can check that a converted scene behaves the same. */
(api as any).toTsx = (source: string) => civetToTsx(source, apiNames);
(api as any).toCivet = (source: string) => tsxToCivet(source);
(window as any).harness = api;

/** Render frames at `times` (seconds) into one sheet, labelled with their times (PNG data URL). */
async function sheetAt(times: number[], cols: number, cellWidth: number, label?: (time: number) => string) {
  const cellHeight = Math.round((cellWidth * 9) / 16);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cellWidth;
  sheet.height = rows * cellHeight;
  // Read back once per cell (below), so keep it in memory rather than on the GPU.
  const ctx = sheet.getContext('2d', {willReadFrequently: true})!;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < times.length; i++) {
    const frame = Math.min(Math.round(times[i] * engine.fps), Math.max(0, duration - 1));
    await api.seek(frame);
    const x = (i % cols) * cellWidth;
    const y = Math.floor(i / cols) * cellHeight;
    // WebKit defers drawImage from a canvas until its next rendering update,
    // which the agent-mode clock never triggers: every cell would show a later
    // frame. Snapshot the canvas now, and rasterize the sheet before moving on.
    const snapshot = await createImageBitmap(engine.canvas);
    ctx.drawImage(snapshot, x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    snapshot.close();
    ctx.getImageData(x + 1, y + 1, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const text = label?.(frame / engine.fps) ?? `${(frame / engine.fps).toFixed(2)}s`;
    ctx.font = '14px monospace';
    ctx.fillRect(x + 4, y + 4, ctx.measureText(text).width + 10, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(text, x + 9, y + 19);
  }
  return sheet.toDataURL('image/png');
}

/** Render `count` evenly spaced frames into one contact sheet (PNG data URL). */
(api as any).sheet = async (count = 8, cols = 4, cellWidth = 480) => {
  const total = Math.max(1, duration);
  const times = Array.from({length: count}, (_, i) => Math.round(((i + 0.5) / count) * total) / engine.fps);
  return sheetAt(times, cols, cellWidth);
};

// ------------------------------------------------------------- agent API

const stepAt = (time: number) => timeline?.segments.findLast(s => s.start <= time + 1e-6);

/** Everything a job needs to report about the last run. */
function report(ok: boolean, diags: unknown[]) {
  return {
    ok: ok && diags.length === 0,
    diagnostics: diags,
    scenes: engine.scenes,
    activeScene: engine.activeScene,
    duration: duration / engine.fps,
    steps: (timeline?.segments ?? []).map((s, index) => ({index, kind: s.kind, label: s.label, start: s.start, end: s.end, line: s.line})),
    timedOut: ok && !timeline && diags.length === 0,
  };
}

/** Run one agent job with the clock running; jobs never overlap. */
let queue: Promise<unknown> = Promise.resolve();
function job<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    busy++;
    schedule();
    try {
      return await fn();
    } finally {
      busy--;
      engine.togglePlayback(false);
    }
  });
  queue = next.catch(() => {});
  return next;
}

const agent = {
  /** Compile and run `source`, report problems and the timeline. */
  check: (source: string, options = {}) =>
    job(async () => {
      const r = await api.run(source, options);
      return report(r.ok, r.diagnostics);
    }),
  /** Run `source` and render frames at `times` (default: `count` spread over the scene). */
  render: (source: string, options = {}, opts: {times?: number[]; count?: number; width?: number} = {}) =>
    job(async () => {
      const r = await api.run(source, options);
      const run = report(r.ok, r.diagnostics);
      if (!r.ok) return {image: '', frames: [], run};
      const total = duration / engine.fps;
      const count = opts.times?.length ?? opts.count ?? 8;
      const times = opts.times?.length
        ? opts.times.map(t => Math.min(Math.max(0, t), total))
        : Array.from({length: count}, (_, i) => (count === 1 ? total / 2 : ((i + 0.5) / count) * total));
      const cols = times.length === 1 ? 1 : times.length <= 4 ? times.length : times.length <= 9 ? 3 : 4;
      const width = opts.width ?? (times.length === 1 ? 960 : 480);
      const label = (t: number) => {
        const s = stepAt(t);
        return `${t.toFixed(2)}s${s ? ` · ${s.label}${s.line ? ` L${s.line}` : ''}` : ''}`;
      };
      const image = await sheetAt(times, cols, width, label);
      return {image, frames: times.map(time => ({time, step: stepAt(time)?.label})), run};
    }),
  /** Run `source`, seek to `time` and list what is on screen with bounds. */
  inspect: (source: string, options = {}, time = 0) =>
    job(async () => {
      const r = await api.run(source, options);
      const run = report(r.ok, r.diagnostics);
      if (!r.ok) return {time, items: [], run};
      await api.seek(Math.round(Math.min(time, duration / engine.fps) * engine.fps));
      const items: unknown[] = [];
      const walk = (n: OutlineNode, depth: number) => {
        const info = engine.inspect(n.id as ItemId);
        const properties: Record<string, string> = {};
        for (const row of info?.rows ?? []) if (!/^(Parts|z-index|Children)$/.test(row.label)) properties[row.label.toLowerCase()] = row.value;
        items.push({id: n.id, name: n.name, kind: n.kind, depth, line: n.line, visible: n.visible, bounds: engine.bounds(n.id) ?? undefined, properties});
        // Characters of a text and parts of a formula are noise at this level.
        const textish = /Text|Tex|Paragraph|Title|DecimalNumber|Integer|Variable/;
        if (depth < 2 && !textish.test(n.kind) && !textish.test(n.name)) for (const c of n.children) walk(c, depth + 1);
      };
      for (const n of engine.outline()) walk(n, 0);
      return {time, items, run};
    }),
  /**
   * Run `source` and export it frame by frame (see runtime/export.ts). The
   * page is loaded with `?fps=…&scale=…` for the size of the result.
   */
  export: (
    source: string,
    options = {},
    opts: RenderOptions & {scene?: string},
    onProgress: (p: number) => void = () => {},
    control: RenderControl = {cancelled: false},
  ) =>
    job(async () => {
      const r = await api.run(source, options, opts.scene);
      const run = report(r.ok, r.diagnostics);
      if (!run.ok) return {run};
      const {renderScene} = await import('./runtime/export');
      let first = true;
      const seek = (frame: number) => {
        // The first seek, and any seek backwards, replays from the start.
        if (first || frame <= engine.frame) {
          first = false;
          return api.seek(frame);
        }
        return new Promise<void>((resolve, reject) => {
          const watchdog = setTimeout(() => {
            off();
            reject(new Error(`The scene stopped rendering at frame ${frame}.`));
          }, 20_000);
          const off = engine.on('frame', f => {
            if (f !== frame) return;
            clearTimeout(watchdog);
            off();
            resolve();
          });
          engine.seek(frame);
        });
      };
      const output = await renderScene({engine, frames: duration, seek}, opts, onProgress, control);
      return {run, output};
    }),
};
(window as any).harnessAgent = agent;
