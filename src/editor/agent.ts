/**
 * The editor's side of the agent bridge (see src/mcp/): connects to the hub
 * of a local MCP server over a WebSocket and answers its calls with the
 * editor's state and actions.
 *
 * Code an agent sends is converted to the document's language and dialect
 * first (`normalizeSource`). Scenes it wants checked or rendered run in a
 * hidden harness iframe, a separate engine, so the user's preview, playhead
 * and selection never move. In "review" mode an edit waits for the user.
 */
import {createSignal} from 'solid-js';
import type {Accessor} from 'solid-js';
import {apiNames} from '../manim';
import type {CompileOptions, Diagnostic} from '../runtime/compile';
import {compileScene} from '../runtime/compile';
import type {Language} from '../runtime/convert';
import {knownNames} from '../runtime/dialect';
import {sceneHints} from '../runtime/hints';
import {declareAssignments, InputLanguage, normalizeSource, repairSnippet} from '../runtime/normalize';
import type {InspectInfo, ItemId, SceneEntry, Timeline} from '../runtime/engine';
import {
  CallMessage,
  DEFAULT_HUB_PORT,
  Edit,
  EditorMethods,
  EditorSnapshot,
  EditResult,
  InspectItem,
  InspectResult,
  PageMessage,
  PROTOCOL_VERSION,
  RenderResult,
  RunReport,
} from '../mcp/protocol';
import type {Example} from './examples';
import type {Settings} from './settings';
import {hashParam} from './settings';

/** What the bridge needs from the editor state (kept narrow on purpose). */
export interface AgentHost {
  examples: Example[];
  settings: Settings;
  getSource(): string;
  example: Accessor<Example>;
  exampleSlug: Accessor<string>;
  language: Accessor<Language>;
  vocabulary: Accessor<'manim' | 'native'>;
  fileName: Accessor<string | null>;
  dirty: Accessor<boolean>;
  status: Accessor<'idle' | 'running' | 'ok' | 'error'>;
  diagnostics: Accessor<Diagnostic[]>;
  timeline: Accessor<Timeline | null>;
  time: Accessor<number>;
  durationSeconds: Accessor<number>;
  scenes: Accessor<SceneEntry[]>;
  activeScene: Accessor<string | null>;
  selected: Accessor<ItemId | null>;
  info: Accessor<InspectInfo | null>;
  cursorLine: Accessor<number>;
  compileOptions(): CompileOptions;
  /** Rewrite Civet in canonical Manim dialect into the user's dialect. */
  adaptDialect(code: string, from: {naming: 'snake' | 'camel'; yieldStyle: 'implicit' | 'explicit'; selfStyle: 'at' | 'self'}): string;
  /** Convert the document to the other language, for reading. */
  convertForReading(code: string, to: Language): {ok: boolean; code: string; notes: string[]};
  /** Replace the document as an edit the user can undo, persist it and run it. */
  applyExternal(code: string, note: string): void;
  /** Show a short message above the code. */
  notify(lines: string[]): void;
  loadExample(slug: string, autoplay?: boolean): void;
  openScratch(code: string, name: string | null, language: Language): void;
  revealLine(line: number | undefined): void;
  seekTime(seconds: number): void;
  goToSegment(index: number, reveal?: boolean): void;
  togglePlayback(value?: boolean): void;
}

export type AgentStatus = 'off' | 'connecting' | 'connected' | 'waiting';

export interface AgentProposal {
  id: number;
  summary: string;
  before: string;
  after: string;
  notes: string[];
  diagnostics: Diagnostic[];
  run?: RunReport;
}

export interface AgentLogEntry {
  time: number;
  text: string;
  tone: 'info' | 'ok' | 'warn';
}

const STORAGE_KEY = 'mce.agent.v1';
const isDesktop = () => typeof (window as any).__electrobunSendToHost === 'function';

function loadPrefs(): {enabled: boolean; port: number} {
  let stored: {enabled?: boolean; port?: number} = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    // Storage can be unavailable.
  }
  const hashPort = Number(hashParam('agentPort'));
  const hashOn = hashParam('agent');
  return {
    enabled: hashOn === '1' ? true : hashOn === '0' ? false : !!stored.enabled,
    port: Number.isInteger(hashPort) && hashPort > 0 ? hashPort : (stored.port ?? DEFAULT_HUB_PORT),
  };
}

