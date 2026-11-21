/**
 * LaTeX mobjects. MathJax typesets the formula to SVG outlines, which become
 * ordinary VMobjects, so formulas can be written, morphed and recoloured
 * glyph by glyph exactly like in Manim.
 */
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {cornersToPoints, Points, svgPathToPoints} from './bezier';
import {config, DEFAULT_FONT_SIZE, WHITE} from './constants';
import {Mobject, VGroup, VMobject} from './mobject';
import {aliasFields, aliasSnake, splitKw} from './util';

/**
 * Em size, in Manim units, of TeX at `font_size` 1. Manim scales the 10pt
 * LaTeX output by `font_size / 960`, so one em is `10 / 960` units per point.
 */
export const TEX_EM_PER_FONT_SIZE = 10 / 960;

let jax: {adaptor: any; doc: any} | null = null;
function engine() {
  if (!jax) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document('', {
      InputJax: new TeX({packages: AllPackages}),
      OutputJax: new SVG({fontCache: 'none'}),
    });
    jax = {adaptor, doc};
  }
  return jax;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY;
  if (!value) return m;
  for (const [, fn, raw] of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = multiply(m, [1, 0, 0, 1, a[0], a[1] ?? 0]);
    else if (fn === 'scale') m = multiply(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
    else if (fn === 'matrix') m = multiply(m, a as Matrix);
  }
  return m;
}

const cache = new Map<string, Points[]>();

/** Typeset `tex` and return one outline (in em, y up) per glyph or rule. */
export function texToOutlines(tex: string, display = true): Points[] {
  const key = `${display}:${tex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const {adaptor, doc} = engine();
  const root = doc.convert(tex, {display});
  const out: Points[] = [];
  const walk = (node: any, m: Matrix) => {
    if (!node || node.kind === '#text') return;
    const attr = node.attributes ?? {};
    if (attr['data-mjx-error'] || attr['data-mml-node'] === 'merror') {
      throw new Error(`LaTeX error in ${JSON.stringify(tex)}: ${attr.title ?? adaptor.textContent(node)}`);
    }
    const local = multiply(m, parseTransform(attr.transform));
    const map = (p: number[]) => [
      (local[0] * p[0] + local[2] * p[1] + local[4]) / 1000,
      -(local[1] * p[0] + local[3] * p[1] + local[5]) / 1000,
      0,
    ];
    if (node.kind === 'path' && attr.d) {
      const pts = svgPathToPoints(attr.d).map(map);
      if (pts.length) out.push(pts);
    } else if (node.kind === 'rect') {
      const x = Number(attr.x ?? 0);
      const y = Number(attr.y ?? 0);
      const w = Number(attr.width);
      const h = Number(attr.height);
      out.push(
        cornersToPoints([
          [x, y, 0],
          [x + w, y, 0],
          [x + w, y + h, 0],
          [x, y + h, 0],
          [x, y, 0],
        ]).map(map),
      );
    } else if (node.kind === 'defs' || node.kind === 'title') {
      return;
    }
    for (const child of node.children ?? []) walk(child, local);
  };
  walk(root, IDENTITY);
  cache.set(key, out);
  return out;
}

/** Macros LaTeX has and MathJax lacks. */
const LOGOS: [RegExp, string][] = [
  [/\\LaTeX(?![a-zA-Z])/g, '\\mathrm{L\\kern-.36em\\raise.3ex{\\scriptsize A}\\kern-.15em T\\kern-.1667em\\lower.5ex{E}\\kern-.125em X}'],
  [/\\TeX(?![a-zA-Z])/g, '\\mathrm{T\\kern-.1667em\\lower.5ex{E}\\kern-.125em X}'],
];

/** Split on `\\` line breaks that are not nested in braces or environments. */
export function splitTexLines(tex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let env = 0;
  let current = '';
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') {
      const next = tex[i + 1];
      if (next === '\\' && depth === 0 && env === 0) {
        out.push(current);
        current = '';
        i++;
        continue;
      }
      if (tex.startsWith('\\begin', i)) env++;
      else if (tex.startsWith('\\end', i)) env--;
      current += c + (next ?? '');
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    current += c;
  }
  out.push(current);
  return out;
}

function boundsOf(outlines: Points[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pts of outlines) {
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return [x0, y0, x1, y1];
}

/** LaTeX's `\baselineskip` at 10pt, in em. */
const BASELINE_SKIP = 1.2;

/**
 * Typeset a formula (`text = false`, Manim's `MathTex`) or a line of prose
 * (`text = true`, Manim's `Tex`). Prose may contain `$math$` and `\\` line
 * breaks; lines are centred like LaTeX's `center` environment.
 */
export function typeset(tex: string, text: boolean): Points[] {
  if (!text) {
    const needsAlign = /\\\\|(?<!\\)&/.test(tex) && !/\\begin\{/.test(tex);
    return texToOutlines(needsAlign ? `\\begin{aligned}${tex}\\end{aligned}` : tex);
  }
  const line = (s: string): Points[] => {
    if (s.trim() === '') return [];
    let body = s;
    for (const [re, to] of LOGOS) body = body.replace(re, `$${to}$`);
    return texToOutlines(`\\text{${body}}`);
  };
  const lines = splitTexLines(tex);
  if (lines.length === 1) return line(lines[0]);
  const out: Points[] = [];
  lines.forEach((l, row) => {
    const outlines = line(l);
    if (!outlines.length) return;
    const [x0, , x1] = boundsOf(outlines);
    const dx = -(x0 + x1) / 2;
    const dy = -row * BASELINE_SKIP;
    for (const pts of outlines) out.push(pts.map(p => [p[0] + dx, p[1] + dy, 0]));
  });
  return out;
}

/** Number of glyph outlines a fragment produces on its own (null if it fails). */
function glyphCount(tex: string, text: boolean): number | null {
  try {
    return typeset(tex, text).length;
  } catch {
    return null;
  }
}

/** Close the braces a truncated formula leaves open, so it can be typeset. */
function closeBraces(tex: string): string {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === '\\') i++;
    else if (tex[i] === '{') depth++;
    else if (tex[i] === '}') depth = Math.max(0, depth - 1);
  }
  // A trailing `^` or `_` would have nothing to attach.
  return tex.replace(/[\^_]\s*$/, '') + '}'.repeat(depth);
}

/** Break `parts` further so that each isolated substring is its own part. */
function isolate(parts: string[], substrings: string[]): string[] {
  let out: string[] = [];
  // Manim's `{{ a }}` double-brace notation.
  for (const part of parts) {
    if (part.includes('{{')) out.push(...part.split(/\{\{|\}\}/).filter(s => s.trim() !== ''));
    else out.push(part);
  }
  const subs = substrings.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!subs.length) return out;
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${subs.map(escape).join('|')})`);
  out = out.flatMap(part => part.split(re).filter(piece => piece !== ''));
  return out;
}

