/**
 * The MCP server: tools, resources and prompts that let an outside agent
 * read, write, check and review scenes in the editor.
 *
 * Tools that only need the compiler (checking, converting, docs, API lookup,
 * examples) run here. Tools about the open document, and anything that has to
 * run a scene, go to the editor page through an `EditorLink`.
 */
import {McpServer, ResourceTemplate} from '@modelcontextprotocol/sdk/server/mcp.js';
import {accessSync, constants, existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {z} from 'zod';
import {apiNames} from '../manim';
import {compileScene, defaultCompileOptions, Diagnostic} from '../runtime/compile';
import {civetToTsx, Language} from '../runtime/convert';
import {knownNames} from '../runtime/dialect';
import {Hint, sceneHints} from '../runtime/hints';
import {detectLanguage, InputLanguage, normalizeSource} from '../runtime/normalize';
import {formatDiff} from '../runtime/textdiff';
import {lookupApi, searchApi} from './api';
import {readTopic, topicIndex, topics} from './docs';
import type {EditorMethod, EditorMethods, EditorSnapshot, EditResult, ExampleInfo, ExportReport, RunReport, SaveTarget, StepInfo} from './protocol';

export const SERVER_NAME = 'motion-canvas-editor';
export const SERVER_VERSION = '0.1.0';

export class EditorUnavailable extends Error {}

/** How the server reaches the editor page. */
export interface EditorLink {
  call<M extends EditorMethod>(
    method: M,
    params: Parameters<EditorMethods[M]>[0],
    timeoutMs?: number,
  ): Promise<ReturnType<EditorMethods[M]>>;
}

export const NO_EDITOR =
  'No editor is connected. Ask the user to open the Motion Canvas Editor (the desktop app, or `bun run dev` and http://127.0.0.1:5273) and switch on "Agent" in its top bar. ' +
  'Tools that work without it: check_scene with run=false, convert_code, read_docs, lookup_api, get_example.';

export const INSTRUCTIONS = `Motion Canvas Editor: an animation editor (Canvas Commons, the Motion Canvas fork) whose scenes are written in one of two styles, each in Civet or TSX:
- Manim style: Manim's vocabulary on this engine. \`from manim import *\` (Civet) or \`import {...} from 'manim'\` (TSX), a class extending Scene with construct(), play/wait.
- Canvas Commons style: \`export default makeScene2D(function* (view) {...})\` with JSX nodes, refs, signals; every \`yield*\` statement is a timeline step.

Workflow, the same one the user follows in the editor: get_editor_state (open scene, its language, problems, timeline) → change it with edit_scene (exact old/new text, in the document's language) or write_scene (whole scene, any language), or start a new scene next to it with open_scene → read the returned problems, hints and run report → render_preview to look at frames, inspect_frame for positions. Fix until there are no problems → export_scene writes the result to a file (video by default; also gif, a web embed, an image). It needs no options. Sound: add_sound_file brings a clip into the project, and a scene plays it by file name (\`add_sound "click.mp3"\`); it ends up in the video and the web embed.

You share the document with the user, who may type at any time. Every tool that touches the open scene first tells you what changed in the editor since you last read it; take that as their current intent. edit_scene applies to their latest text. write_scene will not replace changes you have not been shown.

Languages: when unsure of Civet, write TSX: write_scene, open_scene and check_scene convert TSX, Civet, mixed code and Manim Python to the document's language. Civet pitfalls: \`x => y\` means \`x(=> y)\` (write \`(x) => y\`); keyword arguments are \`run_time: 2\` (Civet) or a trailing \`{run_time: 2}\` (TSX), never \`run_time=2\`; \`#\` starts a comment.

Before writing a scene the first time, read_docs topic "quickstart". Use lookup_api before relying on a Manim or Canvas Commons name: 3D, SVG/images, MarkupText, tables and boolean operations do not exist here. Coordinates: Manim units, frame 14.2 × 8, origin at the centre, y up (Canvas Commons nodes use pixels, 1920 × 1080, y down).`;

const memberNames = (() => {
  let cache: Set<string> | null = null;
  return () => (cache ??= knownNames());
})();

// ------------------------------------------------------------ formatting

const fmtTime = (s: number) => `${s.toFixed(2)}s`;

function formatDiagnostics(list: Diagnostic[]): string {
  if (!list.length) return 'Problems: none.';
  return ['Problems:', ...list.map(d => `- ${d.line ? `line ${d.line}` : 'no line'} [${d.stage}] ${d.message}`)].join('\n');
}

function formatHints(list: Hint[]): string {
  if (!list.length) return '';
  return ['Hints (heuristic, check before acting):', ...list.map(h => `- ${h.line ? `line ${h.line} ` : ''}${h.severity} (${h.rule}): ${h.message}`)].join('\n');
}

function formatSteps(steps: StepInfo[], limit = 60): string {
  if (!steps.length) return 'Timeline: no steps.';
  const rows = steps.slice(0, limit).map(s => `${s.index + 1}. ${fmtTime(s.start)}–${fmtTime(s.end)} ${s.kind} ${s.label}${s.line ? ` (line ${s.line})` : ''}`);
  if (steps.length > limit) rows.push(`… ${steps.length - limit} more`);
  return ['Timeline:', ...rows].join('\n');
}

function formatRun(run: RunReport | undefined): string {
  if (!run) return '';
  const head = run.ok
    ? `Run: ok, ${fmtTime(run.duration)}, ${run.steps.length} step${run.steps.length === 1 ? '' : 's'}${run.activeScene ? `, scene ${run.activeScene}` : ''}${run.scenes.length > 1 ? ` (of ${run.scenes.map(s => s.name).join(', ')})` : ''}.`
    : 'Run: failed.';
  return [head, run.timedOut ? 'The scene did not finish reporting its timeline in time (an endless loop, or a very long scene).' : '', run.ok ? formatSteps(run.steps) : formatDiagnostics(run.diagnostics), run.ok && run.diagnostics.length ? formatDiagnostics(run.diagnostics) : '']
    .filter(Boolean)
    .join('\n');
}

function formatEdit(r: EditResult): string {
  const lines: string[] = [];
  if (!r.applied) {
    lines.push(`Not applied (${r.reason ?? 'error'}): ${r.message ?? ''}`.trim());
  } else {
    lines.push(`Applied. Revision ${r.revision}, document language ${r.language}.`);
  }
  if (r.conversion && r.conversion.notes.length) {
    lines.push(r.conversion.from === r.conversion.to ? 'Repaired:' : `Converted from ${r.conversion.from} to ${r.conversion.to}:`, ...r.conversion.notes.map(n => `- ${n}`));
  }
  if (r.applied || r.reason === 'rejected' || r.diagnostics.length) {
    lines.push(formatDiagnostics(r.diagnostics));
    const hints = formatHints(r.hints);
    if (hints) lines.push(hints);
    if (r.run) lines.push(formatRun(r.run));
  }
  if (!r.applied && r.source !== undefined) lines.push('Current source:', '```' + r.language, r.source, '```');
  return lines.join('\n');
}

const kB = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(1)} MB`);

function formatExport(r: ExportReport): string {
  const what = r.format === 'video' ? `${r.extension.toUpperCase()} video${r.codec ? ` (${r.codec === 'avc' ? 'H.264' : r.codec.toUpperCase()})` : ''}` : r.format === 'gif' ? 'Animated GIF' : r.format === 'embed' ? 'Web embed (one HTML file with a player)' : 'PNG image';
  const facts = [what, r.width && r.height ? `${r.width} × ${r.height}` : '', r.fps && r.format !== 'image' && r.format !== 'embed' ? `${r.fps} fps` : '', r.seconds ? `${r.seconds.toFixed(2)} s` : '', r.frames && r.frames > 1 ? `${r.frames} frames` : '', kB(r.bytes)].filter(Boolean);
  const lines = [r.path ? `Exported to ${r.path}` : `Exported ${r.fileName}, but it was not saved: ${r.saveError ?? 'unknown error'}`, `${facts.join(', ')}.`];
  if (r.realtime) lines.push('Recorded while playing, because this webview cannot encode frame by frame: frames may be dropped. The browser build (Chromium) renders every frame.');
  if (r.sound?.clips) lines.push(`Sound: ${r.sound.clips} clip${r.sound.clips === 1 ? '' : 's'}${r.sound.codec ? ` (${r.sound.codec === 'aac' ? 'AAC' : r.sound.codec})` : ''}.`);
  if (r.sound?.note) lines.push(r.sound.note);
  if (r.snippet) lines.push('To show it on a web page, put the file next to the page and paste:', r.snippet, 'Options go in the URL hash, e.g. `scene.html#autoplay=0&loop=0&controls=0`.');
  return lines.join('\n');
}