/** FNV-1a: a short, stable fingerprint of the source. */
export function revisionOf(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const isManimSource = (code: string) => /^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(code) || /from\s*['"]manim['"]/.test(code);

/** Which spelling the code mostly uses for Manim-layer names. */
function namingOf(code: string): 'snake' | 'camel' {
  const known = knownNames();
  let snake = 0;
  let camel = 0;
  for (const m of code.matchAll(/\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)\b/g)) {
    if (!known.has(m[1])) continue;
    if (m[1].includes('_')) snake++;
    else camel++;
  }
  return camel > snake ? 'camel' : 'snake';
}

// ---------------------------------------------------------------- sandbox

/** The harness page in a hidden iframe: a second engine for agent runs. */
class Sandbox {
  private ready: Promise<any> | null = null;

  private load(): Promise<any> {
    const frame = document.createElement('iframe');
    frame.src = new URL('harness.html?agent', location.href).href;
    frame.title = 'Agent preview sandbox';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Off-screen but rendered: a `display: none` frame gets no canvas updates in some engines.
    Object.assign(frame.style, {position: 'fixed', left: '-10000px', top: '0', width: '960px', height: '540px', border: '0', opacity: '0', pointerEvents: 'none'});
    document.body.append(frame);
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        const agent = (frame.contentWindow as any)?.harnessAgent;
        if (agent) return resolve(agent);
        if (performance.now() - started > 30_000) {
          frame.remove();
          this.ready = null;
          return reject(new Error('The preview sandbox (harness.html) did not load. The single-file build does not include it.'));
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  public agent(): Promise<any> {
    return (this.ready ??= this.load());
  }
}

// ----------------------------------------------------------------- bridge

export function createAgentBridge(host: AgentHost) {
  const prefs = loadPrefs();
  const [enabled, setEnabledSignal] = createSignal(prefs.enabled);
  const [port, setPortSignal] = createSignal(prefs.port);
  const [status, setStatus] = createSignal<AgentStatus>('off');
  const [log, setLog] = createSignal<AgentLogEntry[]>([]);
  const [proposal, setProposal] = createSignal<AgentProposal | null>(null);
  const sandbox = new Sandbox();
  let current = {enabled: prefs.enabled, port: prefs.port};
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let backoff = 1000;
  let decide: ((accepted: boolean) => void) | null = null;
  let proposalId = 0;

  const note = (text: string, tone: AgentLogEntry['tone'] = 'info') =>
    setLog(list => [{time: Date.now(), text, tone}, ...list].slice(0, 12));
  const savePrefs = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Storage can be unavailable.
    }
  };

  // --------------------------------------------------------- helpers

  const memberNames = () => knownNames();
  const opts = () => ({...host.compileOptions(), language: host.language()});
  const staticCheck = (code: string, language: Language) => ({
    diagnostics: compileScene(code, {...host.compileOptions(), language}).diagnostics,
    hints: sceneHints(code, {language, apiNames, memberNames: memberNames(), implicitYield: host.compileOptions().implicitYield}),
  });
  const runInSandbox = async (code: string, language: Language): Promise<RunReport> => {
    const agent = await sandbox.agent();
    return agent.check(code, {...host.compileOptions(), language});
  };

  /** Convert submitted code to the document's language and dialect. */
  const toDocument = (code: string, from: InputLanguage | 'auto' = 'auto') => {
    const language = host.language();
    const r = normalizeSource(code, language, {apiNames, from, compile: host.compileOptions()});
    if (!r.ok) return {ok: false as const, error: r.error ?? 'Could not convert the code.', conversion: {from: r.from, to: language, notes: r.notes}};
    let out = r.code;
    if (isManimSource(out)) {
      const dialect = {
        naming: namingOf(out),
        // Converted Civet may lack `yield*`; "implicit" adds what explicit mode needs.
        yieldStyle: 'implicit' as const,
        selfStyle: /(?<![\w.$@])self\./.test(out) ? ('self' as const) : ('at' as const),
      };
      const adapted = host.adaptDialect(out, dialect);
      if (adapted !== out) r.notes.push(`Adapted to the document's dialect (${host.settings.naming}_case${language === 'civet' ? `, ${host.settings.yieldStyle} yield*, ${host.settings.selfStyle === 'at' ? '@' : 'self.'}` : ''}).`);
      out = adapted;
    }
    return {ok: true as const, code: out, conversion: {from: r.from, to: language, notes: r.notes}};
  };

  const snapshot = (params: {includeSource?: boolean; as?: Language} = {}): EditorSnapshot => {
    const source = host.getSource();
    const language = host.language();
    const t = host.timeline();
    const selection = host.selected() !== null ? host.info() : null;
    const s = host.settings;
    const snap: EditorSnapshot = {
      document: {
        slug: host.exampleSlug(),
        title: host.example().title,
        fileName: host.fileName(),
        language,
        vocabulary: host.vocabulary(),
        dialect: {naming: s.naming, yieldStyle: s.yieldStyle, selfStyle: s.selfStyle, operators: s.operators},
        dirty: host.dirty(),
      },
      revision: revisionOf(source),
      status: host.status(),
      diagnostics: host.diagnostics(),
      steps: (t?.segments ?? []).map((seg, index) => ({index, kind: seg.kind, label: seg.label, start: seg.start, end: seg.end, line: seg.line})),
      duration: host.durationSeconds(),
      time: host.time(),
      scenes: host.scenes(),
      activeScene: host.activeScene(),
      selection: selection ? {id: selection.id, name: selection.name, kind: selection.kind, line: selection.line} : null,
      cursorLine: host.cursorLine(),
      editMode: s.agentEdits,
    };
    if (params.includeSource !== false) snap.source = source;
    if (params.as && params.as !== language) {
      const converted = host.convertForReading(source, params.as);
      snap.sourceAs = converted.ok ? {language: params.as, code: converted.code, notes: converted.notes} : {language: params.as, error: converted.notes.join(' ') || 'Could not convert.'};
    }
    return snap;
  };

  /** Wait for the user to accept or reject a proposal (review mode). */
  const propose = (p: Omit<AgentProposal, 'id'>): Promise<boolean> => {
    decide?.(false);
    const id = ++proposalId;
    setProposal({...p, id});
    note(`Proposed: ${p.summary}`);
    return new Promise(resolve => {
      const timer = window.setTimeout(() => finish(false), 10 * 60_000);
      const finish = (accepted: boolean) => {
        window.clearTimeout(timer);
        if (decide === finish) decide = null;
        setProposal(current => (current?.id === id ? null : current));
        resolve(accepted);
      };
      decide = finish;
    });
  };

  /** Apply (or propose) new source and report on it. */
  const commit = async (
    code: string,
    summary: string,
    conversion: EditResult['conversion'],
    /** Redo the change on a document the user edited meanwhile; null if it no longer applies. */
    rebase: ((current: string) => string | null) | null,
  ): Promise<EditResult> => {
    const language = host.language();
    const before = host.getSource();
    const {diagnostics, hints} = staticCheck(code, language);
    const run = diagnostics.length ? undefined : await runInSandbox(code, language).catch(() => undefined);
    if (host.settings.agentEdits === 'review') {
      const accepted = await propose({summary, before, after: code, notes: conversion?.notes ?? [], diagnostics, run});
      if (!accepted) {
        note(`Rejected: ${summary}`, 'warn');
        return {applied: false, reason: 'rejected', message: 'The user rejected this change. Ask them what to do differently.', revision: revisionOf(host.getSource()), language, conversion, diagnostics, hints, run};
      }
    }
    // The user may have typed while the change was checked or waited for review.
    const now = host.getSource();
    if (now !== before) {
      const rebased = rebase?.(now) ?? null;
      if (rebased === null) {
        host.notify([`The agent's change (${summary}) was not applied: the scene changed while it waited.`]);
        return {applied: false, reason: 'conflict', message: 'The user edited the document meanwhile. Re-read it and apply your change to the current source.', revision: revisionOf(now), language, diagnostics: [], hints: [], source: now};
      }
      code = rebased;
    }
    host.applyExternal(code, summary);
    note(`Applied: ${summary}`, diagnostics.length || (run && !run.ok) ? 'warn' : 'ok');
    return {applied: true, revision: revisionOf(code), language, conversion, diagnostics, hints, run};
  };

  // --------------------------------------------------------- methods

  const methods: {[K in keyof EditorMethods]: (params: Parameters<EditorMethods[K]>[0]) => Promise<ReturnType<EditorMethods[K]>> | ReturnType<EditorMethods[K]>} = {
    state: params => snapshot(params),

    async setSource({code, language, baseRevision, summary}) {
      if (baseRevision && baseRevision !== revisionOf(host.getSource())) {
        return {applied: false, reason: 'conflict', message: 'The document changed since that revision. Re-read it first.', revision: revisionOf(host.getSource()), language: host.language(), diagnostics: [], hints: [], source: host.getSource()};
      }
      const converted = toDocument(code, language);
      if (!converted.ok) {
        return {applied: false, reason: 'invalid', message: converted.error, revision: revisionOf(host.getSource()), language: host.language(), conversion: converted.conversion, diagnostics: [], hints: []};
      }
      return commit(converted.code, summary || 'Replaced the scene', converted.conversion, null);
    },

    async editSource({edits, baseRevision, summary}) {
      const before = host.getSource();
      if (baseRevision && baseRevision !== revisionOf(before)) {
        return {applied: false, reason: 'conflict', message: 'The document changed since that revision. Re-read it first.', revision: revisionOf(before), language: host.language(), diagnostics: [], hints: [], source: before};
      }
      const language = host.language();
      const explicitYield = language === 'tsx' || host.settings.yieldStyle === 'explicit';
      let code = before;
      const notes: string[] = [];
      for (const [i, edit] of edits.entries()) {
        const applied = applyEdit(code, edit);
        if (typeof applied !== 'string') {
          return {applied: false, reason: 'invalid', message: `Edit ${i + 1}: ${applied.error}`, revision: revisionOf(before), language, diagnostics: [], hints: []};
        }
        const repaired = repairSnippet(edit.new, language, explicitYield);
        if (repaired.code !== edit.new) {
          notes.push(...repaired.notes.map(n => `Edit ${i + 1}: ${n}`));
          code = applyEdit(code, {...edit, new: repaired.code}) as string;
        } else code = applied;
      }
      // Python habit: a first assignment as a declaration.
      code = declareAssignments(code, language, notes);
      if (code === before) {
        return {applied: false, reason: 'invalid', message: 'The edits do not change anything.', revision: revisionOf(before), language, diagnostics: [], hints: []};
      }
      const rebase = (current: string) => {
        let out = current;
        for (const edit of edits) {
          const next = applyEdit(out, {...edit, new: repairSnippet(edit.new, language, explicitYield).code});
          if (typeof next !== 'string') return null;
          out = next;
        }
        return declareAssignments(out, language, []);
      };
      return commit(code, summary || `Edited ${edits.length} place${edits.length === 1 ? '' : 's'}`, notes.length ? {from: language, to: language, notes} : undefined, rebase);
    },

    async check({code, language}) {
      const target = host.language();
      // Check in the document's language when the code is in it; otherwise in the code's own.
      const converted = toDocument(code, language);
      const checked = converted.ok ? converted.code : code;
      const lang = converted.ok ? target : (language && language !== 'auto' && language !== 'python' ? language : target);
      const {diagnostics, hints} = staticCheck(checked, lang);
      const run = diagnostics.length
        ? {ok: false, diagnostics, scenes: [], activeScene: null, duration: 0, steps: []}
        : await runInSandbox(checked, lang);
      return {language: lang, conversion: converted.conversion, diagnostics, hints, run};
    },

    async render({code, language, times, count, width}) {
      const {source, lang} = sourceFor(code, language);
      const agent = await sandbox.agent();
      const r: RenderResult = await agent.render(source, {...host.compileOptions(), language: lang}, {times, count, width});
      if (!r.image) throw new Error(`The scene does not run, so there is nothing to render. ${r.run.diagnostics.map(d => `${d.line ? `line ${d.line}: ` : ''}${d.message}`).join(' ')}`);
      note(`Rendered ${r.frames.length} frame${r.frames.length === 1 ? '' : 's'}`);
      return r;
    },

    async inspect({code, language, time}) {
      const {source, lang} = sourceFor(code, language);
      const agent = await sandbox.agent();
      const r: Omit<InspectResult, 'warnings'> = await agent.inspect(source, {...host.compileOptions(), language: lang}, time);
      return {...r, warnings: layoutWarnings(r.items)};
    },

    async open({example, code, language, name}) {
      if (example) {
        if (!host.examples.some(e => e.slug === example)) throw new Error(`No example "${example}".`);
        host.loadExample(example, false);
        note(`Opened the example ${example}`);
      } else if (code !== undefined) {
        const converted = toDocument(code, language);
        if (!converted.ok) throw new Error(converted.error);
        host.openScratch(converted.code, name ?? null, host.language());
        note(`Opened a new scene${name ? ` (${name})` : ''}`);
      }
      await settleEditor();
      return snapshot({includeSource: false});
    },

    reveal({line, time, step}) {
      if (step !== undefined) host.goToSegment(step);
      else if (time !== undefined) {
        host.togglePlayback(false);
        host.seekTime(time);
      }
      if (line !== undefined) host.revealLine(line);
      return {ok: true};
    },

    examples: () =>
      host.examples
        .filter(e => !e.slug.startsWith('scratch'))
        .map(e => ({slug: e.slug, title: e.title, description: e.description, style: e.style, order: e.order, code: e.code, python: e.python, tsx: e.tsx})),
  };

  /** The code to run: given code (converted to the document's language), or the open document. */
  const sourceFor = (code: string | undefined, language?: InputLanguage | 'auto') => {
    if (code === undefined) return {source: host.getSource(), lang: host.language()};
    const converted = toDocument(code, language);
    if (!converted.ok) throw new Error(converted.error);
    return {source: converted.code, lang: host.language()};
  };

  /** Wait for the main editor to finish its run (it may be in a background tab). */
  const settleEditor = async () => {
    const start = performance.now();
    await new Promise(r => setTimeout(r, 50));
    while (host.status() === 'running' && performance.now() - start < 5000) await new Promise(r => setTimeout(r, 50));
  };

  // ------------------------------------------------------- transport

  const dispatch = async (msg: CallMessage) => {
    const fn = (methods as any)[msg.method];
    const reply = (m: PageMessage) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(m));
    if (!fn) return reply({type: 'error', id: msg.id, error: `Unknown method ${msg.method}`});
    try {
      reply({type: 'result', id: msg.id, result: await fn(msg.params ?? {})});
    } catch (e) {
      reply({type: 'error', id: msg.id, error: (e as Error).message ?? String(e)});
    }
  };

  const connect = () => {
    window.clearTimeout(retry);
    if (!current.enabled || socket) return;
    setStatus(status() === 'connected' ? 'waiting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${current.port}/editor`);
    } catch {
      scheduleRetry();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      backoff = 1000;
      setStatus('connected');
      note(`Connected to the MCP server on port ${current.port}`, 'ok');
      const hello: PageMessage = {type: 'hello', protocol: PROTOCOL_VERSION, app: 'motion-canvas-editor', title: document.title};
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = e => {
      let msg: CallMessage;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === 'call') void dispatch(msg);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (status() === 'connected') note('Disconnected from the MCP server', 'warn');
      if (current.enabled) {
        setStatus('waiting');
        scheduleRetry();
      } else setStatus('off');
    };
  };
  const scheduleRetry = () => {
    window.clearTimeout(retry);
    retry = window.setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };

  const onFocus = () => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({type: 'focus'} satisfies PageMessage));
  window.addEventListener('focus', onFocus);

  /** In the desktop app the hub runs inside the app; ask it to start. */
  const askHost = (enable: boolean) => {
    if (!isDesktop()) return;
    try {
      (window as any).__electrobunSendToHost({type: 'mce:agent-hub', enable, port: current.port});
    } catch {
      // Not in the desktop shell after all.
    }
  };

  const setEnabled = (value: boolean) => {
    current = {...current, enabled: value};
    setEnabledSignal(value);
    savePrefs();
    if (value) {
      askHost(true);
      backoff = 1000;
      // Give the desktop shell a moment to start its hub.
      retry = window.setTimeout(connect, isDesktop() ? 300 : 0);
    } else {
      window.clearTimeout(retry);
      decide?.(false);
      socket?.close();
      socket = null;
      setStatus('off');
      askHost(false);
    }
  };
  const setPort = (value: number) => {
    if (!Number.isInteger(value) || value <= 0 || value > 65535) return;
    current = {...current, port: value};
    setPortSignal(value);
    savePrefs();
    if (current.enabled) {
      socket?.close();
      socket = null;
      askHost(true);
      connect();
    }
  };

  if (current.enabled) {
    askHost(true);
    window.setTimeout(connect, isDesktop() ? 300 : 0);
  }

  return {
    enabled,
    port,
    status,
    log,
    proposal,
    desktop: isDesktop(),
    setEnabled,
    setPort,
    accept: () => decide?.(true),
    reject: () => decide?.(false),
  };
}

