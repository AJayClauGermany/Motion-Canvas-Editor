/**
 * Editor state: one object created by <App> and shared through context.
 * The engine and compiler are framework-agnostic; this module adapts them to
 * Solid signals and holds the actions the UI calls.
 */
import {createContext, createMemo, createSignal, createStore, reconcile, useContext} from 'solid-js';
import {compileScene, CompileResult, Diagnostic} from '../runtime/compile';
import {civetToTsx, tsxToCivet} from '../runtime/convert';
import {pythonToCivet} from '../runtime/python';
import {addedLines} from '../runtime/textdiff';
import {toAt, toCamelCase, toExplicitYield, toImplicitYield, toSelf, toSnakeCase} from '../runtime/dialect';
import {Engine, InspectInfo, ItemId, OutlineNode, SceneEntry, Timeline} from '../runtime/engine';
import {apiNames} from '../manim';
import {setAssetUrls} from '../runtime/assets';
import {createAgentBridge, namingOf} from './agent';
import {createAssetStore} from './assets';
import {Folder, folderSupported, pickFolder, rememberedFolder, rememberFolder} from './folder';
import {createProject, sceneOfFile} from './project';
import {BLANK_MANIM, BLANK_NATIVE, BLANK_NATIVE_TSX, Example, examples} from './examples';
import {createExporter, ExportFile, ExportRequest} from './export';
import {fileBase, lastScene, loadScenes, nameFromFile, newSceneId, rememberScene, saveScenes, SceneRecord, SCENES_KEY, sceneSlug, uniqueName} from './scenes';
import {defaults, hashParam, loadSettings, qualityOf, saveSettings, Settings} from './settings';

type Dialect = Pick<Settings, 'naming' | 'yieldStyle' | 'selfStyle'>;
const CANONICAL: Dialect = {naming: 'snake', yieldStyle: 'implicit', selfStyle: 'at'};

