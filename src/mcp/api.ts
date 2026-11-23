/**
 * API lookup for agents: does a name exist in this editor, what is it, and
 * how is it called. Answers come from the code itself (the Manim layer's
 * classes, their `kw(...)` argument lists and methods) and from Canvas
 * Commons' type declarations when `node_modules` is present.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import * as cc2d from '@canvas-commons/2d';
import * as core from '@canvas-commons/core';
import * as manim from '../manim';
import * as rateFunctions from '../manim/rate_functions';
import {api, apiNames, Animation, Mobject, Scene} from '../manim';
import {camel, snake} from '../manim/util';
import {suggestNames, UNSUPPORTED} from '../runtime/hints';
import manimReference from '../../docs/manim-compatibility.md' with {type: 'text'};

type Source = 'manim' | '@canvas-commons/2d' | '@canvas-commons/core';

const MAX_MEMBERS = 60;

function isClass(v: unknown): v is new (...args: any[]) => any {
  return typeof v === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(v));
}

/** The text of the balanced `{...}`/`[...]` starting at `start`. */
function balanced(text: string, start: number): string {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Positional names and keyword defaults from a Manim-layer class's `kw(...)` call. */
function constructorSignature(klass: any): string | null {
  const src = Function.prototype.toString.call(klass);
  const ctor = src.indexOf('constructor(');
  if (ctor < 0) return null;
  const m = /kw\(\s*[\w.]+\s*,\s*\[/.exec(src.slice(ctor));
  if (!m) return null;
  const at = ctor + m.index + m[0].length - 1;
  const names = balanced(src, at);
  const rest = src.slice(at + names.length).replace(/^\s*,\s*/, '');
  const defaults = rest.startsWith('{') ? balanced(rest, 0) : '{}';
  const positional = splitTopLevel(names.slice(1, -1)).map(s => s.replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
  const entries = splitTopLevel(defaults.slice(1, -1))
    .map(e => /^([\w$]+)\s*:\s*([\s\S]*)$/.exec(e))
    .filter((e): e is RegExpExecArray => !!e)
    .map(e => [e[1], e[2].replace(/\s+/g, ' ')] as const);
  const defaultOf = new Map(entries);
  const pos = positional.map(n => (defaultOf.has(n) ? `${snake(n)} = ${defaultOf.get(n)}` : snake(n)));
  const kwOnly = entries.filter(([k]) => !positional.includes(k)).map(([k, v]) => `${snake(k)}: ${v}`);
  return [...pos, ...(kwOnly.length ? [`{${kwOnly.join(', ')}}`] : [])].join(', ') || '…';
}

/** Split on commas that are not nested in brackets. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** Method names a class adds, per class along its prototype chain. */
function methodsByClass(klass: any): [string, string[]][] {
  const out: [string, string[]][] = [];
  const seen = new Set<string>();
  for (let proto = klass.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    const names: string[] = [];
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || seen.has(key) || !/^[a-z][\w$]*$/.test(key)) continue;
      // Snake aliases are generated; list each method once, in camelCase.
      if (key.includes('_') && Object.getOwnPropertyNames(proto).includes(camel(key))) continue;
      seen.add(key);
      names.push(key);
    }
    const owner = proto.constructor?.displayName ?? proto.constructor?.name ?? '?';
    if (names.length) out.push([owner, names.sort()]);
  }
  return out;
}

/** Table rows and sentences of the Manim reference that mention `name`. */
function referenceMentions(name: string): string[] {
  const needle = new RegExp('`' + name.replace(/[$]/g, '\\$') + '(?:[`(.\\s]|$)');
  const out: string[] = [];
  for (const line of manimReference.split('\n')) {
    if (needle.test(line)) out.push(line.trim().length > 400 ? line.trim().slice(0, 400) + '…' : line.trim());
    if (out.length >= 4) break;
  }
  return out;
}

function kindOfManim(name: string, value: any): string {
  if (isClass(value) || (typeof value === 'function' && value.prototype && isClass((manim as any)[name]))) {
    const klass = (manim as any)[name] ?? value;
    const proto = klass.prototype;
    if (proto instanceof Mobject || klass === Mobject) return 'mobject class';
    if (proto instanceof Animation || klass === Animation) return 'animation class';
    if (proto instanceof Scene || klass === Scene) return 'scene class';
    return 'class';
  }
  if (name in rateFunctions) return 'rate function';
  if (typeof value === 'function') return 'function';
  if (typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value)) return 'colour constant';
  if (Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number')) return 'vector constant';
  if (typeof value === 'number') return 'number constant';
  return typeof value === 'object' ? 'object' : 'constant';
}

function describeManim(name: string): string | null {
  if (!(name in api)) {
    // Methods: `set_fill` / `setFill` on some class.
    const camelName = camel(name);
    const owners: string[] = [];
    for (const n of apiNames) {
      const k = (manim as any)[n];
      if (!isClass(k)) continue;
      const own = Object.getOwnPropertyNames(k.prototype);
      if (own.includes(camelName) || own.includes(name)) owners.push(n);
    }
    if (!owners.length) return null;
    const lines = [`### \`${name}\` — Manim-layer method`, `Defined on: ${owners.slice(0, 12).map(o => `\`${o}\``).join(', ')}${owners.length > 12 ? ', …' : ''}`];
    lines.push(`Spellings: \`${snake(camelName)}\` and \`${camelName}\`.`);
    const mentions = referenceMentions(snake(camelName));
    if (mentions.length) lines.push('', 'From the Manim reference:', ...mentions.map(l => `> ${l}`));
    return lines.join('\n');
  }
  const value = api[name];
  const kind = kindOfManim(name, value);
  const lines = [`### \`${name}\` — ${kind} (Manim layer)`];
  if (UNSUPPORTED[name]) lines.push(`**Defined only so that scenes fail clearly: ${UNSUPPORTED[name]}.**`);
  if (kind.endsWith('constant')) lines.push(`Value: \`${JSON.stringify(value)}\``);
  const klass = (manim as any)[name];
  if (isClass(klass)) {
    const chain: string[] = [];
    for (let p = Object.getPrototypeOf(klass); p && p !== Function.prototype; p = Object.getPrototypeOf(p)) chain.push(p.displayName ?? p.name);
    if (chain.length) lines.push(`Extends: ${chain.join(' → ')}`);
    const sig = constructorSignature(klass);
    if (sig) lines.push(`Call: \`${name}(${sig})\`. Positional arguments first; keyword arguments go in a trailing object (\`${name} radius: 2\` in Civet, \`${name}({radius: 2})\` in TSX), snake_case or camelCase. No \`new\` needed.`);
    let listed = 0;
    for (const [owner, names] of methodsByClass(klass)) {
      if (listed >= MAX_MEMBERS) {
        lines.push(`- ${owner}: (${names.length} more methods)`);
        continue;
      }
      const shown = names.slice(0, MAX_MEMBERS - listed);
      listed += shown.length;
      lines.push(`- ${owner === name ? 'Own methods' : `From ${owner}`}: ${shown.map(n => snake(n)).join(', ')}${shown.length < names.length ? ', …' : ''}`);
    }
    if (listed) lines.push('Methods are shown in snake_case; the camelCase spelling works too.');
  } else if (typeof value === 'function') {
    const src = Function.prototype.toString.call(value);
    const params = /^[^(]*\(([^)]*)\)/.exec(src)?.[1];
    if (params !== undefined) lines.push(`Parameters: \`(${params.replace(/\s+/g, ' ').trim()})\``);
  }
  const mentions = referenceMentions(name);
  if (mentions.length) lines.push('', 'From the Manim reference (read_docs topic `manim-reference`):', ...mentions.map(l => `> ${l}`));
  return lines.join('\n');
}