/** Where exports go when the agent names no place. */
function defaultExportDir(): string {
  if (process.env.MCE_EXPORT_DIR) return resolve(process.env.MCE_EXPORT_DIR);
  const cwd = process.cwd();
  try {
    // A desktop app's working directory is not a place for the user's files.
    if (cwd !== '/' && !/\.app\/|[\\/]bin$/.test(cwd)) {
      accessSync(cwd, constants.W_OK);
      return join(cwd, 'exports');
    }
  } catch {
    // Not writable.
  }
  return join(homedir(), 'Downloads');
}

/** A directory (the editor names the file) or a file, from the agent's `path`. */
export function saveTarget(path: string | undefined): SaveTarget {
  if (!path) return {dir: defaultExportDir()};
  const abs = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
  let isDir = /[\\/]$/.test(path) || !/\.[a-z0-9]{2,5}$/i.test(abs);
  try {
    if (existsSync(abs)) isDir = statSync(abs).isDirectory();
  } catch {
    // Treat it by its spelling.
  }
  return isDir ? {dir: abs} : {file: abs};
}

const text = (t: string) => ({content: [{type: 'text' as const, text: t}]});
const failure = (t: string) => ({content: [{type: 'text' as const, text: t}], isError: true});

// ------------------------------------------------------------- examples

