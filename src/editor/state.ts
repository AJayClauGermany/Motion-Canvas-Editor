/**
 * Editor state: one object created by <App> and shared through context.
 * The engine and compiler are framework-agnostic; this module adapts them to
 * Solid signals and holds the actions the UI calls.
 */
import {createContext, createMemo, createSignal, createStore, reconcile, useContext} from 'solid-js';
import {compileScene, CompileResult, Diagnostic} from '../runtime/compile';
import {pythonToCivet} from '../runtime/python';
import {toAt, toCamelCase, toExplicitYield, toImplicitYield, toSelf, toSnakeCase} from '../runtime/dialect';
import {Engine, MobjectInfo, OutlineNode, SceneEntry, Timeline} from '../runtime/engine';
import {BLANK_MANIM, Example, examples} from './examples';
import {defaults, hashParam, loadSettings, qualityOf, saveSettings, Settings} from './settings';

type Dialect = Pick<Settings, 'naming' | 'yieldStyle' | 'selfStyle'>;
const CANONICAL: Dialect = {naming: 'snake', yieldStyle: 'implicit', selfStyle: 'at'};

/** Rewrite Manim-style source from one dialect variant to another. */
export function convertDialect(code: string, from: Dialect, to: Dialect): string {
  if (!/^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(code)) return code;
  let out = code;
  // Normalise to `@` first so the other conversions see one spelling.
  if (from.selfStyle === 'self') out = toAt(out);
  if (from.yieldStyle !== to.yieldStyle) {
    out = to.yieldStyle === 'explicit' ? toExplicitYield(out) : toImplicitYield(out);
  }
  if (from.naming !== to.naming) out = to.naming === 'camel' ? toCamelCase(out) : toSnakeCase(out);
  if (to.selfStyle === 'self') out = toSelf(out);
  return out;
}

const dialectOf = (s: Settings): Dialect => ({naming: s.naming, yieldStyle: s.yieldStyle, selfStyle: s.selfStyle});

interface StoredBuffer extends Dialect {
  code: string;
}
const bufferKey = (slug: string) => `mce.buffer.v1.${slug}`;
function readBuffer(slug: string): StoredBuffer | null {
  try {
    const raw = localStorage.getItem(bufferKey(slug));
    return raw ? (JSON.parse(raw) as StoredBuffer) : null;
  } catch {
    return null;
  }
}
function writeBuffer(slug: string, buffer: StoredBuffer | null) {
  try {
    if (buffer) localStorage.setItem(bufferKey(slug), JSON.stringify(buffer));
    else localStorage.removeItem(bufferKey(slug));
  } catch {
    // Storage may be unavailable; edits then live for the session only.
  }
}

const SCRATCH: Example = {
  slug: 'scratch',
  title: 'Blank scene',
  description: 'An empty Manim-style scene to start from.',
  style: 'manim',
  order: 0,
  code: BLANK_MANIM,
};