export type AgentBridge = ReturnType<typeof createAgentBridge>;

/** Apply one find-and-replace edit; returns the new text or why not. */
export function applyEdit(source: string, edit: Edit): string | {error: string} {
  const count = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);
  let old = edit.old;
  let replacement = edit.new;
  let n = count(source, old);
  if (n === 0) {
    // Text copied from get_editor_state with its line-number gutter.
    const gutter = /^\s*\d+│ ?/;
    const lines = old.split('\n');
    if (lines.every(l => gutter.test(l) || l === '')) {
      old = lines.map(l => l.replace(gutter, '')).join('\n');
      replacement = replacement
        .split('\n')
        .map(l => l.replace(gutter, ''))
        .join('\n');
      n = count(source, old);
    }
  }
  if (n === 0) {
    // Trailing whitespace differences.
    const trimmed = old.replace(/[ \t]+$/gm, '');
    const src = source.replace(/[ \t]+$/gm, '');
    if (trimmed !== old && count(src, trimmed) === 1) return src.replace(trimmed, () => replacement);
    const first = old.split('\n').find(l => l.trim())?.trim();
    const near = first ? source.split('\n').findIndex(l => l.includes(first)) : -1;
    return {error: `\`old\` was not found in the document.${near >= 0 ? ` Its first line appears at line ${near + 1}; copy the text exactly, including indentation.` : ' Re-read the document with get_editor_state.'}`};
  }
  if (n > 1 && !edit.all) return {error: `\`old\` occurs ${n} times. Include more surrounding text to make it unique, or set \`all\`.`};
  return edit.all ? source.split(old).join(replacement) : source.replace(old, () => replacement);
}

