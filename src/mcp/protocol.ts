/**
 * The agent bridge's wire protocol, shared by the MCP server (Bun) and the
 * editor page. Types and constants only, so the page can import it.
 *
 *   agent ──MCP──▶ server ──/call or in-process──▶ hub ──WebSocket /editor──▶ editor page
 *
 * The hub is a small HTTP server on 127.0.0.1 that the editor page connects
 * to. Whichever process starts first owns it (the desktop app, `bun run mcp
 * --http`, or the first `bun run mcp` an agent launched); later MCP servers
 * forward their editor calls to it over `POST /call`.
 */
import type {Diagnostic} from '../runtime/compile';
import type {Language} from '../runtime/convert';
import type {Hint} from '../runtime/hints';
import type {InputLanguage} from '../runtime/normalize';

export const DEFAULT_HUB_PORT = 5275;
export const HUB_HEADER = 'x-mce-hub';
export const PROTOCOL_VERSION = 1;

/** Editor origins allowed to connect to the hub's `/editor` socket by default. */
export const DEFAULT_EDITOR_ORIGINS = [
  'http://127.0.0.1:5273',
  'http://localhost:5273',
  'http://127.0.0.1:5274',
  'http://localhost:5274',
  // The desktop shell's webview (Electrobun serves the build as views://).
  'views://editor',
  'views://',
];

export interface StepInfo {
  index: number;
  kind: 'play' | 'wait';
  label: string;
  /** Seconds. */
  start: number;
  end: number;
  /** 1-based source line. */
  line?: number;
}

/** What running a scene produced: problems, timeline, length. */
export interface RunReport {
  ok: boolean;
  diagnostics: Diagnostic[];
  scenes: {name: string; kind: 'manim' | 'canvas-commons'}[];
  activeScene: string | null;
  /** Seconds. */
  duration: number;
  steps: StepInfo[];
  /** The scene did not report a timeline before the timeout (for example it never yields). */
  timedOut?: boolean;
}

export interface DocumentInfo {
  /** Example slug or `scratch`/`scratch-native`. */
  slug: string;
  title: string;
  fileName: string | null;
  /** Language the document is edited in. */
  language: Language;
  /** `manim`: uses the Manim layer. `native`: Canvas Commons only. */
  vocabulary: 'manim' | 'native';
  /** Dialect choices for Civet documents (from the Lab). */
  dialect: {naming: 'snake' | 'camel'; yieldStyle: 'implicit' | 'explicit'; selfStyle: 'at' | 'self'; operators: 'on' | 'off'};
  /** Whether it differs from the bundled example. */
  dirty: boolean;
}

export interface EditorSnapshot {
  document: DocumentInfo;
  /** Changes with every edit; pass it back as `baseRevision` to detect concurrent edits. */
  revision: string;
  source?: string;
  /** Present when the source was requested in the other language. */
  sourceAs?: {language: Language; code: string; notes: string[]} | {language: Language; error: string};
  status: 'idle' | 'running' | 'ok' | 'error';
  diagnostics: Diagnostic[];
  steps: StepInfo[];
  /** Seconds. */
  duration: number;
  time: number;
  scenes: {name: string; kind: string}[];
  activeScene: string | null;
  selection: {id: string | number; name: string; kind: string; line?: number} | null;
  /** The user's cursor line in the code pane. */
  cursorLine: number;
  /** How agent edits land: applied at once, or proposed for the user to accept. */
  editMode: 'apply' | 'review';
}

export interface EditResult {
  applied: boolean;
  /** Why not: `conflict` (the document changed since `baseRevision`), `rejected` (by the user), `invalid`. */
  reason?: 'conflict' | 'rejected' | 'invalid' | 'timeout';
  message?: string;
  revision: string;
  language: Language;
  /** What auto-conversion did to the submitted code. */
  conversion?: {from: InputLanguage; to: Language; notes: string[]};
  /** Static compile problems of the new source. */
  diagnostics: Diagnostic[];
  hints: Hint[];
  /** The new source ran in an isolated copy of the engine. */
  run?: RunReport;
  /** The current source when the edit could not be applied. */
  source?: string;
}

export interface Edit {
  /** Exact text to find in the document (must occur once unless `all`). */
  old: string;
  new: string;
  all?: boolean;
}

export interface InspectItem {
  id: string | number;
  name: string;
  kind: string;
  depth: number;
  line?: number;
  /** Manim units: frame centre at the origin, y up; the frame is ±7.11 × ±4. */
  bounds?: [number, number, number, number];
  visible: boolean;
  properties?: Record<string, string>;
}

export interface InspectResult {
  time: number;
  items: InspectItem[];
  /** Layout problems found from the bounds: off-frame, overlapping text. */
  warnings: string[];
  run: RunReport;
}

export interface RenderResult {
  /** PNG data URL of a contact sheet (or one frame). */
  image: string;
  frames: {time: number; step?: string}[];
  run: RunReport;
}

export interface ExampleInfo {
  slug: string;
  title: string;
  description: string;
  style: 'manim' | 'canvas-commons';
  order: number;
  /** `scene.civet`. */
  code: string;
  /** The Manim Python it was ported from. */
  python?: string;
  /** The Canvas Commons TSX it was ported from. */
  tsx?: string;
}

/** Methods the editor page answers. */
export interface EditorMethods {
  state(params: {includeSource?: boolean; as?: Language}): EditorSnapshot;
  setSource(params: {code: string; language?: InputLanguage | 'auto'; baseRevision?: string; summary?: string}): EditResult;
  editSource(params: {edits: Edit[]; baseRevision?: string; summary?: string}): EditResult;
  check(params: {code: string; language?: InputLanguage | 'auto'}): {
    language: Language;
    conversion?: EditResult['conversion'];
    diagnostics: Diagnostic[];
    hints: Hint[];
    run: RunReport;
  };
  render(params: {code?: string; language?: InputLanguage | 'auto'; times?: number[]; count?: number; width?: number}): RenderResult;
  inspect(params: {code?: string; language?: InputLanguage | 'auto'; time: number}): InspectResult;
  open(params: {example?: string; code?: string; language?: InputLanguage | 'auto'; name?: string}): EditorSnapshot;
  reveal(params: {line?: number; time?: number; step?: number}): {ok: true};
  /** The bundled examples (for a server that has no examples/ directory, like the desktop app). */
  examples(params: Record<string, never>): ExampleInfo[];
}

export type EditorMethod = keyof EditorMethods;

/** Hub → page. */
export interface CallMessage {
  type: 'call';
  id: number;
  method: EditorMethod;
  params: unknown;
}
/** Page → hub. */
export type PageMessage =
  | {type: 'hello'; protocol: number; app: string; title: string; agentsUrl?: string}
  | {type: 'focus'}
  | {type: 'result'; id: number; result: unknown}
  | {type: 'error'; id: number; error: string};
