/**
 * Text mobjects. Each visible character is its own leaf mobject (as in
 * Manim), so `text[0..4].set_color RED`, `Write`, lagged fades and per-letter
 * transforms all work. Glyphs are painted with the canvas text API.
 */
import {DEFAULT_FONT_SIZE, WHITE} from './constants';
import {AffineOp, Bounds, Mobject, VGroup} from './mobject';
import {aliasSnake, kw, rgba, toHex} from './util';
import {rotate, Vec} from './vec';

export const NORMAL = 'normal';
export const BOLD = 'bold';
export const ITALIC = 'italic';

/** Em size, in Manim units, of text at `font_size` 1. */
export const TEXT_EM_PER_FONT_SIZE = 0.6 / 48;

const MEASURE_PX = 200;
let measureCtx: CanvasRenderingContext2D | null = null;
function measure(font: string, text: string): TextMetrics {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  measureCtx.font = font.replace('{size}', `${MEASURE_PX}px`);
  return measureCtx.measureText(text);
}

export const textDefaults = {
  font: 'Inter, "Helvetica Neue", "Segoe UI", Arial, "Noto Sans", sans-serif',
};

export class Glyph extends Mobject {
  public char = '';
  /** CSS font shorthand with a `{size}` placeholder. */
  public font = '';
  /** Em size in units at scale 1. */
  public em = 1;
  /** Baseline origin. */
  public pos: Vec = [0, 0, 0];
  public sx = 1;
  public sy = 1;
  public rot = 0;
  /** Ink box relative to the origin, in em: left, bottom, right, top. */
  public box: Bounds = [0, 0, 0, 0];
  /** Portion of the outline that is stroked, used by `Write`. */
  public partial: [number, number] | null = null;

  public constructor(o: Record<string, any> = {}) {
    super(o);
    this.fillOpacity = 1;
    this.strokeWidth = 0;
  }
  public override hasPoints() {
    return true;
  }
  public override _kind() {
    return 'glyph';
  }
  public override _fillsByDefault() {
    return true;
  }

  private corners(): Vec[] {
    const [l, b, r, t] = this.box;
    const e = this.em;
    return [
      [l, b],
      [r, b],
      [r, t],
      [l, t],
    ].map(([x, y]) => {
      const p = rotate([x * e * this.sx, y * e * this.sy, 0], this.rot);
      return [p[0] + this.pos[0], p[1] + this.pos[1], 0];
    });
  }

  public override _ownBounds(): Bounds {
    const c = this.corners();
    return [
      Math.min(...c.map(p => p[0])),
      Math.min(...c.map(p => p[1])),
      Math.max(...c.map(p => p[0])),
      Math.max(...c.map(p => p[1])),
    ];
  }

  public override _affine(op: AffineOp): void {
    if (op.type === 'shift') {
      this.pos = [this.pos[0] + op.v[0], this.pos[1] + op.v[1], 0];
    } else if (op.type === 'scale') {
      this.pos = [
        op.about[0] + (this.pos[0] - op.about[0]) * op.fx,
        op.about[1] + (this.pos[1] - op.about[1]) * op.fy,
        0,
      ];
      this.sx *= op.fx;
      this.sy *= op.fy;
    } else {
      this.pos = rotate(this.pos, op.angle, op.about);
      this.rot += op.angle;
    }
  }

  public override _copyData(from: Mobject): void {
    super._copyData(from);
    if (from instanceof Glyph) {
      this.char = from.char;
      this.font = from.font;
      this.em = from.em;
      this.pos = from.pos;
      this.sx = from.sx;
      this.sy = from.sy;
      this.rot = from.rot;
      this.box = from.box;
      this.partial = from.partial;
    }
  }