const FRAME = {x: 64 / 9 + 0.05, y: 4 + 0.05};
const TEXTISH = /Text|Tex|Paragraph|Title|DecimalNumber|Integer|Variable|Txt|Latex|Code/;

/** Off-frame items and overlapping text, from the bounds `inspect` returns. */
function layoutWarnings(items: InspectItem[]): string[] {
  const out: string[] = [];
  const top = items.filter(i => i.depth === 0 && i.visible && i.bounds);
  const label = (i: InspectItem) => `${i.name}${i.line ? ` (line ${i.line})` : ''}`;
  for (const i of top) {
    const [l, b, r, t] = i.bounds!;
    if (r < -FRAME.x || l > FRAME.x || t < -FRAME.y || b > FRAME.y) out.push(`${label(i)} is entirely outside the frame.`);
    else if (l < -FRAME.x || r > FRAME.x || b < -FRAME.y || t > FRAME.y) {
      const sides = [l < -FRAME.x && 'left', r > FRAME.x && 'right', t > FRAME.y && 'top', b < -FRAME.y && 'bottom'].filter(Boolean);
      out.push(`${label(i)} is cut off at the ${sides.join(' and ')} edge of the frame.`);
    }
  }
  const texts = top.filter(i => TEXTISH.test(i.kind) || TEXTISH.test(i.name));
  for (let a = 0; a < texts.length; a++) {
    for (let c = a + 1; c < texts.length; c++) {
      const [al, ab, ar, at] = texts[a].bounds!;
      const [cl, cb, cr, ct] = texts[c].bounds!;
      const w = Math.min(ar, cr) - Math.max(al, cl);
      const h = Math.min(at, ct) - Math.max(ab, cb);
      if (w <= 0 || h <= 0) continue;
      const smaller = Math.min((ar - al) * (at - ab), (cr - cl) * (ct - cb));
      if (smaller > 0 && (w * h) / smaller > 0.15) out.push(`${label(texts[a])} and ${label(texts[c])} overlap.`);
    }
  }
  return out;
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

/** Line diff (LCS) with two lines of context around each change. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) return [{kind: 'gap', text: 'The change is too large to show as a diff.'}];
  const lcs: Uint32Array[] = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({kind: 'same', text: a[i]});
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) all.push({kind: 'del', text: a[i++]});
    else all.push({kind: 'add', text: b[j++]});
  }
  const keep = all.map((l, k) => l.kind !== 'same' || all.slice(Math.max(0, k - context), k + context + 1).some(n => n.kind !== 'same'));
  const out: DiffLine[] = [];
  for (let k = 0; k < all.length; k++) {
    if (keep[k]) out.push(all[k]);
    else if (out[out.length - 1]?.kind !== 'gap') out.push({kind: 'gap', text: '⋯'});
  }
  return out;
}