export function createEditorState() {
  const engine = new Engine();
  const all = [...examples, SCRATCH];
  const initialSettings = loadSettings();
  const [settings, setSettings] = createStore<Settings>(initialSettings);

  const initialSlug = (() => {
    const wanted = hashParam('example');
    return all.find(e => e.slug === wanted)?.slug ?? all[0].slug;
  })();
  const pristine = (example: Example, s: Settings) =>
    example.style === 'manim' ? convertDialect(example.code, CANONICAL, dialectOf(s)) : example.code;
  const bufferFor = (example: Example, s: Settings): string => {
    const stored = readBuffer(example.slug);
    if (!stored) return pristine(example, s);
    return example.style === 'manim' ? convertDialect(stored.code, stored, dialectOf(s)) : stored.code;
  };

  const initialSource = bufferFor(all.find(e => e.slug === initialSlug)!, initialSettings);
  // Apply the persisted preview quality before the first run.
  const initialQuality = qualityOf(initialSettings.quality);
  engine.fps = initialQuality.fps;
  engine.resolutionScale = initialQuality.scale;

  const [exampleSlug, setExampleSlug] = createSignal(initialSlug);
  const [source, setSourceSignal] = createSignal(initialSource);
  /** Bumped whenever the buffer is replaced from outside the code editor. */
  const [sourceVersion, setSourceVersion] = createSignal(0);
  const [compiled, setCompiled] = createSignal<CompileResult | null>(null);
  const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
  const [timeline, setTimeline] = createSignal<Timeline | null>(null);
  const [frame, setFrame] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [fps, setFps] = createSignal(engine.fps);
  const [paused, setPaused] = createSignal(true);
  const [loop, setLoop] = createSignal(true);
  const [speed, setSpeedSignal] = createSignal(1);
  const [scenes, setScenes] = createSignal<SceneEntry[]>([]);
  const [activeScene, setActiveScene] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<number | null>(null);
  const [outline, setOutline] = createStore<{nodes: OutlineNode[]}>({nodes: []});
  const [info, setInfo] = createSignal<MobjectInfo | null>(null);
  const [selectionBounds, setSelectionBounds] = createSignal<[number, number, number, number] | null>(null);
  const [compileMs, setCompileMs] = createSignal<number | null>(null);
  const [reveal, setReveal] = createSignal<{line: number; tick: number} | null>(null);
  const [cursorLine, setCursorLineSignal] = createSignal(1);
  const [labOpen, setLabOpen] = createSignal(hashParam('lab') === '1');
  const [notes, setNotes] = createSignal('');
  const [dirty, setDirty] = createSignal(readBuffer(initialSlug) !== null);
  const [exporting, setExporting] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [importOpen, setImportOpen] = createSignal(false);
  const [importNotes, setImportNotes] = createSignal<string[]>([]);
  const [fileName, setFileName] = createSignal<string | null>(null);

  // Plain mirrors of signal state for use inside actions (reads lag writes).
  let current = {
    source: initialSource,
    slug: initialSlug,
    settings: {...initialSettings} as Settings,
    timeline: null as Timeline | null,
    selected: null as number | null,
    fps: engine.fps,
    scene: null as string | null,
  };

  const example = createMemo(() => all.find(e => e.slug === exampleSlug()) ?? all[0]);
  const time = createMemo(() => frame() / fps());
  const durationSeconds = createMemo(() => duration() / fps());
  const currentSegment = createMemo(() => {
    const t = timeline();
    if (!t) return -1;
    const now = time() + 1e-6;
    let index = -1;
    for (let i = 0; i < t.segments.length; i++) {
      if (t.segments[i].start <= now) index = i;
      else break;
    }
    return index;
  });
  const activeLine = createMemo(() => {
    const t = timeline();
    const i = currentSegment();
    return t && i >= 0 ? (t.segments[i].line ?? null) : null;
  });

  // ---------------------------------------------------------------- engine

  engine.on('frame', f => setFrame(f));
  engine.on('duration', d => setDuration(d));
  engine.on('state', s => {
    setPaused(s.paused);
    setLoop(s.loop);
    setSpeedSignal(s.speed);
  });
  engine.on('timeline', t => {
    current.timeline = t;
    setTimeline(t);
  });
  engine.on('diagnostics', list => {
    setDiagnostics(list);
    if (list.length) setStatus('error');
  });

  let lastInspect = 0;
  let inspectTimer: number | undefined;
  const refreshInspection = () => {
    lastInspect = performance.now();
    const nodes = engine.outline();
    setOutline(s => {
      reconcile(nodes, 'id')(s.nodes);
    });
    const id = current.selected;
    setInfo(id === null ? null : engine.inspect(id));
    setSelectionBounds(id === null ? null : engine.bounds(id));
  };
  engine.on('rendered', () => {
    // Inspecting every frame would cost more than rendering; ~8 Hz is plenty.
    const wait = 120 - (performance.now() - lastInspect);
    clearTimeout(inspectTimer);
    if (wait <= 0) refreshInspection();
    else inspectTimer = window.setTimeout(refreshInspection, wait);
  });

  // ------------------------------------------------------------- compiling

  let runTimer: number | undefined;
  let runCount = 0;
  const run = async () => {
    clearTimeout(runTimer);
    const ticket = ++runCount;
    setStatus('running');
    const started = performance.now();
    const s = current.settings;
    const result = compileScene(current.source, {
      implicitYield: s.yieldStyle === 'implicit',
      operators: s.operators === 'on',
      hashComments: true,
    });
    setCompiled(result);
    const ok = await engine.load(result, current.scene);
    if (ticket !== runCount) return;
    setCompileMs(Math.round(performance.now() - started));
    setScenes(engine.scenes);
    current.scene = engine.activeScene;
    setActiveScene(engine.activeScene);
    if (!ok) {
      setStatus('error');
      if (!result.ok) setDiagnostics(result.diagnostics);
      return;
    }
    if (engine.scenes.find(e => e.name === engine.activeScene)?.kind !== 'manim') {
      current.timeline = null;
      setTimeline(null);
    }
    setStatus('ok');
  };
  const scheduleRun = () => {
    clearTimeout(runTimer);
    if (current.settings.runMode === 'live') runTimer = window.setTimeout(run, 250);
  };

  const persist = () => {
    saveSettings(current.settings, {example: current.slug === all[0].slug ? '' : current.slug});
  };

  /** Replace the buffer from outside the code editor. */
  const replaceSource = (code: string) => {
    current.source = code;
    setSourceSignal(code);
    setSourceVersion(v => v + 1);
  };

  const actions = {
    /** The buffer as of now (signals lag writes by a microtask). */
    getSource: () => current.source,
    /** Called by the code editor on every edit. */
    edit(code: string) {
      if (code === current.source) return;
      current.source = code;
      setSourceSignal(code);
      const ex = all.find(e => e.slug === current.slug)!;
      const changed = code !== pristine(ex, current.settings);
      setDirty(changed);
      writeBuffer(current.slug, changed ? {code, ...dialectOf(current.settings)} : null);
      scheduleRun();
    },
    run,
    loadExample(slug: string, autoplay = true) {
      const ex = all.find(e => e.slug === slug);
      if (!ex) return;
      if (slug !== SCRATCH.slug) setFileName(null);
      current.slug = slug;
      current.scene = null;
      current.selected = null;
      setSelected(null);
      setExampleSlug(slug);
      setDirty(readBuffer(slug) !== null);
      replaceSource(bufferFor(ex, current.settings));
      persist();
      engine.togglePlayback(false);
      void run().then(() => {
        engine.seek(0);
        if (autoplay) engine.togglePlayback(true);
      });
    },
    /** Put arbitrary Manim-dialect source into the scratch document. */
    openScratch(code: string, name: string | null = null) {
      writeBuffer(SCRATCH.slug, {code, ...CANONICAL});
      setFileName(name);
      actions.loadExample(SCRATCH.slug, true);
    },
    /** Convert pasted Manim Python and open the result. */
    importPython(python: string) {
      const {code, notes} = pythonToCivet(python);
      setImportNotes(notes);
      actions.openScratch(code, null);
    },
    setImportOpen(open: boolean) {
      setImportOpen(open);
    },
    async openFile(file: File) {
      const text = await file.text();
      if (/\.py$/i.test(file.name)) actions.importPython(text);
      else actions.openScratch(text, file.name);
    },
    saveFile() {
      const name = fileName() ?? `${current.slug}.civet`;
      download(new Blob([current.source], {type: 'text/plain'}), name);
    },
    resetExample() {
      const ex = all.find(e => e.slug === current.slug)!;
      writeBuffer(current.slug, null);
      setDirty(false);
      replaceSource(pristine(ex, current.settings));
      void run();
    },
    setFlag<K extends keyof Settings>(key: K, value: Settings[K]) {
      const before = current.settings;
      if (before[key] === value) return;
      const after = {...before, [key]: value} as Settings;
      current.settings = after;
      setSettings(s => {
        (s as any)[key] = value;
      });
      persist();
      if (key === 'naming' || key === 'yieldStyle' || key === 'selfStyle') {
        const ex = all.find(e => e.slug === current.slug)!;
        if (ex.style === 'manim') {
          const converted = convertDialect(current.source, dialectOf(before), dialectOf(after));
          replaceSource(converted);
          const changed = converted !== pristine(ex, after);
          setDirty(changed);
          writeBuffer(current.slug, changed ? {code: converted, ...dialectOf(after)} : null);
        }
        void run();
      } else if (key === 'operators') {
        void run();
      } else if (key === 'quality') {
        const q = qualityOf(after.quality);
        current.fps = q.fps;
        setFps(q.fps);
        void engine.setQuality(q.fps, q.scale);
      } else if (key === 'runMode' && value === 'live') {
        void run();
      }
    },
    resetFlags() {
      for (const key of Object.keys(defaults) as (keyof Settings)[]) actions.setFlag(key, defaults[key]);
    },
    selectScene(name: string) {
      current.scene = name;
      setActiveScene(name);
      engine.selectScene(name);
    },
    togglePlayback(value?: boolean) {
      engine.togglePlayback(value);
    },
    seekFrame(f: number) {
      engine.seek(f);
    },
    seekTime(seconds: number) {
      engine.seek(seconds * current.fps);
    },
    step(delta: number) {
      engine.step(delta);
    },
    toggleLoop() {
      engine.toggleLoop();
    },
    setSpeed(value: number) {
      engine.setSpeed(value);
    },
    /** Jump to a timeline step and show its line. */
    goToSegment(index: number, revealInEditor = true) {
      const seg = current.timeline?.segments[index];
      if (!seg) return;
      engine.togglePlayback(false);
      // Land just inside the step so its mobjects are on screen.
      engine.seek(Math.round(seg.start * current.fps) + 1);
      if (revealInEditor && seg.line) setReveal({line: seg.line, tick: performance.now()});
    },
    revealLine(line: number | undefined) {
      if (line) setReveal({line, tick: performance.now()});
    },
    setCursorLine(line: number) {
      setCursorLineSignal(line);
      if (current.settings.cursorSync !== 'seek') return;
      const t = current.timeline;
      if (!t) return;
      const index = t.segments.findIndex(s => s.line === line);
      if (index >= 0) actions.goToSegment(index, false);
    },
    select(id: number | null) {
      current.selected = id;
      setSelected(id);
      refreshInspection();
    },
    pickAt(x: number, y: number) {
      actions.select(engine.pick(x, y));
    },
    setLabOpen(open: boolean) {
      setLabOpen(open);
    },
    setNotes(text: string) {
      setNotes(text);
    },
    async exportPng() {
      const blob = await engine.frameBlob();
      if (blob) download(blob, `${current.slug}-frame.png`);
    },
    async exportWebm() {
      setExporting(0);
      try {
        const blob = await engine.record(p => setExporting(p));
        if (blob) download(blob, `${current.slug}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      } finally {
        setExporting(null);
      }
    },
  };

  return {
    engine,
    examples: all,
    settings,
    example,
    exampleSlug,
    source,
    sourceVersion,
    compiled,
    diagnostics,
    timeline,
    frame,
    duration,
    fps,
    time,
    durationSeconds,
    paused,
    loop,
    speed,
    scenes,
    activeScene,
    selected,
    outline,
    info,
    selectionBounds,
    compileMs,
    importOpen,
    importNotes,
    fileName,
    canRecord: engine.canRecord(),
    reveal,
    cursorLine,
    labOpen,
    notes,
    dirty,
    exporting,
    status,
    currentSegment,
    activeLine,
    ...actions,
  };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type EditorState = ReturnType<typeof createEditorState>;
export const EditorContext = createContext<EditorState>();
export const useEditor = (): EditorState => useContext(EditorContext);