export class MathTex extends VGroup {
  public texStrings: string[];
  public texString: string;
  protected _fontSize: number;
  protected initialHeight: number;
  protected texEnvironment: 'math' | 'text' = 'math';

  public constructor(...args: any[]) {
    const [parts, o] = splitKw(args);
    super({name: o.name});
    // Manim: `align*` for MathTex, `center` for Tex.
    if (o.texEnvironment === 'center' || o.texEnvironment === 'text') this.texEnvironment = 'text';
    const text = this.texEnvironment === 'text';
    const toIsolate: string[] = [...(o.substringsToIsolate ?? []), ...Object.keys(o.texToColorMap ?? {})];
    this.texStrings = isolate(parts.map(String), toIsolate);
    this._fontSize = o.fontSize ?? DEFAULT_FONT_SIZE;
    const sep = o.argSeparator ?? (text ? '' : ' ');
    this.texString = this.texStrings.join(sep);
    const em = this._fontSize * TEX_EM_PER_FONT_SIZE;
    const color = o.color ?? o.fillColor ?? WHITE;
    const outlines = typeset(this.texString, text);
    const glyphs = outlines.map(points => {
      const g = new VMobject({color, fillOpacity: 1, strokeWidth: 0, name: 'glyph'});
      g.points = points;
      g.sourceLine = this.sourceLine;
      (g as any)._fills = true;
      return g;
    });
    // Slice the glyph run into one group per part. The number of glyphs a
    // part contributes is measured by typesetting the formula up to that
    // part (with open braces closed), so parts keep their context:
    // `e^{i`, `\pi`, `}` works.
    let cursor = 0;
    let prefix = '';
    this.texStrings.forEach((part, i) => {
      let count = glyphs.length - cursor;
      if (i < this.texStrings.length - 1) {
        prefix += (i ? sep : '') + part;
        const upTo = glyphCount(closeBraces(prefix), text);
        count = Math.max(0, Math.min(count, upTo !== null ? upTo - cursor : (glyphCount(part, text) ?? 0)));
      }
      const group = new VGroup(...glyphs.slice(cursor, cursor + count));
      group.name = part;
      (group as any).texString = part;
      cursor += count;
      this.add(group);
    });
    this.scale(em, {aboutPoint: [0, 0, 0]});
    this.center();
    this.initialHeight = this.getHeight() / this._fontSize;
    if (o.fillOpacity !== undefined) this.setFill({opacity: o.fillOpacity});
    if (o.strokeWidth !== undefined) this.setStroke({width: o.strokeWidth});
    if (o.texToColorMap) this.setColorByTexToColorMap(o.texToColorMap);
  }