// ------------------------------------------------------- Canvas Commons

interface DtsIndex {
  text: string;
  source: Source;
}
let dtsCache: DtsIndex[] | null = null;
function dtsFiles(): DtsIndex[] {
  if (dtsCache) return dtsCache;
  dtsCache = [];
  for (const [pkg, source] of [
    ['@canvas-commons/2d', '@canvas-commons/2d'],
    ['@canvas-commons/core', '@canvas-commons/core'],
  ] as const) {
    try {
      const dir = dirname(Bun.resolveSync(pkg, import.meta.dir));
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.d.ts') && !f.includes('jsx')) dtsCache.push({text: readFileSync(join(dir, f), 'utf8'), source});
      }
    } catch {
      // Packaged app without node_modules: runtime introspection only.
    }
  }
  return dtsCache;
}

const cleanDoc = (doc: string) =>
  doc
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map(l => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .replace(/\{@(?:link|inheritDoc)\s+([^}|]+)(?:\|[^}]*)?\}/g, '`$1`')
    .trim();

/** The JSDoc block that ends right before `index`. */
function docBefore(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 6000), index).trimEnd();
  if (!before.endsWith('*/')) return '';
  const start = before.lastIndexOf('/**');
  return start < 0 ? '' : cleanDoc(before.slice(start));
}