let diskExamples: ExampleInfo[] | null | undefined;
/** The bundled examples, from examples/ next to the source when it exists. */
function readDiskExamples(): ExampleInfo[] | null {
  if (diskExamples !== undefined) return diskExamples;
  const dir = join(import.meta.dir, '..', '..', 'examples');
  if (!existsSync(dir)) return (diskExamples = null);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : undefined);
  diskExamples = readdirSync(dir)
    .filter(slug => existsSync(join(dir, slug, 'scene.civet')))
    .map(slug => {
      let meta: Record<string, any> = {};
      try {
        meta = JSON.parse(read(join(dir, slug, 'meta.json')) ?? '{}');
      } catch {
        // A broken meta.json still leaves the scene usable.
      }
      return {
        slug,
        title: meta.title ?? slug,
        description: meta.description ?? '',
        style: meta.style ?? 'manim',
        order: meta.order ?? 500,
        code: read(join(dir, slug, 'scene.civet'))!,
        python: read(join(dir, slug, 'manim.py')),
        tsx: read(join(dir, slug, 'original.tsx')),
      } as ExampleInfo;
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return diskExamples;
}

async function examples(link: EditorLink): Promise<ExampleInfo[]> {
  return readDiskExamples() ?? (await link.call('examples', {}));
}

// ---------------------------------------------------------------- server

const languageArg = z
  .enum(['auto', 'civet', 'tsx', 'python'])
  .optional()
  .describe('Language of `code`. Default `auto`: detected. Python means Manim Community Python, which is converted.');

export function createMcpServer(link: EditorLink): McpServer {
  const server = new McpServer({name: SERVER_NAME, version: SERVER_VERSION}, {instructions: INSTRUCTIONS});

  /** Call the editor; turn "no editor" into a helpful tool error. */
  const viaEditor = async <T>(fn: () => Promise<T>, format: (value: T) => any) => {
    try {
      return format(await fn());
    } catch (e) {
      if (e instanceof EditorUnavailable) return failure(e.message || NO_EDITOR);
      return failure(`The editor reported an error: ${(e as Error).message ?? e}`);
    }
  };

  // ------------------------------------------------ sharing the document

  /**
   * The text of the open document as this agent knows it: what a tool last
   * showed it (in full, or as a diff on top of what it had), or what it wrote
   * itself. Null until it has been shown a scene.
   */
  let seen: {slug: string; revision: string; source: string} | null = null;

  interface CatchUp {
    state: EditorSnapshot;
    /** What to tell the agent before anything else; empty when nothing changed. */
    note: string;
    /** `first`: the agent has not been shown this scene. `same`: it knows exactly this text. `edited`: the text changed. `switched`: another scene is open. */
    kind: 'first' | 'same' | 'edited' | 'switched';
    /**
     * Call once the answer carrying `note` is certain to reach the agent.
     * `full`: the answer shows the whole source. Without that, a diff brings
     * the agent up to date only if it knew the text the diff starts from.
     */
    shown(full: boolean): void;
  }

  /**
   * Read the open document and work out what changed in the editor since
   * this agent last saw it: the user typed, or opened another scene. Nothing
   * is recorded until `shown` is called, so a tool that fails after this, or
   * one that never shows the text, leaves the agent as uninformed as it was.
   */
  const catchUp = async (as?: Language): Promise<CatchUp> => {
    const state = await link.call('state', {includeSource: true, as});
    const now = {slug: state.document.slug, revision: state.revision, source: state.source ?? ''};
    const kind: CatchUp['kind'] = !seen ? 'first' : seen.slug !== now.slug ? 'switched' : seen.revision !== now.revision ? 'edited' : 'same';
    const note =
      kind === 'switched'
        ? `Since you last looked, another scene was opened in the editor: ${state.document.title} (${state.document.slug}). You have not been shown it: read it with get_editor_state.`
        : kind === 'edited'
          ? ['Since you last read it, the scene was edited in the editor (by the user, unless another agent is connected). The changes:', '```diff', formatDiff(seen!.source, now.source), '```'].join('\n')
          : '';
    return {
      state,
      note,
      kind,
      shown(full) {
        if (full || kind === 'same' || kind === 'edited') seen = now;
      },
    };
  };
  /** The agent's own change to a text it knew: it knows the result too. */
  const sawEdit = (r: EditResult) => {
    if (seen && r.applied && r.source !== undefined) seen = {...seen, revision: r.revision, source: r.source};
  };
  const withNote = (note: string, body: string) => (note ? `${note}\n\n${body}` : body);

  // ---------------------------------------------------------- knowledge

  server.registerTool(
    'read_docs',
    {
      title: 'Read the editor docs',
      description:
        'Documentation bundled with the editor: how scenes are written here, Civet for TypeScript authors, the Manim layer reference, mixing styles, and a review checklist. Call without arguments for the list of topics.',
      inputSchema: {
        topic: z.enum(topics.map(t => t.name) as [string, ...string[]]).optional(),
        section: z.string().optional().describe('A heading inside the topic, e.g. "Known differences". Long topics list their sections when this does not match.'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({topic, section}) => {
      if (!topic) return text(topicIndex());
      const body = readTopic(topic, section);
      return body ? text(body) : failure(`Unknown topic. ${topicIndex()}`);
    },
  );

  server.registerTool(
    'lookup_api',
    {
      title: 'Look up an API name',
      description:
        'Check whether names exist in this editor (the Manim layer and Canvas Commons), and how to call them: constructor arguments and defaults, methods, signals, examples. Use it before relying on a Manim name from memory: only the 2D core is implemented. `search` lists names containing a word.',
      inputSchema: {
        names: z.array(z.string()).max(12).optional().describe('Exact names: classes (`Circle`, `Rect`), functions (`all`, `waitFor`), methods (`set_fill`), constants (`BLUE`).'),
        search: z.string().optional().describe('A word to find names by, e.g. "arrow" or "tex".'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({names, search}) => {
      const parts: string[] = [];
      if (names?.length) parts.push(lookupApi(names));
      if (search) parts.push(searchApi(search));
      return parts.length ? text(parts.join('\n\n')) : failure('Pass `names` or `search`.');
    },
  );

  server.registerTool(
    'get_example',
    {
      title: 'Get a bundled example',
      description:
        'The example scenes that ship with the editor, as working references. Without `slug`: the list. With `slug`: the scene in Civet or TSX, plus the Manim Python or Canvas Commons TSX it was ported from when `include_original` is set.',
      inputSchema: {
        slug: z.string().optional(),
        language: z.enum(['civet', 'tsx']).optional().describe('Default civet.'),
        include_original: z.boolean().optional(),
      },
      annotations: {readOnlyHint: true},
    },
    async ({slug, language, include_original}) => {
      let list: ExampleInfo[];
      try {
        list = await examples(link);
      } catch (e) {
        return failure(e instanceof EditorUnavailable ? `The examples are read from the editor here. ${e.message}` : String(e));
      }
      if (!slug) {
        return text(
          [
            'Examples (slug — title: description):',
            ...list.map(e => `- ${e.slug} [${e.style}${e.python ? ', from Manim Python' : ''}${e.tsx ? ', from TSX' : ''}] — ${e.title}: ${e.description}`),
          ].join('\n'),
        );
      }
      const ex = list.find(e => e.slug === slug);
      if (!ex) return failure(`No example "${slug}". Call get_example without a slug for the list.`);
      const lang = language ?? 'civet';
      const code = lang === 'civet' ? ex.code : ex.style === 'canvas-commons' && ex.tsx ? ex.tsx : civetToTsx(ex.code, apiNames).code;
      const out = [`# ${ex.title} (${ex.style} style)`, ex.description, '', '```' + lang, code.trimEnd(), '```'];
      if (include_original && ex.python) out.push('', 'Ported from this Manim Python:', '```python', ex.python.trimEnd(), '```');
      if (include_original && ex.tsx && lang !== 'tsx') out.push('', 'Ported from this Canvas Commons TSX:', '```tsx', ex.tsx.trimEnd(), '```');
      return text(out.join('\n'));
    },
  );

  // ------------------------------------------------------- code helpers

  server.registerTool(
    'convert_code',
    {
      title: 'Convert scene code between languages',
      description:
        'Convert a scene to Civet or TSX. Accepts Civet, TSX, a mix of the two, or Manim Community Python, and repairs the spellings that would compile to something else (`x => y` in Civet, `run_time=2`, missing `yield*`). Civet → TSX is exact; TSX → Civet keeps braces where needed. Does not touch the editor.',
      inputSchema: {
        code: z.string(),
        to: z.enum(['civet', 'tsx']),
        from: languageArg,
      },
      annotations: {readOnlyHint: true},
    },
    async ({code, to, from}) => {
      const r = normalizeSource(code, to, {apiNames, from: from ?? 'auto'});
      const head = r.ok ? `Converted ${r.from} → ${r.to}${r.changed ? '' : ' (no changes needed)'}.` : `Could not convert ${r.from} → ${r.to}: ${r.error}`;
      return {
        content: [{type: 'text', text: [head, ...r.notes.map(n => `- ${n}`), '', '```' + to, r.code, '```'].join('\n')}],
        isError: !r.ok,
      };
    },
  );

  server.registerTool(
    'check_scene',
    {
      title: 'Check a scene',
      description:
        'Compile a scene and report problems with line numbers, plus hints about likely mistakes (Manim names that do not exist here, Python habits, missing `yield*`, Civet pitfalls). With the editor connected it also runs the scene in an isolated copy of the engine (not the user\'s document) and reports runtime errors and the timeline. Without `code`, checks the document open in the editor.',
      inputSchema: {
        code: z.string().optional().describe('Scene source. Omit to check the open document.'),
        language: languageArg,
        run: z.boolean().optional().describe('Also run it in the editor (default true when the editor is connected).'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({code, language, run}) => {
      let source = code;
      let target: Language;
      const notes: string[] = [];
      if (source === undefined) {
        try {
          const c = await catchUp();
          if (c.note) notes.push(c.note);
          // Everything below ends in a text answer that includes the note.
          c.shown(false);
          const state = c.state;
          source = state.source ?? '';
          target = state.document.language;
        } catch (e) {
          return failure(e instanceof EditorUnavailable ? `No code given and ${e.message}` : String(e));
        }
      } else {
        const lang = language && language !== 'auto' ? (language as InputLanguage) : detectLanguage(source).language;
        if (lang === 'python') {
          const r = normalizeSource(source, 'civet', {apiNames, from: 'python'});
          notes.push('Checked the Civet conversion of the Python:', ...r.notes.map(n => `- ${n}`));
          source = r.code;
          target = 'civet';
        } else target = lang;
      }
      const compiled = compileScene(source, {...defaultCompileOptions, language: target});
      const hints = sceneHints(source, {language: target, apiNames, memberNames: memberNames(), implicitYield: true});
      const parts = [`Language: ${target}.`, ...notes, formatDiagnostics(compiled.diagnostics)];
      const hintText = formatHints(hints);
      if (hintText) parts.push(hintText);
      const fix = normalizeSource(source, target, {apiNames, from: target});
      if (fix.ok && fix.changed) parts.push('Auto-fixable (write_scene and convert_code apply these):', ...fix.notes.map(n => `- ${n}`));
      if (run !== false && compiled.ok) {
        try {
          const r = await link.call('check', {code: source, language: target}, 60_000);
          parts.push(formatRun(r.run));
        } catch (e) {
          parts.push(e instanceof EditorUnavailable ? 'Not run: no editor is connected (static check only).' : `Not run: ${(e as Error).message}`);
        }
      }
      return text(parts.join('\n'));
    },
  );

  // ------------------------------------------------------------- editor

  server.registerTool(
    'get_editor_state',
    {
      title: 'Read the open scene',
      description:
        'The document open in the editor: its source, language (civet/tsx), style (manim/native), dialect settings, compile and runtime problems, timeline steps with source lines, playhead time, selection and cursor line. `as` returns the source in the other language too (Civet → TSX is exact), for reading only: edit in the document\'s own language, or send a whole scene to write_scene.',
      inputSchema: {
        include_source: z.boolean().optional().describe('Default true.'),
        as: z.enum(['civet', 'tsx']).optional(),
      },
      annotations: {readOnlyHint: true},
    },
    async ({include_source, as}) =>
      viaEditor(
        () => catchUp(as),
        c => {
          const {state: s, note} = c;
          c.shown(include_source !== false);
          const d = s.document;
          const others = s.myScenes.filter(m => m.slug !== d.slug);
          const lines = [
            note,
            `Document: ${d.title} (${d.slug}; ${d.kind === 'scene' ? `one of the user's own scenes${d.fileName ? `, ${d.fileName}` : ''}` : `a bundled example${d.dirty ? ', edited by the user' : ''}`}).`,
            others.length ? `The user's other scenes (open_scene \`scene\`): ${others.slice(0, 12).map(m => `${m.title} (${m.slug})`).join(', ')}${others.length > 12 ? ', …' : ''}.` : '',
            s.folder
              ? s.folder.locked
                ? `Project folder: "${s.folder.name}", but the browser is waiting for the user to reconnect it; edits are kept in the browser until then.`
                : `Project folder: the user's scenes are files in a folder named "${s.folder.name}" (one .civet or .tsx per scene, sounds in assets/, exports in exports/). The editor writes every change there and picks up changes made to the files.`
              : '',
            s.sounds.length ? `Sounds (use by name: \`add_sound "name"\` in a Manim scene, \`sound("name").play()\` from @canvas-commons/core in a native one): ${s.sounds.map(a => a.name).join(', ')}.` : '',
            `Language: ${d.language}. Style: ${d.vocabulary === 'manim' ? 'Manim' : 'Canvas Commons (native)'}.${d.language === 'civet' ? ` Dialect: ${d.dialect.naming}_case names, ${d.dialect.yieldStyle} yield*, ${d.dialect.selfStyle === 'at' ? '@' : 'self.'} for the scene, operator overloading ${d.dialect.operators}.` : ''}`,
            `Revision: ${s.revision}. Edits: ${s.editMode === 'review' ? 'proposed to the user, who accepts or rejects them' : 'applied directly (the user can undo)'}.`,
            `Status: ${s.status}. Time ${fmtTime(s.time)} of ${fmtTime(s.duration)}. Cursor on line ${s.cursorLine}.${s.selection ? ` Selected: ${s.selection.name} (${s.selection.kind}${s.selection.line ? `, line ${s.selection.line}` : ''}).` : ''}`,
            s.scenes.length > 1 ? `Scenes: ${s.scenes.map(x => x.name).join(', ')}; showing ${s.activeScene}.` : '',
            formatDiagnostics(s.diagnostics),
            formatSteps(s.steps),
          ];
          if (include_source !== false && s.source !== undefined) lines.push('', 'Source:', '```' + d.language, numbered(s.source), '```');
          if (s.sourceAs) {
            lines.push('', `As ${s.sourceAs.language}:`);
            if ('code' in s.sourceAs) lines.push('```' + s.sourceAs.language, s.sourceAs.code, '```');
            else lines.push(s.sourceAs.error);
          }
          return text(lines.filter(l => l !== '').join('\n'));
        },
      ),
  );

  server.registerTool(
    'edit_scene',
    {
      title: 'Edit the open scene',
      description:
        "Replace exact text in the open document, like a find-and-replace: each `old` must occur exactly once (or set `all`). Write `new` in the document's language (see get_editor_state; line numbers there are not part of the text). TypeScript expressions are mostly valid inside Civet, but use `(x) => y` and `key: value` keyword arguments. Returns compile problems, hints and a run of the result. If the user reviews agent edits, this waits for their decision.",
      inputSchema: {
        edits: z.array(z.object({old: z.string(), new: z.string(), all: z.boolean().optional()})).min(1),
        base_revision: z.string().optional().describe('Revision from get_editor_state; the edit is refused if the user changed the document since.'),
        summary: z.string().optional().describe('One line for the user: what this change does.'),
      },
    },
    async ({edits, base_revision, summary}) =>
      viaEditor(
        async () => {
          const c = await catchUp();
          // Edits are written against a text; never apply them to a scene the agent has not read.
          if (c.kind === 'switched') return {note: c.note, r: null};
          const r = await link.call('editSource', {edits, baseRevision: base_revision, summary}, 10 * 60_000);
          c.shown(false);
          sawEdit(r);
          return {note: c.note, r};
        },
        ({note, r}) =>
          r
            ? {...text(withNote(note, formatEdit(r))), isError: !r.applied}
            : failure(`${note} Nothing was changed: your edits were written for the scene that was open before.`),
      ),
  );

  server.registerTool(
    'write_scene',
    {
      title: 'Replace the open scene',
      description:
        "Replace the whole open document. `code` may be Civet, TSX, mixed, or Manim Python: it is converted to the document's language and repaired where it would compile to something else (the result says what changed). Prefer edit_scene for small changes: it keeps the user's formatting and merges with what they typed. To start something new without touching the open scene, use open_scene with `code`. If the document holds work of the user's that you have not been shown, the first call returns it instead of replacing it. Returns compile problems, hints and a run of the result.",
      inputSchema: {
        code: z.string(),
        language: languageArg,
        base_revision: z.string().optional(),
        summary: z.string().optional().describe('One line for the user: what this change does.'),
      },
    },
    async ({code, language, base_revision, summary}) =>
      viaEditor(
        async () => {
          const c = await catchUp();
          const {state, note} = c;
          const d = state.document;
          const usersWork = d.kind === 'scene' || d.dirty;
          // Replacing everything is only safe on a text the agent knows.
          if (c.kind !== 'same' && usersWork && base_revision !== state.revision) return {c, note, state, r: null};
          const r = await link.call('setSource', {code, language: language ?? 'auto', baseRevision: base_revision, summary}, 10 * 60_000);
          // It wrote the whole text; otherwise the answer carries the note (and the current text on a conflict).
          if (r.applied && r.source !== undefined) seen = {slug: d.slug, revision: r.revision, source: r.source};
          else c.shown(r.source !== undefined);
          return {c, note, state, r};
        },
        ({c, note, state, r}) =>
          r
            ? {...text(withNote(note, formatEdit(r))), isError: !r.applied}
            : failure(
                [
                  // The answer below shows the whole scene: from here on the agent knows it.
                  (c.shown(true), c.kind === 'edited' ? note : `You have not been shown the open scene (${state.document.title}), and write_scene would replace all of it.`),
                  'Nothing was changed. The scene as it is now:',
                  '```' + state.document.language,
                  numbered(state.source ?? ''),
                  '```',
                  'Use edit_scene to change parts of it, open_scene with `code` to start a new scene next to it, or call write_scene again to replace it all.',
                ].join('\n'),
              ),
      ),
  );

  server.registerTool(
    'open_scene',
    {
      title: 'Open a scene in the editor',
      description:
        "Open a bundled example (`example`: a slug from get_example), one of the user's own scenes (`scene`: its name or slug, listed by get_editor_state), or new code (`code`, any language) as a new scene of the user's. Nothing is overwritten: the scene that was open stays in the user's list. New code opens in the editor's current language.",
      inputSchema: {
        example: z.string().optional(),
        scene: z.string().optional().describe("One of the user's own scenes, by name or slug."),
        code: z.string().optional(),
        language: languageArg,
        name: z.string().optional().describe('A name for the new scene, e.g. "Intro".'),
      },
    },
    async ({example, scene, code, language, name}) => {
      if (!example && !scene && code === undefined) return failure('Pass `example`, `scene` or `code`.');
      return viaEditor(
        async () => {
          const s = await link.call('open', {example, scene, code, language: language ?? 'auto', name}, 60_000);
          // New code is the agent's own text; an example or a scene of the user's has yet to be read.
          seen = null;
          if (code !== undefined && !example && !scene) (await catchUp()).shown(true);
          return s;
        },
        s => text([`Opened ${s.document.title} (${s.document.slug}, ${s.document.language}, revision ${s.revision}).`, formatDiagnostics(s.diagnostics), formatSteps(s.steps)].join('\n')),
      );
    },
  );

  server.registerTool(
    'render_preview',
    {
      title: 'Render frames',
      description:
        'Render frames of the open scene (or of `code`) as one PNG contact sheet, each frame labelled with its time. Default: 8 frames spread over the whole scene. Use it to see the result: layout, overlaps, things off-frame, colours. Rendering happens in an isolated copy of the engine and does not move the user\'s playhead.',
      inputSchema: {
        code: z.string().optional().describe('Render this instead of the open document.'),
        language: languageArg,
        times: z.array(z.number().min(0)).max(16).optional().describe('Seconds to render. Overrides `count`.'),
        count: z.number().int().min(1).max(16).optional(),
        width: z.number().int().min(160).max(960).optional().describe('Width of each frame in pixels (default 480, or 960 for a single frame).'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({code, language, times, count, width}) =>
      viaEditor(
        async () => {
          const c = code === undefined ? await catchUp() : null;
          const r = await link.call('render', {code, language: language ?? 'auto', times, count, width}, 120_000);
          c?.shown(false);
          return {note: c?.note ?? '', r};
        },
        ({note, r}) => {
          const caption = [
            note,
            `Frames: ${r.frames.map(f => `${fmtTime(f.time)}${f.step ? ` (${f.step})` : ''}`).join(', ')}.`,
            formatRun(r.run),
          ]
            .filter(Boolean)
            .join('\n');
          const data = r.image.replace(/^data:image\/png;base64,/, '');
          return {content: [{type: 'image' as const, data, mimeType: 'image/png'}, {type: 'text' as const, text: caption}]};
        },
      ),
  );

  server.registerTool(
    'inspect_frame',
    {
      title: 'Inspect a frame',
      description:
        'What is on screen at a time: every mobject and node with its bounds in Manim units (frame centre at 0,0, y up, visible area x ±7.11, y ±4), colours, text and source line, plus warnings for things off-frame or overlapping. The text-only alternative to render_preview.',
      inputSchema: {
        time: z.number().min(0).describe('Seconds.'),
        code: z.string().optional().describe('Inspect this instead of the open document.'),
        language: languageArg,
      },
      annotations: {readOnlyHint: true},
    },
    async ({time, code, language}) =>
      viaEditor(
        async () => {
          const c = code === undefined ? await catchUp() : null;
          const r = await link.call('inspect', {time, code, language: language ?? 'auto'}, 60_000);
          c?.shown(false);
          return {note: c?.note ?? '', r};
        },
        ({note, r}) => {
          const round = (n: number) => Math.round(n * 100) / 100;
          const items = r.items.map(i => {
            const b = i.bounds ? ` [${i.bounds.map(round).join(', ')}]` : '';
            const props = i.properties ? ` ${Object.entries(i.properties).map(([k, v]) => `${k}=${v}`).join(' ')}` : '';
            return `${'  '.repeat(i.depth)}- ${i.name} (${i.kind}${i.line ? `, line ${i.line}` : ''}${i.visible ? '' : ', hidden'})${b}${props}`;
          });
          return text(
            [
              note,
              `At ${fmtTime(r.time)} (bounds are [left, bottom, right, top] in Manim units):`,
              ...(items.length ? items : ['(nothing on screen)']),
              r.warnings.length ? ['Layout warnings:', ...r.warnings.map(w => `- ${w}`)].join('\n') : 'Layout warnings: none.',
              r.run.ok ? '' : formatRun(r.run),
            ]
              .filter(Boolean)
              .join('\n'),
          );
        },
      ),
  );

  server.registerTool(
    'export_scene',
    {
      title: 'Export the open scene',
      description:
        'Export the scene open in the editor to a file, as the user does with the Export button. `video`: MP4 (H.264), 1080p at 30 fps, every frame rendered exactly. `gif`: a looping GIF, 640 px wide. `embed`: one self-contained HTML file that plays the scene, with the <iframe> tag to paste into a web page. `image`: one frame as PNG. Every option has a default, so no arguments gives a video. The file is written on this machine and its path returned. Export only a scene that runs without problems.',
      inputSchema: {
        format: z.enum(['video', 'gif', 'embed', 'image']).optional().describe('Default video.'),
        path: z
          .string()
          .optional()
          .describe("A file or a directory to save to. Relative paths start at this server's working directory. Default: its `exports` directory, with the file named after the scene. The extension always follows the format."),
        time: z.number().min(0).optional().describe("image: the time of the frame in seconds. Default: the user's playhead."),
        height: z.number().int().min(180).max(2160).optional().describe('video, image: height in pixels; the width follows 16:9. Default 1080.'),
        fps: z.number().int().min(1).max(120).optional().describe('video: default 30. gif: default 20.'),
        width: z.number().int().min(120).max(1920).optional().describe('gif: width in pixels. Default 640.'),
      },
    },
    async ({format, path, time, height, fps, width}) =>
      viaEditor(
        async () => {
          const c = await catchUp();
          const r = await link.call('export', {format: format ?? 'video', height, fps, width, time, saveTo: saveTarget(path)}, 30 * 60_000);
          c.shown(false);
          return {note: c.note, r};
        },
        ({note, r}) => ({...text(withNote(note, formatExport(r))), isError: !r.path}),
      ),
  );

  server.registerTool(
    'add_sound_file',
    {
      title: 'Add a sound clip to the project',
      description:
        'Add a sound file from this machine (mp3, wav, ogg, m4a, aac, flac, opus) to the project open in the editor, as the user does in the Sounds tab. Scenes then play it by file name: `add_sound "click.mp3"` (optionally `time_offset: 0.5, gain: -6`, in seconds and decibels) in a Manim scene, or `sound("click.mp3").play()` with `sound` from @canvas-commons/core in a native one (it also has `.gain(dB)`, `.trim(start, end)`, `.playbackRate(rate)`). The sound becomes part of exported videos and web embeds. get_editor_state lists the sounds already there.',
      inputSchema: {
        path: z.string().describe("The sound file. Relative paths start at this server's working directory."),
        name: z.string().optional().describe('The name scenes will use, with its extension. Default: the file name.'),
      },
    },
    async ({path, name}) => {
      const file = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
      let data: Buffer;
      try {
        if (statSync(file).size > 40 * 1024 * 1024) return failure('That file is larger than 40 MB: too large for a sound clip.');
        data = readFileSync(file);
      } catch (e) {
        return failure(`Could not read ${file}: ${(e as Error).message}`);
      }
      return viaEditor(
        () => link.call('addAsset', {name: name ?? basename(file), data: data.toString('base64')}, 60_000),
        r => text(`Added ${r.name} (${kB(r.bytes)}). Play it with \`add_sound "${r.name}"\` (Manim style) or \`sound("${r.name}").play()\` (Canvas Commons style).\nSounds in the project: ${r.sounds.map(s => s.name).join(', ')}.`),
      );
    },
  );

  server.registerTool(
    'reveal_in_editor',
    {
      title: 'Point the user at something',
      description: 'Move the editor to a source line, a time, or a timeline step (1-based), so the user sees what you are talking about. Does not change the scene.',
      inputSchema: {
        line: z.number().int().min(1).optional(),
        time: z.number().min(0).optional(),
        step: z.number().int().min(1).optional(),
      },
    },
    async ({line, time, step}) =>
      viaEditor(
        () => link.call('reveal', {line, time, step: step === undefined ? undefined : step - 1}),
        () => text('Done.'),
      ),
  );

  // ----------------------------------------------------------- resources

  for (const t of topics) {
    server.registerResource(
      `docs-${t.name}`,
      `mce://docs/${t.name}`,
      {title: t.title, description: t.summary, mimeType: 'text/markdown'},
      async uri => ({contents: [{uri: uri.href, mimeType: 'text/markdown', text: t.text}]}),
    );
  }
  server.registerResource(
    'example',
    new ResourceTemplate('mce://examples/{slug}', {
      list: async () => {
        try {
          return {
            resources: (await examples(link)).map(e => ({uri: `mce://examples/${e.slug}`, name: e.slug, title: e.title, description: e.description, mimeType: 'text/plain'})),
          };
        } catch {
          return {resources: []};
        }
      },
    }),
    {title: 'Example scene', description: 'A bundled example scene (Civet).', mimeType: 'text/plain'},
    async (uri, {slug}) => {
      const ex = (await examples(link)).find(e => e.slug === slug);
      if (!ex) throw new Error(`No example "${slug}"`);
      return {contents: [{uri: uri.href, mimeType: 'text/plain', text: ex.code}]};
    },
  );
  server.registerResource(
    'open-scene',
    'mce://editor/scene',
    {title: 'Open scene', description: 'The source of the document open in the editor (needs the editor).', mimeType: 'text/plain'},
    async uri => {
      const s = await link.call('state', {includeSource: true});
      return {contents: [{uri: uri.href, mimeType: 'text/plain', text: s.source ?? ''}]};
    },
  );

  // ------------------------------------------------------------- prompts

  server.registerPrompt(
    'review_scene',
    {
      title: 'Review the open scene',
      description: 'Review the scene open in the editor for bugs, timing, layout and idiom, without editing it.',
      argsSchema: {focus: z.string().optional().describe('Something to look at in particular.')},
    },
    ({focus}) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Review the scene open in the Motion Canvas Editor. Do not edit it.',
              '1. Read the checklist: read_docs topic "review-checklist".',
              '2. get_editor_state, then check_scene (it runs the scene and lists problems and hints).',
              '3. render_preview to see it; inspect_frame at times that look wrong.',
              '4. Report findings ordered by severity, each with its line number, what the viewer sees, and the fix. Verify a hint before reporting it: they are heuristics.',
              'Use reveal_in_editor to show the user the most important one.',
              focus ? `Pay particular attention to: ${focus}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'port_manim_scene',
    {
      title: 'Port a Manim Python scene',
      description: 'Bring a Manim Community scene into the editor and make it run.',
      argsSchema: {python: z.string().describe('The Manim Community Python source.')},
    },
    ({python}) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Port this Manim Community scene to the Motion Canvas Editor.',
              '1. check_scene with language "python": it converts the Python and lists what will not work here.',
              '2. lookup_api for anything reported as unknown; find the closest supported replacement (read_docs "manim-reference", "Known differences").',
              '3. open_scene with the code (language "python" is converted automatically), then fix the remaining problems with edit_scene.',
              '4. render_preview and compare with what the Python scene is meant to show.',
              '',
              '```python',
              python,
              '```',
            ].join('\n'),
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'create_scene',
    {
      title: 'Create a scene',
      description: 'Write a new scene from a description.',
      argsSchema: {
        description: z.string().describe('What the animation should show.'),
        style: z.enum(['manim', 'canvas-commons']).optional().describe('Default manim.'),
      },
    },
    ({description, style}) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Create a ${style === 'canvas-commons' ? 'Canvas Commons-style' : 'Manim-style'} scene in the Motion Canvas Editor that shows: ${description}`,
              `1. read_docs "quickstart" and "${style === 'canvas-commons' ? 'canvas-commons-style' : 'manim-style'}"; get_example for a similar example.`,
              '2. lookup_api for every class you are not sure exists here.',
              '3. Write it (TSX is fine if you are unsure of Civet), check_scene, fix, then open_scene with the code.',
              '4. render_preview, adjust layout and timing, and summarise the result for the user.',
              '5. If they asked for a file (a video, a GIF, something to embed), export_scene.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}

/** Source with line numbers, so the agent can match problems to lines. */
function numbered(source: string): string {
  const lines = source.split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)}│ ${l}`).join('\n');
}