  /** Like Manim, the font size follows the mobject's current height. */
  public get fontSize(): number {
    return this.initialHeight > 0 ? this.getHeight() / this.initialHeight : this._fontSize;
  }
  public set fontSize(value: number) {
    const current = this.fontSize;
    if (value > 0 && current > 0) this.scale(value / current);
  }
  public get font_size(): number {
    return this.fontSize;
  }
  public set font_size(value: number) {
    this.fontSize = value;
  }

  public getPartByTex(tex: string, ...rest: any[]): Mobject | undefined {
    return this.getPartsByTex(tex, ...rest).submobjects[0];
  }
  /** Parts whose TeX contains `tex` (pass `substring: false` for exact matches). */
  public getPartsByTex(tex: string, ...rest: any[]): VGroup {
    const [, o] = splitKw(rest);
    const test = (s: string) => (o.substring === false ? s === tex : s.includes(tex));
    return new VGroup(...this.submobjects.filter(s => test((s as any).texString ?? '')));
  }
  public setColorByTex(tex: string, color: any, ...rest: any[]): this {
    for (const part of this.getPartsByTex(tex, ...rest)) part.setColor(color);
    return this;
  }
  public setColorByTexToColorMap(map: Record<string, any>, ...rest: any[]): this {
    for (const key of Object.keys(map)) this.setColorByTex(key, map[key], ...rest);
    return this;
  }
  public setOpacityByTex(tex: string, opacity = 0.5, remainingOpacity?: number): this {
    if (remainingOpacity !== undefined) this.setOpacity(remainingOpacity);
    for (const part of this.getPartsByTex(tex)) part.setOpacity(opacity);
    return this;
  }
  public indexOfPart(part: Mobject): number {
    return this.submobjects.indexOf(part);
  }
  public indexOfPartByTex(tex: string, ...rest: any[]): number {
    const part = this.getPartByTex(tex, ...rest);
    return part ? this.submobjects.indexOf(part) : -1;
  }
}

export class SingleStringMathTex extends MathTex {}

export class Tex extends MathTex {
  public constructor(...args: any[]) {
    const [parts, o] = splitKw(args);
    super(...parts, {texEnvironment: 'center', ...o});
  }
}

/** A TeX heading at the top of the frame, with an underline (Manim's `Title`). */
export class Title extends Tex {
  public underline?: VMobject;
  public constructor(...args: any[]) {
    const [parts, o] = splitKw(args);
    super(...parts, o);
    this.toEdge([0, 1, 0]);
    if (o.includeUnderline ?? true) {
      const y = this.getBottom()[1] - (o.underlineBuff ?? 0.25);
      const half = o.matchUnderlineWidthToText ? this.getWidth() / 2 : config.frameWidth / 2 - 1;
      const line = new VMobject({color: WHITE, strokeWidth: 4, name: 'Underline'});
      line.points = cornersToPoints([
        [this.getCenter()[0] - half, y, 0],
        [this.getCenter()[0] + half, y, 0],
      ]);
      this.underline = line;
      this.add(line);
    }
  }
}

for (const klass of [MathTex]) aliasSnake(klass.prototype);
aliasFields(MathTex.prototype, ['texString', 'texStrings']);
// Part groups are plain VGroups that carry their TeX source.
aliasFields(VGroup.prototype, ['texString']);

VMobject.prototype._fillsByDefault = function (this: any) {
  return !!this._fills;
};