/** First paragraph plus the first example of a doc comment. */
function summarize(doc: string): string {
  const [first] = doc.split(/\n\s*\n|\n@/);
  const example = /@example[^\n]*\n```\w*\n([\s\S]*?)```/.exec(doc);
  return [first.trim(), example ? `Example:\n\`\`\`tsx\n${example[1].trimEnd()}\n\`\`\`` : ''].filter(Boolean).join('\n\n');
}

function describeCanvasCommons(name: string): string | null {
  const value = (cc2d as any)[name] ?? (core as any)[name];
  const source: Source = name in cc2d ? '@canvas-commons/2d' : '@canvas-commons/core';
  if (value === undefined) return null;
  const lines: string[] = [];
  const files = dtsFiles();
  if (isClass(value)) {
    const isNode = value === cc2d.Node || value.prototype instanceof cc2d.Node;
    lines.push(`### \`${name}\` — ${isNode ? 'node class' : 'class'} (\`import {${name}} from '${source}'\`)`);
    for (const {text} of files) {
      const m = new RegExp(`^declare (?:abstract )?class ${name}\\b([^{]*)\\{`, 'm').exec(text);
      if (!m) continue;
      const doc = docBefore(text, m.index);
      if (doc) lines.push(summarize(doc));
      const ext = /extends\s+([\w.]+)/.exec(m[1]);
      if (ext) lines.push(`Extends: ${ext[1]}`);
      const body = text.slice(m.index + m[0].length, text.indexOf('\n}', m.index));
      const signals: string[] = [];
      const methods: string[] = [];
      for (const mm of body.matchAll(/^ {2}(readonly |static |protected |private |get |set )*(\*?[A-Za-z_$][\w$]*)(\??)(<[^>]*>)?(\(([^)]*)\))?\s*:\s*([^;]+);/gm)) {
        const mods = mm[1] ?? '';
        if (/static|protected|private/.test(mods) || mm[2].startsWith('_')) continue;
        const memberDoc = docBefore(body, mm.index!).split('\n')[0].trim();
        if (mm[5] === undefined && /Signal/.test(mm[7])) {
          signals.push(`\`${mm[2]}\`: ${mm[7].replace(/,\s*this>/, '>').trim()}${memberDoc ? ` — ${memberDoc}` : ''}`);
        } else if (mm[5] !== undefined) {
          methods.push(`\`${mm[2]}(${mm[6].replace(/\s+/g, ' ').trim()})\``);
        }
      }
      if (signals.length) lines.push('Signals (JSX props of the same name; `node().prop()` reads, `node().prop(value)` sets, `yield* node().prop(value, seconds)` tweens):', ...signals.slice(0, MAX_MEMBERS).map(s => `- ${s}`));
      if (methods.length) lines.push(`Methods: ${methods.slice(0, MAX_MEMBERS).join(', ')}${methods.length > MAX_MEMBERS ? ', …' : ''}`);
      break;
    }
    if (lines.length === 1) {
      const methods = methodsByClass(value).flatMap(([, n]) => n);
      lines.push(`Methods: ${methods.slice(0, MAX_MEMBERS).join(', ')}`);
    }
  } else if (typeof value === 'function') {
    lines.push(`### \`${name}\` — function (\`import {${name}} from '${source}'\`)`);
    const signatures: string[] = [];
    let doc = '';
    for (const {text} of files) {
      for (const m of text.matchAll(new RegExp(`^declare function ${name}\\b[^\\n]*`, 'gm'))) {
        signatures.push(m[0].replace(/^declare function /, '').replace(/;$/, ''));
        doc ||= docBefore(text, m.index!);
      }
    }
    if (signatures.length) lines.push(...signatures.slice(0, 4).map(s => `\`${s}\``));
    if (doc) lines.push(summarize(doc));
  } else {
    lines.push(`### \`${name}\` — ${typeof value} (\`import {${name}} from '${source}'\`)`);
  }
  return lines.join('\n');
}