  public override _lerp(a: Mobject, b: Mobject, t: number): void {
    super._lerp(a, b, t);
    if (a instanceof Glyph && b instanceof Glyph) {
      const mix = (x: number, y: number) => x + (y - x) * t;
      this.pos = [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), 0];
      this.sx = mix(a.sx * a.em, b.sx * b.em) / this.em;
      this.sy = mix(a.sy * a.em, b.sy * b.em) / this.em;
      this.rot = mix(a.rot, b.rot);
      if (a.char !== b.char) {
        // Different characters cross-fade at the midpoint.
        const src = t < 0.5 ? a : b;
        this.char = src.char;
        this.font = src.font;
        this.box = src.box;
        const k = Math.abs(1 - 2 * t);
        this.fillOpacity *= k;
        this.strokeOpacity *= k;
      } else {
        this.char = a.char;
      }
    }
  }

  public override _draw(ctx: CanvasRenderingContext2D, u: number): void {
    const fill = this.fillOpacity > 0.001;
    const stroke = this.strokeOpacity > 0.001 && this.strokeWidth > 0.001;
    if (!fill && !stroke) return;
    const size = this.em * u;
    ctx.save();
    ctx.translate(this.pos[0] * u, -this.pos[1] * u);
    if (this.rot) ctx.rotate(-this.rot);
    if (this.sx !== 1 || this.sy !== 1) ctx.scale(this.sx, this.sy);
    ctx.font = this.font.replace('{size}', `${size}px`);
    ctx.textBaseline = 'alphabetic';
    if (fill) {
      ctx.fillStyle = rgba(this.fillColor, this.fillOpacity);
      ctx.fillText(this.char, 0, 0);
    }
    if (stroke) {
      ctx.strokeStyle = rgba(this.strokeColor, this.strokeOpacity);
      ctx.lineWidth = (this.strokeWidth * 0.01 * u) / Math.max(Math.abs(this.sx), 1e-6);
      ctx.lineJoin = 'round';
      if (this.partial) {
        // An outline's length is unknown, so over-estimate and dash it.
        const len = size * 8;
        const [a, b] = this.partial;
        ctx.setLineDash([Math.max(0, (b - a) * len), len]);
        ctx.lineDashOffset = -a * len;
      }
      ctx.strokeText(this.char, 0, 0);
    }
    ctx.restore();
  }
}

export class Text extends VGroup {
  public text: string;
  public fontSize: number;
  public chars: Glyph[] = [];

  public constructor(...args: any[]) {
    const o = kw(args, ['text'], {
      text: '',
      fontSize: DEFAULT_FONT_SIZE,
      font: undefined,
      weight: NORMAL,
      slant: NORMAL,
      lineSpacing: 1.25,
      color: WHITE,
    });
    super({name: o.name});
    this.text = String(o.text);
    this.fontSize = o.fontSize;
    const family = o.font ? `"${o.font}", ${textDefaults.font}` : textDefaults.font;
    const font = `${o.slant === ITALIC ? 'italic ' : ''}${o.weight === BOLD ? 'bold ' : `${o.weight} `}{size} ${family}`;
    const em = o.fontSize * TEXT_EM_PER_FONT_SIZE;
    const lines = this.text.split('\n');
    let index = 0;
    lines.forEach((line, row) => {
      for (let i = 0; i < line.length; ) {
        const cp = line.codePointAt(i)!;
        const char = String.fromCodePoint(cp);
        const start = i;
        i += char.length;
        index++;
        if (/\s/.test(char)) continue;
        const prefix = measure(font, line.slice(0, start)).width / MEASURE_PX;
        const m = measure(font, char);
        const g = new Glyph({name: `'${char}'`});
        g.sourceLine = this.sourceLine;
        g.char = char;
        g.font = font;
        g.em = em;
        g.box = [
          -m.actualBoundingBoxLeft / MEASURE_PX,
          -m.actualBoundingBoxDescent / MEASURE_PX,
          m.actualBoundingBoxRight / MEASURE_PX,
          m.actualBoundingBoxAscent / MEASURE_PX,
        ];
        g.pos = [prefix * em, -row * em * o.lineSpacing, 0];
        (g as any).textIndex = index - 1;
        this.chars.push(g);
        this.add(g);
      }
      index++; // the newline
    });
    this.setColor(o.color);
    if (o.fillOpacity !== undefined) this.setFill({opacity: o.fillOpacity});
    if (o.strokeWidth !== undefined) this.setStroke({width: o.strokeWidth});
    for (const [map, apply] of [
      [o.t2c, (g: Glyph, v: any) => g.setColor(v)],
      [o.t2w, (g: Glyph, v: any) => (g.font = g.font.replace(/^(italic )?\S+ /, `$1${v} `))],
    ] as const) {
      if (!map) continue;
      for (const key of Object.keys(map)) {
        let from = 0;
        for (;;) {
          const at = this.text.indexOf(key, from);
          if (at < 0 || key.length === 0) break;
          for (const g of this.chars) {
            const ti = (g as any).textIndex;
            if (ti >= at && ti < at + key.length) apply(g, map[key]);
          }
          from = at + key.length;
        }
      }
    }
    this.center();
  }

  public _onCopy(original: Text) {
    const fam = original.submobjects;
    this.chars = original.chars
      .map(g => this.submobjects[fam.indexOf(g)] as Glyph)
      .filter(Boolean);
  }
}

export class Paragraph extends Text {
  public constructor(...args: any[]) {
    const o = kw(args, [], {});
    const lines = args.filter(a => typeof a === 'string');
    super(lines.join('\n'), o);
  }
}

export class Title extends Text {
  public constructor(...args: any[]) {
    super(...args);
    this.toEdge([0, 1, 0]);
  }
}

export {toHex};
for (const klass of [Glyph, Text]) aliasSnake(klass.prototype);
Object.defineProperty(Text.prototype, 'font_size', {
  get(this: Text) {
    return this.fontSize;
  },
});
