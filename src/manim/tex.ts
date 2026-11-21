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
import {DEFAULT_FONT_SIZE, WHITE} from './constants';
import {Mobject, VGroup, VMobject} from './mobject';
import {splitKw} from './util';

/** Em size, in Manim units, of TeX at `font_size` 1. */
export const TEX_EM_PER_FONT_SIZE = 0.55 / 48;

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

export class MathTex extends VGroup {
  public texStrings: string[];
  public texString: string;
  public fontSize: number;
  protected texEnvironment: 'math' | 'text' = 'math';

  public constructor(...args: any[]) {
    const [parts, o] = splitKw(args);
    super({name: o.name});
    this.texStrings = parts.map(String);
    this.fontSize = o.fontSize ?? DEFAULT_FONT_SIZE;
    if (o._text) this.texEnvironment = 'text';
    const sep = o.argSeparator ?? ' ';
    this.texString = this.texStrings.join(sep);
    const wrap = (s: string) => (this.texEnvironment === 'text' ? `\\text{${s}}` : s);
    const em = this.fontSize * TEX_EM_PER_FONT_SIZE;
    const outlines = texToOutlines(wrap(this.texString));
    const glyphs = outlines.map(points => {
      const g = new VMobject({color: o.color ?? WHITE, fillOpacity: 1, strokeWidth: 0, name: 'glyph'});
      g.points = points;
      g.sourceLine = this.sourceLine;
      (g as any)._fills = true;
      return g;
    });
    // Slice the glyph run by how many glyphs each part produces on its own,
    // which is how Manim maps substrings to submobjects.
    let cursor = 0;
    this.texStrings.forEach((part, i) => {
      let count = glyphs.length - cursor;
      if (i < this.texStrings.length - 1) {
        try {
          count = Math.min(count, texToOutlines(wrap(part)).length);
        } catch {
          count = 0;
        }
      }
      const group = new VGroup(...glyphs.slice(cursor, cursor + count));
      group.name = part;
      (group as any).texString = part;
      cursor += count;
      this.add(group);
    });
    this.scale(em, {aboutPoint: [0, 0, 0]});
    this.center();
    if (o.fillOpacity !== undefined) this.setFill({opacity: o.fillOpacity});
    if (o.texToColorMap) this.setColorByTexToColorMap(o.texToColorMap);
  }

  public getPartByTex(tex: string): Mobject | undefined {
    return this.submobjects.find(s => (s as any).texString === tex);
  }
  public getPartsByTex(tex: string): VGroup {
    return new VGroup(...this.submobjects.filter(s => (s as any).texString === tex));
  }
  public setColorByTex(tex: string, color: any): this {
    for (const part of this.getPartsByTex(tex)) part.setColor(color);
    return this;
  }
  public setColorByTexToColorMap(map: Record<string, any>): this {
    for (const key of Object.keys(map)) this.setColorByTex(key, map[key]);
    return this;
  }
}

export class Tex extends MathTex {
  public constructor(...args: any[]) {
    const [parts, o] = splitKw(args);
    super(...parts, {...o, _text: true});
  }
}

for (const klass of [MathTex]) {
  for (const name of Object.getOwnPropertyNames(klass.prototype)) {
    if (name === 'constructor' || !/[A-Z]/.test(name)) continue;
    const alias = name.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    Object.defineProperty(klass.prototype, alias, Object.getOwnPropertyDescriptor(klass.prototype, name)!);
  }
}

VMobject.prototype._fillsByDefault = function (this: any) {
  return !!this._fills;
};