const UNSUPPORTED_NOTE =
  'Not part of this editor. The Manim layer covers the 2D core (see read_docs `manim-reference`, "Known differences"); Canvas Commons nodes cover the rest of the native API.';

/** Markdown answer for each name. */
export function lookupApi(names: string[]): string {
  const blocks: string[] = [];
  for (const raw of names.slice(0, 12)) {
    const name = raw.trim().replace(/\(\)$/, '').replace(/^\./, '');
    if (!name) continue;
    const parts: string[] = [];
    const m = describeManim(name);
    if (m) parts.push(m);
    if (/^[A-Za-z_$][\w$]*$/.test(name) && (name in cc2d || name in core)) {
      const c = describeCanvasCommons(name);
      if (c) parts.push(m ? `Also in Canvas Commons (a different thing; in a Manim scene the Manim one wins unless imported):\n${c}` : c);
    }
    if (!parts.length) {
      const candidates = new Set([...apiNames, ...Object.keys(cc2d), ...Object.keys(core)]);
      const near = suggestNames(name, candidates);
      const why = UNSUPPORTED[name] ? `Known gap: ${UNSUPPORTED[name]}. ` : '';
      parts.push(`### \`${name}\` — not found\n${why}${UNSUPPORTED_NOTE}${near.length ? `\nClosest names: ${near.map(n => `\`${n}\``).join(', ')}.` : ''}`);
    }
    blocks.push(parts.join('\n\n'));
  }
  return blocks.join('\n\n---\n\n');
}

/** Names containing `query`, grouped by where they come from. */
export function searchApi(query: string): string {
  const q = query.toLowerCase().replace(/[_\s]/g, '');
  const hit = (n: string) => n.toLowerCase().replace(/_/g, '').includes(q);
  const groups: Record<string, string[]> = {};
  const add = (group: string, n: string) => (groups[group] ??= []).push(n);
  for (const n of apiNames) {
    if (n.startsWith('__') || !hit(n)) continue;
    add(`Manim layer: ${kindOfManim(n, api[n])}`, n);
  }
  // Manim-layer methods.
  const methods = new Set<string>();
  for (const n of apiNames) {
    const k = (manim as any)[n];
    if (!isClass(k)) continue;
    for (let p = k.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const key of Object.getOwnPropertyNames(p)) if (!key.startsWith('_') && key !== 'constructor' && hit(key)) methods.add(snake(key));
    }
  }
  for (const m of [...methods].sort()) add('Manim layer: methods', m);
  for (const n of Object.keys(cc2d)) if (hit(n)) add('@canvas-commons/2d', n);
  for (const n of Object.keys(core)) if (hit(n)) add('@canvas-commons/core', n);
  const out = Object.entries(groups).map(([g, list]) => `- ${g}: ${[...new Set(list)].slice(0, 40).join(', ')}${list.length > 40 ? ', …' : ''}`);
  return out.length ? `Names matching "${query}":\n${out.join('\n')}\n\nUse lookup_api with exact names for details.` : `Nothing matches "${query}". ${UNSUPPORTED_NOTE}`;
}