/** Rewrite Manim-style source from one dialect variant to another. */
export function convertDialect(code: string, from: Dialect, to: Dialect): string {
  if (!/^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(code)) {
    // A TSX scene on the Manim layer has no sugar to convert, only names.
    if (!/from\s*['"]manim['"]/.test(code) || from.naming === to.naming) return code;
    return to.naming === 'camel' ? toCamelCase(code) : toSnakeCase(code);
  }
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

export type Language = 'civet' | 'tsx';

/** Where a converted buffer came from, so switching back is lossless while it is unedited. */
interface Provenance {
  origin: {language: Language; code: string};
  generated: string;
}

interface StoredBuffer extends Dialect {
  code: string;
  language?: Language;
  provenance?: Provenance;
}
const bufferKey = (slug: string) => `mce.buffer.v2.${slug}`;
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

/** The starting text of a new scene, in each style. */
const SCRATCH: Example = {
  slug: 'scratch',
  title: 'Blank scene',
  description: 'An empty Manim-style scene to start from.',
  style: 'manim',
  order: 0,
  code: BLANK_MANIM,
};

const SCRATCH_NATIVE: Example = {
  slug: 'scratch-native',
  title: 'Blank scene',
  description: 'An empty Canvas Commons-style scene to start from.',
  style: 'canvas-commons',
  order: 0,
  code: BLANK_NATIVE,
  tsx: BLANK_NATIVE_TSX,
};

/** Every document is edited in the language chosen in the Lab. */
export const languageOf = (_example: Example, s: Settings): Language => s.language;

const isManimText = (code: string) => /^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(code) || /from\s*['"]manim['"]/.test(code);

/** The dialect a Civet scene from outside the editor is written in, as far as its text shows. */
const detectDialect = (code: string): Dialect => ({
  naming: namingOf(code),
  // Text with `yield*` written out passes through the implicit dialect unchanged.
  yieldStyle: 'implicit',
  selfStyle: /(?<![\w.$@])self\./.test(code) ? 'self' : 'at',
});

const toDoc = (r: SceneRecord): Example => ({slug: sceneSlug(r.id), title: r.name, description: '', style: r.style, order: 0, code: '', user: true});

/** What the export dialog shows. */
export type ExportJob =
  | {phase: 'idle'}
  | {phase: 'working'; request: ExportRequest; progress: number; realtime: boolean}
  | {phase: 'done'; request: ExportRequest; file: ExportFile; url: string; savedTo?: string}
  | {phase: 'error'; request: ExportRequest; message: string};

export function createEditorState() {
  const engine = new Engine();
  const initialSettings = loadSettings();

  // The author's own scenes, most recently edited first. Earlier builds kept
  // one "scratch" document per style: adopt them.
  let records = loadScenes().sort((a, b) => b.updated - a.updated);
  for (const [slug, style, name] of [
    ['scratch', 'manim', 'Scratch'],
    ['scratch-native', 'canvas-commons', 'Scratch (Canvas Commons)'],
  ] as const) {
    const old = readBuffer(slug);
    if (!old) continue;
    const record: SceneRecord = {id: newSceneId(), name: uniqueName(name, records.map(r => r.name)), style, created: Date.now(), updated: Date.now()};
    records = [record, ...records];
    writeBuffer(sceneSlug(record.id), old);
    writeBuffer(slug, null);
    saveScenes(records);
  }
  /** Every document that can be opened: the bundled examples and the author's scenes. */
  const all: Example[] = [...examples, ...records.map(toDoc)];
  const sceneDocs = () => records.map(r => all.find(e => e.slug === sceneSlug(r.id))!);

  const compileOptionsOf = (s: Settings) => ({
    implicitYield: s.yieldStyle === 'implicit',
    operators: s.operators === 'on',
    hashComments: true,
  });
  const pristineCache = new Map<string, string>();
  /** The untouched example in the current language and dialect. */
  const pristine = (example: Example, s: Settings): string => {
    const key = `${example.slug}|${s.language}|${s.naming}|${s.yieldStyle}|${s.selfStyle}`;
    let code = pristineCache.get(key);
    if (code === undefined) {
      const civet = example.style === 'manim' ? convertDialect(example.code, CANONICAL, dialectOf(s)) : example.code;
      if (s.language === 'civet') code = civet;
      // A native example ships its TSX; anything else is generated from the Civet.
      else code = example.style === 'canvas-commons' && example.tsx !== undefined ? example.tsx : civetToTsx(civet, apiNames, compileOptionsOf(s)).code;
      pristineCache.set(key, code);
    }
    return code;
  };
  /** Convert a buffer to another language; lossless back to its origin while unedited. */
  const convertLanguage = (
    code: string,
    from: Language,
    to: Language,
    s: Settings,
    provenance?: Provenance,
  ): {code: string; ok: boolean; notes: string[]; provenance?: Provenance} => {
    if (from === to) return {code, ok: true, notes: [], provenance};
    if (provenance && provenance.generated === code && provenance.origin.language === to) {
      return {code: provenance.origin.code, ok: true, notes: []};
    }
    const result = to === 'tsx' ? civetToTsx(code, apiNames, compileOptionsOf(s)) : tsxToCivet(code, compileOptionsOf(s));
    if (!result.ok) return {code, ok: false, notes: result.notes};
    // tsxToCivet leaves `yield*` explicit and `@`; apply the chosen dialect on top.
    const out =
      to === 'civet' ? convertDialect(result.code, {naming: s.naming, yieldStyle: 'explicit', selfStyle: 'at'}, dialectOf(s)) : result.code;
    return {code: out, ok: true, notes: result.notes, provenance: {origin: {language: from, code}, generated: out}};
  };
  /** The text a new scene starts with, in the current language and dialect. */
  const starter = (style: Example['style'], s: Settings) => pristine(style === 'manim' ? SCRATCH : SCRATCH_NATIVE, s);
  const bufferFor = (example: Example, s: Settings): {code: string; provenance?: Provenance} => {
    const stored = readBuffer(example.slug);
    if (!stored) return {code: example.user ? starter(example.style, s) : pristine(example, s)};
    const language = stored.language ?? 'civet';
    if (language !== s.language) {
      const converted = convertLanguage(stored.code, language, s.language, s, stored.provenance);
      // If it cannot be converted, the untouched example is better than the wrong language.
      return converted.ok ? converted : {code: pristine(example, s)};
    }
    return {
      code: language === 'civet' ? convertDialect(stored.code, stored, dialectOf(s)) : stored.code,
      provenance: stored.provenance,
    };
  };
  /** Save (or clear) the current document's edits. */
  const store = (example: Example, s: Settings, code: string | null, provenance?: Provenance) =>
    writeBuffer(example.slug, code === null ? null : {code, ...dialectOf(s), language: s.language, provenance});
  const hasEdits = (example: Example, _s: Settings) => !example.user && readBuffer(example.slug) !== null;
  /** Save the open document's text. Returns whether it differs from the bundled example. */
  const keep = (example: Example, s: Settings, code: string, provenance?: Provenance): boolean => {
    if (example.user) {
      store(example, s, code, provenance);
      project.changed(example.slug);
      // Keep the list ordered by last edit without rewriting it on every keystroke.
      const record = records.find(r => sceneSlug(r.id) === example.slug);
      if (record && Date.now() - record.updated > 60_000) {
        record.updated = Date.now();
        records = [record, ...records.filter(r => r !== record)];
        syncScenes();
      }
      return false;
    }
    const changed = code !== pristine(example, s);
    store(example, s, changed ? code : null, provenance);
    return changed;
  };
  /** Store a new scene of the author's own and return its document (no signals: usable during setup). */
  const storeScene = (name: string, style: Example['style'], code: string, language: Language, dialect: Dialect, provenance?: Provenance): Example => {
    const record: SceneRecord = {id: newSceneId(), name: uniqueName(name, records.map(r => r.name)), style, created: Date.now(), updated: Date.now()};
    records = [record, ...records];
    const doc = toDoc(record);
    all.push(doc);
    writeBuffer(doc.slug, {code, naming: dialect.naming, yieldStyle: dialect.yieldStyle, selfStyle: dialect.selfStyle, language, provenance});
    saveScenes(records);
    return doc;
  };

  const initialSlug = (() => {
    const linked = all.find(e => e.slug === hashParam('example'));
    if (linked) return linked.slug;
    if (initialSettings.startup === 'example') return examples[0].slug;
    const mine = all.find(e => e.user && e.slug === lastScene()) ?? all.find(e => e.user);
    if (mine) return mine.slug;
    // First launch: a scene of the author's own to start writing in.
    return storeScene('Untitled', 'manim', starter('manim', initialSettings), initialSettings.language, dialectOf(initialSettings)).slug;
  })();
  const [myScenes, setMyScenes] = createSignal<Example[]>(sceneDocs());
  /** Bumped when a scene is added, renamed or removed. */
  const [docsVersion, setDocsVersion] = createSignal(0);
  const syncScenes = () => {
    saveScenes(records);
    setMyScenes(sceneDocs());
    setDocsVersion(v => v + 1);
  };
  // Another tab of the editor changed the list of scenes: take its additions,
  // renames and deletions, so that saving the list here does not undo them.
  window.addEventListener('storage', e => {
    if (e.key !== SCENES_KEY) return;
    const stored = loadScenes();
    const ids = new Set(stored.map(r => r.id));
    for (const r of stored) {
      const mine = records.find(x => x.id === r.id);
      if (!mine) {
        records.push(r);
        all.push(toDoc(r));
      } else {
        Object.assign(mine, r);
        const at = all.findIndex(e => e.slug === sceneSlug(r.id));
        if (at >= 0 && all[at].title !== r.name) all[at] = toDoc(mine);
      }
    }
    for (const r of [...records]) {
      // The scene open here stays, even if the other tab deleted it.
      if (ids.has(r.id) || sceneSlug(r.id) === current.slug) continue;
      records = records.filter(x => x !== r);
      const at = all.findIndex(e => e.slug === sceneSlug(r.id));
      if (at >= 0) all.splice(at, 1);
    }
    records.sort((a, b) => b.updated - a.updated);
    setMyScenes(sceneDocs());
    setDocsVersion(v => v + 1);
  });
  const addScene = (...args: Parameters<typeof storeScene>): Example => {
    const doc = storeScene(...args);
    syncScenes();
    project.changed(doc.slug);
    return doc;
  };
  const initialDoc = all.find(e => e.slug === initialSlug)!;
  // A scene of the author's own decides its language, like a file does.
  const initialLanguage = initialDoc.user ? readBuffer(initialSlug)?.language : undefined;
  if (initialLanguage) initialSettings.language = initialLanguage;
  if (initialDoc.user) rememberScene(initialSlug);
  const [settings, setSettings] = createStore<Settings>(initialSettings);

  const initialBuffer = bufferFor(initialDoc, initialSettings);
  const initialSource = initialBuffer.code;
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
  const [selected, setSelected] = createSignal<ItemId | null>(null);
  const [outline, setOutline] = createStore<{nodes: OutlineNode[]}>({nodes: []});
  const [info, setInfo] = createSignal<InspectInfo | null>(null);
  const [selectionBounds, setSelectionBounds] = createSignal<[number, number, number, number] | null>(null);
  const [compileMs, setCompileMs] = createSignal<number | null>(null);
  const [reveal, setReveal] = createSignal<{line: number; tick: number} | null>(null);
  const [cursorLine, setCursorLineSignal] = createSignal(1);
  const [labOpen, setLabOpen] = createSignal(hashParam('lab') === '1');
  const [notes, setNotes] = createSignal('');
  const [dirty, setDirty] = createSignal(hasEdits(all.find(e => e.slug === initialSlug)!, initialSettings));
  const [exporting, setExporting] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [importOpen, setImportOpen] = createSignal(false);
  const [importNotes, setImportNotes] = createSignal<string[]>([]);
  const [exportOpen, setExportOpenSignal] = createSignal(false);
  const [exportJob, setExportJob] = createSignal<ExportJob>({phase: 'idle'});
  /** The project folder: connected, or remembered but waiting for the browser's permission (`locked`). */
  const [folderState, setFolderState] = createSignal<{name: string; locked: boolean} | null>(null);
  /** How many sounds the open scene plays. */
  const [soundCount, setSoundCount] = createSignal(0);
  const [audible, setAudibleSignal] = createSignal(true);
  /** The code pane's editor, for actions that type into it (set by the pane). */
  let codeEditor: {insertLine(text: string): void} | null = null;
  /** Lines (1-based) the agent's last edit added or changed, until the author edits again. */
  const [agentLines, setAgentLines] = createSignal<number[]>([]);
  /** Messages about the last language conversion, shown under the code pane header. */
  const [notice, setNotice] = createSignal<string[]>([]);

  // Plain mirrors of signal state for use inside actions (reads lag writes).
  let current = {
    source: initialSource,
    slug: initialSlug,
    settings: {...initialSettings} as Settings,
    timeline: null as Timeline | null,
    selected: null as ItemId | null,
    provenance: initialBuffer.provenance as Provenance | undefined,
    fps: engine.fps,
    scene: null as string | null,
  };

  const example = createMemo(() => {
    docsVersion();
    return all.find(e => e.slug === exampleSlug()) ?? all[0];
  });
  /** Language of the open document (`civet`, or `tsx` for native scenes when chosen). */
  const language = createMemo<Language>(() => languageOf(example(), settings as Settings));
  /** Whether the open document uses the Manim vocabulary or Canvas Commons' own. */
  const vocabulary = createMemo<'manim' | 'native'>(() => (isManimText(source()) ? 'manim' : 'native'));
  /** The file name of one of the author's scenes; null for a bundled example. */
  const fileName = createMemo<string | null>(() => (example().user ? `${fileBase(example().title)}.${language()}` : null));
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
  engine.on('sounds', count => setSoundCount(count));
  engine.audible = true;

  // Sound clips, by file name. A change re-runs the scene: a clip that was missing may be there now.
  const assets = createAssetStore(urls => {
    setAssetUrls(urls);
    if (assetsLoaded) void run();
  });
  let assetsLoaded = false;
  const assetsReady = assets
    .refresh()
    .catch(() => {})
    .then(() => {
      assetsLoaded = true;
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
    await assetsReady;
    if (ticket !== runCount) return;
    const started = performance.now();
    const s = current.settings;
    const result = compileScene(current.source, {...compileOptionsOf(s), language: s.language});
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
    setStatus('ok');
  };
  const scheduleRun = () => {
    clearTimeout(runTimer);
    if (current.settings.runMode === 'live') runTimer = window.setTimeout(run, 250);
  };

  const persist = () => {
    // The link names a bundled example; the author's own scenes exist in this browser only.
    const ex = all.find(e => e.slug === current.slug);
    const implied = !ex || ex.user || (current.settings.startup === 'example' && ex.slug === examples[0].slug);
    saveSettings(current.settings, {example: implied ? '' : current.slug});
  };

  /** Whether the buffer was last replaced by another document (rather than a change to this one). */
  let docSwitched = false;
  /** Replace the buffer from outside the code editor. `switched`: with another document's text. */
  const replaceSource = (code: string, switched = false) => {
    if (switched) docSwitched = true;
    current.source = code;
    setSourceSignal(code);
    setSourceVersion(v => v + 1);
  };

  /** Record a Lab choice without side effects on the open document. */
  const commitFlag = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    current.settings = {...current.settings, [key]: value} as Settings;
    setSettings(s => {
      (s as any)[key] = value;
    });
    persist();
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
      setDirty(keep(ex, current.settings, code, current.provenance));
      if (notice().length) setNotice([]);
      if (agentLines().length) setAgentLines([]);
      scheduleRun();
    },
    run,
    /**
     * Replace the buffer with text from outside the editor (an AI agent): an
     * undoable change in the code pane, persisted and run like typing.
     */
    applyExternal(code: string, note: string) {
      if (code === current.source) return;
      const changed = addedLines(current.source, code);
      replaceSource(code);
      setAgentLines(changed);
      const ex = all.find(e => e.slug === current.slug)!;
      setDirty(keep(ex, current.settings, code, current.provenance));
      setNotice([`Agent: ${note}. The changed lines are marked; undo with Ctrl/Cmd+Z.`]);
      void run();
    },
    loadExample(slug: string, autoplay = true) {
      const ex = all.find(e => e.slug === slug);
      if (!ex) return;
      if (ex.user) {
        rememberScene(slug);
        // A scene of the author's own decides its language, like a file does.
        const stored = readBuffer(slug)?.language;
        if (stored && stored !== current.settings.language) commitFlag('language', stored);
      }
      current.slug = slug;
      current.scene = null;
      current.selected = null;
      setSelected(null);
      setExampleSlug(slug);
      setDirty(hasEdits(ex, current.settings));
      const buffer = bufferFor(ex, current.settings);
      current.provenance = buffer.provenance;
      setNotice([]);
      setAgentLines([]);
      replaceSource(buffer.code, true);
      persist();
      engine.togglePlayback(false);
      void run().then(() => {
        engine.seek(0);
        if (autoplay) engine.togglePlayback(true);
      });
    },
    /**
     * Open source text as a new scene of the author's own, in TSX when the
     * file says so. Nothing that is already open is replaced.
     */
    openScratch(code: string, name: string | null = null, as?: Language, dialect: Dialect = CANONICAL) {
      const language: Language = as ?? (!!name && /\.(tsx?|jsx?)$/i.test(name) ? 'tsx' : 'civet');
      const doc = addScene(name ? nameFromFile(name) : 'Untitled', isManimText(code) ? 'manim' : 'canvas-commons', code, language, dialect);
      actions.loadExample(doc.slug, true);
    },
    /** A new scene from the starter text, in the style of the open one unless told otherwise. */
    newScene(style?: Example['style']) {
      const s = current.settings;
      const kind = style ?? (isManimText(current.source) ? 'manim' : 'canvas-commons');
      const doc = addScene('Untitled', kind, starter(kind, s), s.language, dialectOf(s));
      actions.loadExample(doc.slug, true);
    },
    /** A copy of the open document as a scene of the author's own. */
    duplicateScene() {
      const ex = all.find(e => e.slug === current.slug)!;
      const s = current.settings;
      const doc = addScene(ex.user ? `${ex.title} copy` : ex.title, isManimText(current.source) ? 'manim' : 'canvas-commons', current.source, s.language, dialectOf(s), current.provenance);
      actions.loadExample(doc.slug, true);
    },
    renameScene(name: string) {
      const ex = all.find(e => e.slug === current.slug)!;
      const record = records.find(r => sceneSlug(r.id) === ex.slug);
      const wanted = name.trim();
      if (!record || !wanted || wanted === record.name) return;
      record.name = uniqueName(wanted, records.filter(r => r !== record).map(r => r.name));
      all[all.indexOf(ex)] = toDoc(record);
      syncScenes();
      project.changed(ex.slug);
    },
    /** Remove the open scene (one of the author's own) and open the next one. */
    deleteScene() {
      const ex = all.find(e => e.slug === current.slug)!;
      if (!ex.user) return;
      void project.removed(records.find(r => sceneSlug(r.id) === ex.slug)?.file);
      forget(ex.slug);
    },
    /** Keep the author's scenes in a folder on disk from now on (asks which). */
    async chooseFolder() {
      let folder: Folder;
      try {
        folder = await pickFolder();
      } catch {
        return; // Cancelled.
      }
      if (!(await folder.allowed(true))) return;
      await rememberFolder(folder);
      await useFolder(folder, true);
    },
    /** After a reload the browser wants a click before the folder may be used again. */
    async reconnectFolder() {
      const folder = project.remembered();
      if (folder && (await folder.allowed(true))) await useFolder(folder, false);
    },
    async disconnectFolder() {
      project.disconnect();
      await rememberFolder(null);
      await assets.setFolder(null);
    },
    /** Add sound clips to the project. */
    async addSounds(files: Iterable<File>) {
      const problems: string[] = [];
      for (const file of files) {
        try {
          await assets.add(file, file.name);
        } catch (e) {
          problems.push((e as Error).message);
        }
      }
      if (problems.length) setNotice(problems);
    },
    removeSound(name: string) {
      void assets.remove(name);
    },
    /** Put the line that plays a clip on the line after the cursor. */
    insertSound(name: string) {
      const s = current.settings;
      const quoted = JSON.stringify(name);
      let line: string;
      if (isManimText(current.source)) {
        const method = s.naming === 'camel' ? 'addSound' : 'add_sound';
        line = s.language === 'tsx' ? `this.${method}(${quoted});` : `${s.selfStyle === 'self' ? 'self.' : '@'}${method} ${quoted}`;
      } else {
        line = s.language === 'tsx' ? `sound(${quoted}).play();` : `sound(${quoted}).play()`;
        if (!/\bsound\b[^\n]*from\s*['"]@(canvas-commons|motion-canvas)\/core['"]/.test(current.source)) {
          setNotice(['`sound` comes from "@canvas-commons/core": add it to that import.']);
        }
      }
      codeEditor?.insertLine(line);
    },
    /** For the code pane: whether the new buffer is another document, whose undo history must start empty. */
    takeDocSwitch() {
      const value = docSwitched;
      docSwitched = false;
      return value;
    },
    /** The code pane hands over its editor (null when it goes away). */
    attachCodeEditor(editor: {insertLine(text: string): void} | null) {
      codeEditor = editor;
    },
    setAudible(value: boolean) {
      setAudibleSignal(value);
      engine.setAudible(value);
    },
    /**
     * Translate Manim Python into the author's language and dialect:
     * Python → Civet, then on to TSX when TSX is chosen.
     */
    convertPython(python: string): {code: string; notes: string[]; language: Language} {
      const s = current.settings;
      const {code, notes} = pythonToCivet(python);
      const tsx = s.language === 'tsx' ? civetToTsx(code, apiNames, compileOptionsOf(s)) : null;
      if (tsx?.ok) return {code: tsx.code, notes, language: 'tsx'};
      return {code: convertDialect(code, CANONICAL, dialectOf(s)), notes, language: 'civet'};
    },
    /** Convert pasted Manim Python and open the result. */
    importPython(python: string, name: string | null = null) {
      const {code, notes, language} = actions.convertPython(python);
      setImportNotes(notes);
      actions.openScratch(code, name, language, dialectOf(current.settings));
    },
    setImportOpen(open: boolean) {
      setImportOpen(open);
    },
    async openFile(file: File) {
      const text = await file.text();
      if (/\.py$/i.test(file.name)) actions.importPython(text, file.name);
      else actions.openScratch(text, file.name);
    },
    /** The open document's name without an extension, for exported files. */
    exportBaseName() {
      const ex = all.find(e => e.slug === current.slug)!;
      return ex.user ? fileBase(ex.title) : ex.slug;
    },
    resetExample() {
      const ex = all.find(e => e.slug === current.slug)!;
      store(ex, current.settings, null);
      current.provenance = undefined;
      setNotice([]);
      setDirty(false);
      replaceSource(pristine(ex, current.settings));
      void run();
    },
    setFlag<K extends keyof Settings>(key: K, value: Settings[K]) {
      const before = current.settings;
      if (before[key] === value) return;
      const after = {...before, [key]: value} as Settings;
      if (key === 'language') {
        // Convert the open scene first: if that fails, the language stays.
        const ex = all.find(e => e.slug === current.slug)!;
        if (!ex.user && current.source === pristine(ex, before)) {
          commitFlag(key, value);
          current.provenance = undefined;
          setNotice([]);
          setDirty(false);
          replaceSource(pristine(ex, after));
        } else {
          const converted = convertLanguage(current.source, before.language, after.language, after, current.provenance);
          setNotice(converted.notes);
          if (!converted.ok) return;
          commitFlag(key, value);
          current.provenance = converted.provenance;
          replaceSource(converted.code);
          setDirty(keep(ex, after, converted.code, converted.provenance));
        }
        void run();
        return;
      }
      commitFlag(key, value);
      if (key === 'naming' || key === 'yieldStyle' || key === 'selfStyle') {
        const ex = all.find(e => e.slug === current.slug)!;
        if (ex.style === 'manim') {
          const converted = convertDialect(current.source, dialectOf(before), dialectOf(after));
          replaceSource(converted);
          setDirty(keep(ex, after, converted, current.provenance));
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
    select(id: ItemId | null) {
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
    setExportOpen(open: boolean) {
      if (!open && exportJob().phase === 'working') return;
      setExportOpenSignal(open);
      if (!open) actions.clearExport();
    },
    /** Forget the last export (and free its file). */
    clearExport() {
      const job = exportJob();
      if (job.phase === 'working') return;
      if (job.phase === 'done') URL.revokeObjectURL(job.url);
      setExportJob({phase: 'idle'});
    },
    cancelExport() {
      exportControl.cancelled = true;
    },
    /** Export the open scene and hand the file to the browser. */
    async exportScene(request: ExportRequest): Promise<void> {
      if (exportJob().phase === 'working') return;
      actions.clearExport();
      exportControl = {cancelled: false};
      setExportJob({phase: 'working', request, progress: 0, realtime: false});
      try {
        const file = await exporter.run(
          request,
          (progress, realtime) => {
            setExportJob({phase: 'working', request, progress, realtime});
            setExporting(realtime ? progress : null);
          },
          exportControl,
        );
        const url = URL.createObjectURL(file.blob);
        // With a project folder the file goes next to the scenes; otherwise to the browser's downloads.
        const folder = project.folder();
        const savedTo = folder ? await folder.writeExport(file.fileName, file.blob).catch(() => undefined) : undefined;
        if (!savedTo) triggerDownload(url, file.fileName);
        setExportJob({phase: 'done', request, file, url, savedTo});
      } catch (e) {
        if ((e as Error).name === 'ExportCancelled') setExportJob({phase: 'idle'});
        else setExportJob({phase: 'error', request, message: (e as Error).message ?? String(e)});
      } finally {
        setExporting(null);
      }
    },
  };

  /** Remove one of the author's scenes from the editor (its file is not touched). */
  const forget = (slug: string) => {
    const ex = all.find(e => e.slug === slug);
    if (!ex?.user) return;
    records = records.filter(r => sceneSlug(r.id) !== slug);
    all.splice(all.indexOf(ex), 1);
    writeBuffer(slug, null);
    syncScenes();
    if (slug !== current.slug) return;
    const next = all.find(e => e.user);
    if (next) actions.loadExample(next.slug, false);
    else actions.newScene('manim');
  };

  // The project folder: `project.ts` decides what to read and write, this applies it.
  const project = createProject(
    {
      scenes: () =>
        records.map(r => {
          const slug = sceneSlug(r.id);
          const stored = readBuffer(slug);
          return {slug, name: r.name, language: stored?.language ?? 'civet', text: slug === current.slug ? current.source : (stored?.code ?? ''), file: r.file, pending: r.pending, synced: r.synced};
        }),
      openSlug: () => current.slug,
      adopt(file, text) {
        const {name, language} = sceneOfFile(file);
        // The file keeps its name; a scene that only lives in the browser makes room.
        const clash = records.find(r => !r.file && r.name.toLowerCase() === name.toLowerCase());
        if (clash) {
          clash.name = uniqueName(name, [name, ...records.map(r => r.name)]);
          const at = all.findIndex(e => e.slug === sceneSlug(clash.id));
          if (at >= 0) all[at] = toDoc(clash);
        }
        const doc = storeScene(name, isManimText(text) ? 'manim' : 'canvas-commons', text, language, detectDialect(text));
        records.find(r => sceneSlug(r.id) === doc.slug)!.file = file;
        syncScenes();
      },
      reload(slug, text) {
        const stored = readBuffer(slug);
        const language = stored?.language ?? 'civet';
        const dialect = detectDialect(text);
        writeBuffer(slug, {code: text, ...dialect, language});
        if (slug !== current.slug) return;
        const shown = language === 'civet' ? convertDialect(text, dialect, dialectOf(current.settings)) : text;
        if (shown === current.source) return;
        current.provenance = undefined;
        replaceSource(shown);
        setAgentLines([]);
        setNotice([`Reloaded: ${records.find(r => sceneSlug(r.id) === slug)?.file ?? 'the file'} changed on disk.`]);
        void run();
      },
      moved(slug, file) {
        const record = records.find(r => sceneSlug(r.id) === slug);
        if (!record) return;
        record.name = uniqueName(sceneOfFile(file).name, records.filter(r => r !== record).map(r => r.name));
        record.file = file;
        const at = all.findIndex(e => e.slug === slug);
        if (at >= 0) all[at] = toDoc(record);
        syncScenes();
      },
      drop: forget,
      mark(slug, file, pending, synced) {
        const record = records.find(r => sceneSlug(r.id) === slug);
        if (!record || (record.file === file && !!record.pending === pending && (synced === undefined || record.synced === synced))) return;
        record.file = file;
        record.pending = pending || undefined;
        if (synced !== undefined) record.synced = synced;
        else if (!file) record.synced = undefined;
        saveScenes(records);
      },
      status: state => setFolderState(state),
      notify: message => setNotice([message]),
    },
    {onPoll: () => void assets.refresh()},
  );
  const useFolder = async (folder: Folder, fresh: boolean) => {
    try {
      await project.connect(folder, fresh);
      await assets.setFolder(folder, fresh);
    } catch (e) {
      setNotice([`The folder "${folder.name}" could not be used: ${(e as Error).message}`]);
    }
  };
  // The folder used last time. The browser may want a click first ("locked").
  if (folderSupported()) {
    void rememberedFolder().then(async folder => {
      if (!folder) return;
      if (await folder.allowed(false)) await useFolder(folder, false);
      else project.hold(folder);
    });
  }

  let exportControl = {cancelled: false};
  const exporter = createExporter({
    engine,
    getSource: actions.getSource,
    compileOptions: () => ({...compileOptionsOf(current.settings), language: current.settings.language}),
    baseName: () => actions.exportBaseName() + (engine.scenes.length > 1 && current.scene ? `-${fileBase(current.scene)}` : ''),
    title: () => all.find(e => e.slug === current.slug)?.title ?? 'Scene',
    activeScene: () => current.scene,
    previewFps: () => current.fps,
    time: () => engine.frame / current.fps,
    assets,
    soundCount: () => engine.sounds().length,
  });

  const agent = createAgentBridge({
    examples,
    myScenes,
    settings: settings as Settings,
    getSource: actions.getSource,
    example,
    exampleSlug,
    language,
    vocabulary,
    fileName,
    dirty,
    status,
    diagnostics,
    timeline,
    time,
    durationSeconds,
    scenes,
    activeScene,
    selected,
    info,
    cursorLine,
    compileOptions: () => compileOptionsOf(current.settings),
    adaptDialect: (code, from) => convertDialect(code, from, dialectOf(current.settings)),
    convertForReading: (code, to) => convertLanguage(code, current.settings.language, to, current.settings),
    applyExternal: actions.applyExternal,
    notify: lines => setNotice(lines),
    loadExample: actions.loadExample,
    openScratch: (code, name, as) => actions.openScratch(code, name, as, dialectOf(current.settings)),
    revealLine: actions.revealLine,
    seekTime: actions.seekTime,
    goToSegment: actions.goToSegment,
    togglePlayback: actions.togglePlayback,
    exporter,
    assets,
    folder: folderState,
  });

  return {
    engine,
    agent,
    examples,
    myScenes,
    settings,
    example,
    language,
    vocabulary,
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
    notice,
    agentLines,
    fileName,
    assets,
    folder: folderState,
    folderSupported: folderSupported(),
    soundCount,
    audible,
    exportOpen,
    exportJob,
    /** Hosted previews (claude.ai artifacts) cannot hand files to the viewer. */
    canDownload,
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

const canDownload = typeof (globalThis as any).claude === 'undefined';

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

export type EditorState = ReturnType<typeof createEditorState>;
export const EditorContext = createContext<EditorState>();
export const useEditor = (): EditorState => useContext(EditorContext);
