/** Value trackers, number displays and coordinate systems. */
import {cornersToPoints, Points, smoothPoints} from './bezier';
import {
  BLACK,
  BLUE,
  BLUE_D,
  DEFAULT_ARROW_TIP_LENGTH,
  DEFAULT_DOT_RADIUS,
  DOWN,
  GREEN,
  LEFT,
  MED_SMALL_BUFF,
  ORIGIN,
  PURE_YELLOW,
  RIGHT,
  SMALL_BUFF,
  UP,
  WHITE,
  config,
} from './constants';
import {DashedLine, Dot, Line, Polygon} from './geometry';
import {Bounds, Mobject, VGroup, VMobject} from './mobject';
import {MathTex, TEX_EM_PER_FONT_SIZE, texToOutlines} from './tex';
import {aliasFields, aliasSnake, color_gradient, invert_color, kw, splitKw, toHex} from './util';
import {add, lerp, mul, normalize, sub, Vec} from './vec';

export class ValueTracker extends Mobject {
  public value: number;
  public constructor(value = 0) {
    super({});
    this.value = value;
  }
  public override _kind() {
    return 'tracker';
  }
  public getValue(): number {
    return this.value;
  }
  public setValue(value: number): this {
    this.value = value;
    return this;
  }
  public incrementValue(d: number): this {
    this.value += d;
    return this;
  }
  public override _copyData(from: Mobject): void {
    if (from instanceof ValueTracker) this.value = from.value;
  }
  public override _lerp(a: Mobject, b: Mobject, t: number): void {
    if (a instanceof ValueTracker && b instanceof ValueTracker) {
      this.value = a.value + (b.value - a.value) * t;
    }
  }
}

/** Rebuild a mobject every frame from a function (Manim's `always_redraw`). */
export function always_redraw<T extends Mobject>(fn: () => T): T {
  const mob = fn();
  mob.addUpdater((m: Mobject) => {
    m.become(fn());
  });
  return mob;
}

/** A group whose members can also be looked up by name (`vdict["key"]`). */
export class VDict extends VGroup {
  public constructor(...args: any[]) {
    const [pos, o] = splitKw(args);
    super({name: o.name});
    const entries = pos[0];
    if (entries && !(entries instanceof Mobject)) {
      for (const [key, value] of Array.isArray(entries) ? entries : Object.entries(entries)) {
        this.addKeyValuePair(key, value as Mobject);
      }
    }
  }
  public addKeyValuePair(key: string, value: Mobject): this {
    if ((this as any)[key] instanceof Mobject) this.remove((this as any)[key]);
    (this as any)[key] = value;
    this.add(value);
    return this;
  }
  public get(key: string): Mobject {
    return (this as any)[key];
  }
}

interface TexChar {
  outlines: Points[];
  box: Bounds;
}
const texCharCache = new Map<string, TexChar>();
/** Outline of one TeX character in em units, with its ink box. */
function texChar(c: string): TexChar {
  let hit = texCharCache.get(c);
  if (!hit) {
    const outlines = texToOutlines(c);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const pts of outlines) {
      for (const p of pts) {
        x0 = Math.min(x0, p[0]);
        y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]);
        y1 = Math.max(y1, p[1]);
      }
    }
    hit = {outlines, box: outlines.length ? [x0, y0, x1, y1] : [0, 0, 0, 0]};
    texCharCache.set(c, hit);
  }
  return hit;
}

/** Manim's `digit_buff_per_font_unit`, converted to em. */
const DIGIT_BUFF_EM = 0.001 / TEX_EM_PER_FONT_SIZE;

/**
 * A number typeset with TeX digits. Each character is its own submobject, and
 * `set_value` swaps outlines in place, so it is cheap to update every frame.
 */
export class DecimalNumber extends VGroup {
  public number: number;
  private o: Record<string, any>;
  /** Em size in Manim units, and the height the current glyphs were built at. */
  private em: number;
  private builtHeight = 0;

  public constructor(...args: any[]) {
    const o = kw(args, ['number', 'numDecimalPlaces'], {
      number: 0,
      numDecimalPlaces: 2,
      includeSign: false,
      groupWithCommas: true,
      unit: undefined,
      fontSize: 48,
      color: WHITE,
      edgeToFix: LEFT,
    });
    super({name: o.name});
    this.o = o;
    this.number = o.number;
    this.em = o.fontSize * TEX_EM_PER_FONT_SIZE;
    this.rebuild();
  }

  private format(): string {
    const o = this.o;
    const places = Math.max(0, o.numDecimalPlaces);
    let s = Math.abs(this.number).toFixed(places);
    if (o.groupWithCommas) {
      const [int, frac] = s.split('.');
      s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? '.' + frac : '');
    }
    const isZero = Number(Math.abs(this.number).toFixed(places)) === 0;
    if (this.number < 0 && !isZero) s = '-' + s;
    else if (o.includeSign) s = '+' + s;
    return s;
  }

  private rebuild() {
    const had = this.submobjects.length > 0;
    const anchor = had ? this.getCriticalPoint(this.o.edgeToFix) : null;
    // Follow any scaling applied since the last build (Manim's `font_size`).
    if (had && this.builtHeight > 0) this.em *= this.getHeight() / this.builtHeight;
    const em = this.em;
    const chars = [...this.format()];
    const layout: {outlines: Points[]; dx: number; dy: number}[] = [];
    let cursor = 0;
    chars.forEach((c, i) => {
      const g = texChar(c);
      const [x0, y0, x1, y1] = g.box;
      let dy = -y0; // bottoms aligned
      if (c === '-' && i + 1 < chars.length) {
        // Vertically centre the minus on the following digit.
        const next = texChar(chars[i + 1]).box;
        dy = (next[3] - next[1]) / 2 - y1;
      } else if (c === ',') {
        dy -= (y1 - y0) / 2;
      }
      layout.push({outlines: g.outlines, dx: cursor - x0, dy});
      cursor += x1 - x0 + DIGIT_BUFF_EM;
    });
    if (this.o.unit) {
      const u = texChar(this.o.unit);
      const top = layout.reduce((m, l, i) => Math.max(m, texChar(chars[i]).box[3] + l.dy), 0);
      const dy = String(this.o.unit).startsWith('^') ? top - u.box[3] : -u.box[1];
      layout.push({outlines: u.outlines, dx: cursor - u.box[0], dy});
    }
    const reference = this.submobjects[0];
    const glyphs: Mobject[] = [];
    let k = 0;
    for (const item of layout) {
      for (const outline of item.outlines) {
        let g = this.submobjects[k] as VMobject | undefined;
        if (!(g instanceof VMobject)) {
          g = new VMobject({color: this.o.color, fillOpacity: 1, strokeWidth: 0, name: 'digit'});
          g.sourceLine = this.sourceLine;
          (g as any)._fills = true;
          if (reference) Mobject.prototype._copyData.call(g, reference);
          g.parents = [this];
        }
        const pts: Points = new Array(outline.length);
        for (let i = 0; i < outline.length; i++) {
          pts[i] = [(outline[i][0] + item.dx) * em, (outline[i][1] + item.dy) * em, 0];
        }
        g.points = pts;
        glyphs.push(g);
        k++;
      }
    }
    if (glyphs.length !== this.submobjects.length) {
      this.submobjects = glyphs;
      this._familyChanged();
    }
    this.builtHeight = this.getHeight();
    if (anchor) this.moveTo(anchor, this.o.edgeToFix);
    else this.center();
  }

  public setValue(value: number): this {
    this.number = value;
    this.rebuild();
    return this;
  }
  public getValue(): number {
    return this.number;
  }
  public incrementValue(d = 1): this {
    return this.setValue(this.number + d);
  }
  public get fontSize(): number {
    const scale = this.builtHeight > 0 ? this.getHeight() / this.builtHeight : 1;
    return (this.em * scale) / TEX_EM_PER_FONT_SIZE;
  }
  public set fontSize(value: number) {
    const current = this.fontSize;
    if (value > 0 && current > 0) this.scale(value / current);
  }
}

export class Integer extends DecimalNumber {
  public constructor(...args: any[]) {
    const o = kw(args, ['number'], {number: 0});
    super({...o, numDecimalPlaces: 0});
  }
  public override setValue(value: number): this {
    return super.setValue(Math.round(value));
  }
}

/** A labelled value: `label = 1.00`, driven by `variable.tracker`. */
export class Variable extends VGroup {
  public tracker: ValueTracker;
  public label: Mobject;
  public value: DecimalNumber;
  public constructor(value: number, label: string | Mobject, ...rest: any[]) {
    const o = kw(rest, ['varType', 'numDecimalPlaces'], {varType: DecimalNumber, numDecimalPlaces: 2});
    super();
    this.tracker = new ValueTracker(value);
    this.label = typeof label === 'string' ? new MathTex(label) : label;
    const equals = new MathTex('=').nextTo(this.label, RIGHT);
    this.label.add(equals);
    const isInteger = o.varType === Integer || (o.varType as any)?.displayName === 'Integer';
    this.value = isInteger ? new Integer(value) : new DecimalNumber(value, {numDecimalPlaces: o.numDecimalPlaces});
    this.value.nextTo(this.label, RIGHT);
    this.value.addUpdater((m: DecimalNumber) => {
      m.setValue(this.tracker.getValue()).nextTo(this.label, RIGHT);
    });
    this.add(this.label, this.value);
  }
}

function rangeOf(r: number[] | undefined, fallback: number[]): [number, number, number] {
  const a = r ?? fallback;
  return [a[0], a[1], a[2] ?? 1];
}

function decimalPlacesFromStep(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Python's `np.arange`, tolerant of floating point drift. */
function arange(start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  const n = Math.ceil((stop - start) / step - 1e-12);
  for (let i = 0; i < n; i++) out.push(Math.round((start + i * step) * 1e9) / 1e9);
  return out;
}

export class NumberLine extends VGroup {
  public xRange: [number, number, number];
  public line: Line;
  public ticks: VGroup;
  public numbers?: VGroup;
  public labels?: VGroup;
  public tip?: VMobject;
  private o: Record<string, any>;

  public constructor(...args: any[]) {
    const o: Record<string, any> = kw(args, ['xRange', 'length'], {
      xRange: undefined,
      length: undefined,
      unitSize: 1,
      includeTicks: true,
      tickSize: 0.1,
      numbersWithElongatedTicks: [],
      longerTickMultiple: 2,
      excludeOriginTick: false,
      rotation: 0,
      strokeWidth: 2,
      includeTip: false,
      tipWidth: DEFAULT_ARROW_TIP_LENGTH,
      tipHeight: DEFAULT_ARROW_TIP_LENGTH,
      includeNumbers: false,
      fontSize: 36,
      labelDirection: DOWN,
      lineToNumberBuff: MED_SMALL_BUFF,
      decimalNumberConfig: undefined,
      numbersToExclude: [],
      numbersToInclude: undefined,
      color: WHITE,
    });
    super({name: o.name});
    this.o = o;
    const fx = Math.round(config.frameWidth / 2);
    this.xRange = rangeOf(o.xRange, [-fx, fx, 1]);
    o.decimalNumberConfig = kw([o.decimalNumberConfig ?? {numDecimalPlaces: decimalPlacesFromStep(this.xRange[2])}], []);
    const [min, max] = this.xRange;
    const length = o.length ?? (max - min) * o.unitSize;
    const style = {color: o.color, strokeWidth: o.strokeWidth, strokeOpacity: o.strokeOpacity};
    this.line = new Line([-length / 2, 0, 0], [length / 2, 0, 0], style);
    this.add(this.line);
    if (o.includeTip) {
      this.line.addTip({tipLength: o.tipHeight, tipWidth: o.tipWidth});
      this.tip = (this.line as any).tip;
    }
    this.ticks = new VGroup();
    if (o.includeTicks) {
      const elongated: number[] = [...o.numbersWithElongatedTicks];
      for (const x of this.getTickRange()) {
        const big = elongated.some(e => Math.abs(e - x) < 1e-6);
        this.ticks.add(this.getTick(x, o.tickSize * (big ? o.longerTickMultiple : 1)));
      }
      this.add(this.ticks);
    }
    if (o.rotation) this.rotate(o.rotation, {aboutPoint: ORIGIN});
    if (o.includeNumbers || o.numbersToInclude) this.addNumbers({xValues: o.numbersToInclude});
  }

  public get xMin(): number {
    return this.xRange[0];
  }
  public get xMax(): number {
    return this.xRange[1];
  }
  public get xStep(): number {
    return this.xRange[2];
  }

  public getTick(x: number, size: number = this.o.tickSize): Line {
    const p = this.n2p(x);
    const u = this.direction();
    const n: Vec = [-u[1] * size, u[0] * size, 0];
    return new Line(sub(p, n), add(p, n), {
      color: this.line.strokeColor,
      strokeWidth: this.line.strokeWidth,
      strokeOpacity: this.line.strokeOpacity,
    });
  }

  /** Values that get a tick (Manim's `get_tick_range`). */
  public getTickRange(): number[] {
    const [min, , step] = this.xRange;
    let max = this.xRange[1];
    if (!this.o.includeTip) max += 1e-6;
    if ((min < max && max < 0) || (max > min && min > 0)) return arange(min, max, step);
    const start = this.o.excludeOriginTick ? step : 0;
    const neg = arange(start, Math.abs(min) + 1e-6, step).map(v => -v);
    const pos = arange(start, max, step);
    return [...new Set([...neg.reverse(), ...pos])];
  }
  public tickValues(): number[] {
    return this.getTickRange();
  }

  /** Position of the number `x` (works after any shift/rotate/scale). */
  public numberToPoint(x: number): Vec {
    const [min, max] = this.xRange;
    return lerp(this.getStart(), this.getEnd(), (x - min) / (max - min));
  }
  public n2p(x: number): Vec {
    return this.numberToPoint(x);
  }
  public pointToNumber(p: Vec): number {
    const [min, max] = this.xRange;
    const start = this.getStart();
    const d = sub(this.getEnd(), start);
    const len2 = d[0] * d[0] + d[1] * d[1];
    const t = ((p[0] - start[0]) * d[0] + (p[1] - start[1]) * d[1]) / len2;
    return min + t * (max - min);
  }
  public p2n(p: Vec): number {
    return this.pointToNumber(p);
  }
  public override getStart(): Vec {
    return this.line.points[0];
  }
  /** The end of the range: the tip's point when the line has a tip. */
  public override getEnd(): Vec {
    return this.tip ? this.tip.points[0] : this.line.points[this.line.points.length - 1];
  }
  public getLength(): number {
    const d = sub(this.getEnd(), this.getStart());
    return Math.hypot(d[0], d[1]);
  }
  public getAngle(): number {
    const d = sub(this.getEnd(), this.getStart());
    return Math.atan2(d[1], d[0]);
  }
  public getUnitSize(): number {
    const [min, max] = this.xRange;
    return this.getLength() / (max - min);
  }
  private direction(): Vec {
    return normalize(sub(this.getEnd(), this.getStart()));
  }
  /** The vector spanning one unit of the line (as in Manim, scaled by the unit size). */
  public getUnitVector(): Vec {
    return mul(this.direction(), this.getUnitSize());
  }
  public getProjection(point: Vec): Vec {
    const start = this.getStart();
    const u = this.direction();
    const t = (point[0] - start[0]) * u[0] + (point[1] - start[1]) * u[1];
    return [start[0] + u[0] * t, start[1] + u[1] * t, 0];
  }

  public getNumberMobject(x: number, ...rest: any[]): Mobject {
    const o = kw(rest, [], {});
    const direction: Vec = o.direction ?? this.o.labelDirection;
    const label = new DecimalNumber(x, {
      ...this.o.decimalNumberConfig,
      fontSize: o.fontSize ?? this.o.fontSize,
      ...(o.numDecimalPlaces !== undefined ? {numDecimalPlaces: o.numDecimalPlaces} : {}),
    });
    label.nextTo(this.n2p(x), direction, {buff: o.buff ?? this.o.lineToNumberBuff});
    // Centre the digits (not the minus sign) under the tick.
    if (x < 0 && this.o.labelDirection[0] === 0) label.shift([-label.submobjects[0].getWidth() / 2, 0, 0]);
    return label;
  }

  public addNumbers(...args: any[]): this {
    const o = kw(args, ['xValues', 'excluding', 'fontSize'], {});
    const values: number[] = o.xValues ?? this.getTickRange();
    const exclude: number[] = o.excluding ?? this.o.numbersToExclude ?? [];
    this.numbers = new VGroup();
    for (const x of values) {
      if (exclude.some(e => Math.abs(e - x) < 1e-9)) continue;
      this.numbers.add(this.getNumberMobject(x, {fontSize: o.fontSize}));
    }
    this.add(this.numbers);
    return this;
  }

  /** `add_labels({1: "a", 2: Tex("b")})` */
  public addLabels(dict: Record<string, string | number | Mobject>, ...rest: any[]): this {
    const o = kw(rest, ['direction', 'buff', 'fontSize'], {});
    this.labels = new VGroup();
    for (const key of Object.keys(dict)) {
      const value = dict[key];
      const label = value instanceof Mobject ? value : new MathTex(String(value), {fontSize: o.fontSize ?? this.o.fontSize});
      label.nextTo(this.n2p(Number(key)), o.direction ?? this.o.labelDirection, {buff: o.buff ?? this.o.lineToNumberBuff});
      this.labels.add(label);
    }
    this.add(this.labels);
    return this;
  }
}

export class ParametricFunction extends VMobject {
  public function: (t: number) => Vec;
  public tMin: number;
  public tMax: number;
  public tRange: [number, number];
  public underlyingFunction?: (x: number) => number;

  public constructor(fn: (t: number) => Vec, ...rest: any[]) {
    const o = kw(rest, ['tRange'], {tRange: [0, 1], dt: 1e-8, useSmoothing: true, samples: undefined});
    super(o);
    const t0 = o.tRange[0];
    const t1 = o.tRange[1];
    let step = o.tRange[2] ?? 0.01;
    // Keep the outline to a sensible size however fine the requested step is.
    if (o.samples) step = (t1 - t0) / o.samples;
    step = Math.max(Math.abs(step), Math.abs(t1 - t0) / 1000) || 1;
    this.function = fn;
    this.tMin = t0;
    this.tMax = t1;
    this.tRange = [t0, t1];
    const runs: Vec[][] = [[]];
    const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / step - 1e-9));
    for (let i = 0; i <= n; i++) {
      const t = i === n ? t1 : t0 + ((t1 - t0) * i) / n;
      const p = fn(t);
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) runs[runs.length - 1].push([p[0], p[1], 0]);
      else if (runs[runs.length - 1].length) runs.push([]);
    }
    const pts: Points = [];
    for (const run of runs) {
      if (run.length < 2) continue;
      const curve = o.useSmoothing ? smoothPoints(run) : cornersToPoints(run);
      for (const p of curve) pts.push(p);
    }
    this.points = pts;
    this.jointType = 'round';
  }
  public getFunction() {
    return this.function;
  }
  public getPointFromFunction(t: number): Vec {
    return this.function(t);
  }
  public get t_min(): number {
    return this.tMin;
  }
  public get t_max(): number {
    return this.tMax;
  }
}

export class FunctionGraph extends ParametricFunction {
  public fn: (x: number) => number;
  public constructor(fn: (x: number) => number, ...rest: any[]) {
    const o = kw(rest, ['xRange'], {xRange: [-config.frameWidth / 2, config.frameWidth / 2], color: PURE_YELLOW});
    super((t: number) => [t, fn(t), 0], {...o, tRange: [o.xRange[0], o.xRange[1], o.xRange[2] ?? 0.05]});
    this.fn = fn;
    this.underlyingFunction = fn;
  }
  public override getFunction() {
    return this.fn as any;
  }
}

function originShift(r: number[]): number {
  if (r[0] > 0) return r[0];
  if (r[1] < 0) return r[1];
  return 0;
}

const labelMob = (label: string | number | Mobject, opts: Record<string, any> = {}): Mobject =>
  label instanceof Mobject ? label : new MathTex(String(label), opts);

export class Axes extends VGroup {
  public xAxis: NumberLine;
  public yAxis: NumberLine;
  public axes: VGroup;
  public xRange: [number, number, number];
  public yRange: [number, number, number];
  public xLength: number | undefined;
  public yLength: number | undefined;
  public axisLabels?: VGroup;
  public numSampledGraphPointsPerTick = 10;

  public constructor(...args: any[]) {
    const o = kw(args, ['xRange', 'yRange', 'xLength', 'yLength'], {
      xRange: undefined,
      yRange: undefined,
      xLength: Math.round(config.frameWidth) - 2,
      yLength: Math.round(config.frameHeight) - 2,
      tips: true,
      axisConfig: {},
      xAxisConfig: {},
      yAxisConfig: {},
    });
    super({name: o.name});
    const fx = Math.round(config.frameWidth / 2);
    const fy = Math.round(config.frameHeight / 2);
    this.xRange = rangeOf(o.xRange, [-fx, fx, 1]);
    this.yRange = rangeOf(o.yRange, [-fy, fy, 1]);
    this.xLength = o.xLength ?? undefined;
    this.yLength = o.yLength ?? undefined;
    const camel = (c: Record<string, any>) => kw([c ?? {}], []);
    const base: Record<string, any> = {includeTip: o.tips, numbersToExclude: [0], ...camel(o.axisConfig)};
    if (o.color !== undefined && base.color === undefined) base.color = o.color;
    const xCfg = {...base, ...camel(o.xAxisConfig), excludeOriginTick: true};
    const yCfg = {...base, rotation: Math.PI / 2, labelDirection: LEFT, ...camel(o.yAxisConfig), excludeOriginTick: true};
    this.xAxis = new NumberLine({...xCfg, xRange: this.xRange, length: this.xLength});
    this.yAxis = new NumberLine({...yCfg, xRange: this.yRange, length: this.yLength});
    // The axes cross at their origins (or at the nearest end when 0 is outside).
    this.xAxis.shift(mul(this.xAxis.n2p(originShift(this.xRange)), -1));
    this.yAxis.shift(mul(this.yAxis.n2p(originShift(this.yRange)), -1));
    this.axes = new VGroup(this.xAxis, this.yAxis);
    this.add(this.xAxis, this.yAxis);
    // Centre the middle of both ranges on the origin.
    this.shift(
      mul(this.c2p((this.xRange[0] + this.xRange[1]) / 2, (this.yRange[0] + this.yRange[1]) / 2), -1),
    );
  }

  public coordsToPoint(x: number | number[], y = 0): Vec {
    if (Array.isArray(x)) [x, y] = [x[0], x[1] ?? 0];
    const px = this.xAxis.n2p(x);
    const py = this.yAxis.n2p(y);
    const origin = this.xAxis.n2p(originShift(this.xRange));
    return [px[0] + py[0] - origin[0], px[1] + py[1] - origin[1], 0];
  }
  public c2p(x: number | number[], y = 0): Vec {
    return this.coordsToPoint(x, y);
  }
  public pointToCoords(p: Vec): [number, number] {
    return [this.xAxis.p2n(p), this.yAxis.p2n(p)];
  }
  public p2c(p: Vec): [number, number] {
    return this.pointToCoords(p);
  }
  public getOrigin(): Vec {
    return this.c2p(0, 0);
  }
  public getXAxis(): NumberLine {
    return this.xAxis;
  }
  public getYAxis(): NumberLine {
    return this.yAxis;
  }
  public getAxes(): VGroup {
    return this.axes;
  }
  public getAxis(index: number): NumberLine {
    return index === 0 ? this.xAxis : this.yAxis;
  }
  public getXUnitSize(): number {
    return this.xAxis.getUnitSize();
  }
  public getYUnitSize(): number {
    return this.yAxis.getUnitSize();
  }
  /** Add number labels to both axes. */
  public addCoordinates(...args: any[]): this {
    const [pos] = splitKw(args);
    const lists: (number[] | undefined)[] = [pos[0], pos[1]];
    [this.xAxis, this.yAxis].forEach((axis, i) => {
      if (lists[i] && !Array.isArray(lists[i])) axis.addLabels(lists[i] as any);
      else axis.addNumbers({xValues: lists[i]});
    });
    return this;
  }

  public plot(fn: (x: number) => number, ...rest: any[]): ParametricFunction {
    const o: Record<string, any> = kw(rest, ['xRange'], {xRange: undefined});
    const r: number[] = [...this.xRange];
    if (o.xRange) o.xRange.forEach((v: number, i: number) => (r[i] = v));
    if (!o.xRange || o.xRange.length < 3) r[2] /= this.numSampledGraphPointsPerTick;
    const graph = new ParametricFunction((t: number) => this.c2p(t, fn(t)), {...o, tRange: r});
    graph.underlyingFunction = fn;
    return graph;
  }
  public getGraph(fn: (x: number) => number, ...rest: any[]) {
    return this.plot(fn, ...rest);
  }
  public plotParametricCurve(fn: (t: number) => Vec, ...rest: any[]): ParametricFunction {
    const o = kw(rest, ['tRange'], {tRange: [0, 1, 0.01]});
    const graph = new ParametricFunction((t: number) => {
      const p = fn(t);
      return this.c2p(p[0], p[1]);
    }, o);
    (graph as any).underlyingFunction = fn;
    return graph;
  }
  public plotDerivativeGraph(graph: ParametricFunction, ...rest: any[]): ParametricFunction {
    const o = kw(rest, ['color'], {color: GREEN});
    return this.plot((x: number) => this.slopeOfTangent(x, graph), o);
  }
  /** A polyline through data points, with a dot on every vertex. */
  public plotLineGraph(...args: any[]): VDict {
    const o = kw(args, ['xValues', 'yValues'], {
      lineColor: PURE_YELLOW,
      addVertexDots: true,
      vertexDotRadius: DEFAULT_DOT_RADIUS,
      vertexDotStyle: {},
    });
    const {xValues, yValues, zValues: _z, lineColor, addVertexDots, vertexDotRadius, vertexDotStyle, ...style} = o;
    const vertices: Vec[] = xValues.map((x: number, i: number) => this.c2p(x, yValues[i]));
    const graph = new VMobject({color: lineColor, ...style});
    graph.setPointsAsCorners(vertices);
    const out = new VDict();
    out.addKeyValuePair('line_graph', graph);
    if (addVertexDots) {
      const dots = new VGroup(...vertices.map(v => new Dot(v, {radius: vertexDotRadius, ...kw([vertexDotStyle], [])})));
      out.addKeyValuePair('vertex_dots', dots);
    }
    return out;
  }

  public inputToGraphPoint(x: number, graph: any): Vec {
    if (typeof graph.function === 'function') return graph.function(x);
    // Not a plotted function: find the point of the outline above `x`.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.p2c(graph.pointFromProportion(mid))[0] < x) lo = mid;
      else hi = mid;
    }
    return graph.pointFromProportion((lo + hi) / 2);
  }
  public i2gp(x: number, graph: any): Vec {
    return this.inputToGraphPoint(x, graph);
  }
  public inputToGraphCoords(x: number, graph: any): [number, number] {
    return [x, graph.underlyingFunction(x)];
  }
  public i2gc(x: number, graph: any): [number, number] {
    return this.inputToGraphCoords(x, graph);
  }
  public angleOfTangent(x: number, graph: any, dx = 1e-8): number {
    const f = graph.underlyingFunction;
    return Math.atan2(f(x + dx) - f(x), dx);
  }
  public slopeOfTangent(x: number, graph: any, dx = 1e-8): number {
    return Math.tan(this.angleOfTangent(x, graph, dx));
  }

  public getAxisLabels(...args: any[]): VGroup {
    const o = kw(args, ['xLabel', 'yLabel'], {xLabel: 'x', yLabel: 'y'});
    this.axisLabels = new VGroup(this.getXAxisLabel(o.xLabel), this.getYAxisLabel(o.yLabel));
    return this.axisLabels;
  }
  private axisLabel(label: string | number | Mobject, axis: NumberLine, o: Record<string, any>): Mobject {
    const m = labelMob(label);
    m.nextTo(axis.getCriticalPoint(o.edge), o.direction, {buff: o.buff});
    m.shiftOntoScreen({buff: MED_SMALL_BUFF});
    return m;
  }
  public getXAxisLabel(label: string | number | Mobject, ...rest: any[]): Mobject {
    const o = kw(rest, ['edge', 'direction', 'buff'], {edge: [1, 1, 0], direction: [1, 1, 0], buff: SMALL_BUFF});
    return this.axisLabel(label, this.xAxis, o);
  }
  public getYAxisLabel(label: string | number | Mobject, ...rest: any[]): Mobject {
    const o = kw(rest, ['edge', 'direction', 'buff'], {edge: [1, 1, 0], direction: [1, 0.5, 0], buff: SMALL_BUFF});
    return this.axisLabel(label, this.yAxis, o);
  }
  public getGraphLabel(graph: any, ...rest: any[]): Mobject {
    const o = kw(rest, ['label', 'xVal', 'direction', 'buff', 'color'], {
      label: 'f(x)',
      xVal: undefined,
      direction: RIGHT,
      buff: MED_SMALL_BUFF,
      color: undefined,
      dot: false,
      dotConfig: {},
    });
    const m = labelMob(o.label).setColor(o.color ?? graph.getColor());
    let point: Vec = [0, 0, 0];
    if (o.xVal === undefined) {
      // The right-most point of the graph that is still inside the frame.
      for (let i = 0; i < 100; i++) {
        const x = this.xRange[1] + ((this.xRange[0] - this.xRange[1]) * i) / 99;
        point = this.inputToGraphPoint(x, graph);
        if (point[1] < config.frameHeight / 2) break;
      }
    } else {
      point = this.inputToGraphPoint(o.xVal, graph);
    }
    m.nextTo(point, o.direction, {buff: o.buff});
    m.shiftOntoScreen();
    if (o.dot) {
      const dot = new Dot(point, kw([o.dotConfig], []));
      m.add(dot);
      (m as any).dot = dot;
    }
    return m;
  }

  /** A line from an axis (0: x, 1: y) to `point`; dashed unless `line_func` says otherwise. */
  public getLineFromAxisToPoint(index: number, point: Vec, ...rest: any[]): Line {
    const o = kw(rest, ['lineFunc', 'lineConfig', 'color', 'strokeWidth'], {
      lineFunc: DashedLine,
      lineConfig: {},
      color: WHITE,
      strokeWidth: 2,
    });
    const LineClass = o.lineFunc;
    return new LineClass(this.getAxis(index).getProjection(point), point, {
      ...kw([o.lineConfig], []),
      color: o.color,
      strokeWidth: o.strokeWidth,
    });
  }
  public getVerticalLine(point: Vec, ...rest: any[]): Line {
    return this.getLineFromAxisToPoint(0, point, ...rest);
  }
  public getHorizontalLine(point: Vec, ...rest: any[]): Line {
    return this.getLineFromAxisToPoint(1, point, ...rest);
  }
  public getLinesToPoint(point: Vec, ...rest: any[]): VGroup {
    return new VGroup(this.getHorizontalLine(point, ...rest), this.getVerticalLine(point, ...rest));
  }
  public getVerticalLineToGraph(x: number, graph: any, ...rest: any[]): Line {
    return this.getVerticalLine(this.inputToGraphPoint(x, graph), ...rest);
  }
  public getVerticalLinesToGraph(graph: any, ...rest: any[]): VGroup {
    const o = kw(rest, ['xRange', 'numLines'], {xRange: undefined, numLines: 20});
    const {xRange, numLines, ...lineOpts} = o;
    const [a, b] = xRange ?? [graph.tMin, graph.tMax];
    const group = new VGroup();
    for (let i = 0; i < numLines; i++) {
      const x = numLines === 1 ? a : a + ((b - a) * i) / (numLines - 1);
      group.add(this.getVerticalLineToGraph(x, graph, lineOpts));
    }
    return group;
  }

  /** The region under a graph, or between it and `bounded_graph`. */
  public getArea(graph: any, ...rest: any[]): VMobject {
    const o: Record<string, any> = kw(rest, ['xRange', 'color', 'opacity', 'boundedGraph'], {
      xRange: undefined,
      color: [BLUE, GREEN],
      opacity: 0.3,
      boundedGraph: undefined,
    });
    const {xRange, color, opacity, boundedGraph, ...style} = o;
    let [a, b] = xRange ?? [graph.tMin, graph.tMax];
    if (boundedGraph) {
      a = Math.max(a, boundedGraph.tMin);
      b = Math.min(b, boundedGraph.tMax);
    }
    const along = (g: any): Vec[] => {
      const inside = (g.points as Points).filter((_p, i) => i % 4 === 0).filter(p => {
        const x = this.p2c(p)[0];
        return x >= a && x <= b;
      });
      return [g.function(a), ...inside, g.function(b)];
    };
    const corners = boundedGraph
      ? [...along(graph), ...along(boundedGraph).reverse()]
      : [this.c2p(a), ...along(graph), this.c2p(b)];
    const colors = Array.isArray(color) ? color : [color];
    // A colour list is a gradient in Manim; the canvas fill uses its midpoint.
    const fill = colors.length > 1 ? color_gradient(colors, 3)[1] : toHex(colors[0]);
    return new Polygon(...corners, style).setOpacity(opacity).setColor(fill);
  }

  public getRiemannRectangles(graph: any, ...rest: any[]): VGroup {
    const o: Record<string, any> = kw(rest, ['xRange', 'dx', 'inputSampleType'], {
      xRange: undefined,
      dx: 0.1,
      inputSampleType: 'left',
      strokeWidth: 1,
      strokeColor: BLACK,
      fillOpacity: 1,
      color: [BLUE, GREEN],
      showSignedArea: true,
      boundedGraph: undefined,
      blend: false,
      widthScaleFactor: 1.001,
    });
    const bounded = o.boundedGraph;
    const range = o.xRange ?? (bounded
      ? [Math.max(graph.tMin, bounded.tMin), Math.min(graph.tMax, bounded.tMax)]
      : [graph.tMin, graph.tMax]);
    const xs = arange(range[0], range[1], o.dx);
    const colors = color_gradient(Array.isArray(o.color) ? o.color : [o.color], xs.length);
    const group = new VGroup();
    xs.forEach((x, i) => {
      const sample = o.inputSampleType === 'right' ? x + o.dx : o.inputSampleType === 'center' ? x + o.dx / 2 : x;
      const top = this.inputToGraphPoint(sample, graph);
      const base = bounded ? bounded.underlyingFunction(x) : originShift(this.yRange);
      const p0 = this.c2p(x, base);
      const p1 = this.c2p(x + o.widthScaleFactor * o.dx, base);
      let color = colors[i];
      if (this.p2c(top)[1] < base && o.showSignedArea) color = invert_color(color);
      const rect = new VMobject({
        fillColor: color,
        fillOpacity: o.fillOpacity,
        strokeColor: o.blend ? color : o.strokeColor,
        strokeWidth: o.strokeWidth,
        name: 'Rectangle',
      });
      const x0 = Math.min(p0[0], p1[0], top[0]);
      const x1 = Math.max(p0[0], p1[0], top[0]);
      const y0 = Math.min(p0[1], p1[1], top[1]);
      const y1 = Math.max(p0[1], p1[1], top[1]);
      rect.points = cornersToPoints([[x1, y1, 0], [x0, y1, 0], [x0, y0, 0], [x1, y0, 0], [x1, y1, 0]]);
      group.add(rect);
    });
    return group;
  }
}

export class NumberPlane extends Axes {
  public backgroundLines: VGroup;
  public fadedLines: VGroup;
  public xLines: VGroup;
  public yLines: VGroup;
  public constructor(...args: any[]) {
    const o = kw(args, ['xRange', 'yRange', 'xLength', 'yLength'], {});
    const fw = config.frameWidth / 2;
    const fh = config.frameHeight / 2;
    const camel = (c: Record<string, any> | undefined) => kw([c ?? {}], []);
    super({
      tips: false,
      ...o,
      xRange: o.xRange ?? [-fw, fw, 1],
      yRange: o.yRange ?? [-fh, fh, 1],
      xLength: o.xLength ?? null,
      yLength: o.yLength ?? null,
      axisConfig: {
        strokeWidth: 2,
        includeTicks: false,
        includeTip: false,
        lineToNumberBuff: SMALL_BUFF,
        labelDirection: [1, -1, 0],
        fontSize: 24,
        ...camel(o.axisConfig),
      },
      yAxisConfig: {labelDirection: [1, -1, 0], ...camel(o.yAxisConfig)},
    });
    const style: Record<string, any> = {strokeColor: BLUE_D, strokeWidth: 2, strokeOpacity: 1, ...camel(o.backgroundLineStyle)};
    const faded: Record<string, any> = o.fadedLineStyle
      ? camel(o.fadedLineStyle)
      : {...style, strokeWidth: style.strokeWidth * 0.5, strokeOpacity: style.strokeOpacity * 0.5};
    const ratio = Math.max(1, o.fadedLineRatio ?? 1);
    this.backgroundLines = new VGroup();
    this.fadedLines = new VGroup();
    this.xLines = new VGroup();
    this.yLines = new VGroup();
    // Lines parallel to one axis, spaced along the other (Manim's
    // `_get_lines_parallel_to_axis`).
    const build = (parallel: NumberLine, perp: NumberLine, freq: number, main: VGroup) => {
      const step = freq / ratio;
      const start = parallel.getStart();
      const end = parallel.getEnd();
      const unit = perp.getUnitVector();
      let [min, max] = perp.xRange;
      if (perp.xMin > 0 && min < 0) [min, max] = [0, Math.abs(min) + Math.abs(max)];
      const ranges = [
        [0],
        arange(step, Math.min(max - min, max), step),
        arange(step, -Math.max(min - max, min), step).map(v => -v),
      ];
      for (const inputs of ranges) {
        inputs.forEach((x, k) => {
          const isMain = (k + 1) % ratio === 0;
          const d = mul(unit, x);
          const line = new Line(add(start, d), add(end, d), isMain ? style : faded);
          (isMain ? this.backgroundLines : this.fadedLines).add(line);
          if (isMain) main.add(line);
        });
      }
    };
    build(this.xAxis, this.yAxis, this.yRange[2], this.xLines);
    build(this.yAxis, this.xAxis, this.xRange[2], this.yLines);
    this.addToBack(this.fadedLines, this.backgroundLines);
  }

  /** Subdivide every line so non-linear functions bend them smoothly. */
  public prepareForNonlinearTransform(numInsertedCurves = 50): this {
    for (const m of this.familyMembersWithPoints()) {
      if (!(m instanceof VMobject)) continue;
      const n = m.getNumCurves();
      if (numInsertedCurves > n) m.insertNCurves(numInsertedCurves - n);
    }
    return this;
  }
  public getVector(coords: number[], ...rest: any[]): Mobject {
    const o = kw(rest, [], {buff: 0});
    // Imported lazily to avoid a cycle with geometry's Arrow at module load.
    return new (ArrowRef.klass)(this.c2p(0, 0), this.c2p(coords[0], coords[1]), o);
  }
}

/** A path that follows a moving point (`TracedPath(dot.get_center)`). */
export class TracedPath extends VMobject {
  private tracedPointFunc: () => Vec;
  private dissipatingTime?: number;
  private elapsed = 0;
  public constructor(tracedPointFunc: () => Vec, ...rest: any[]) {
    const o = kw(rest, [], {strokeWidth: 2, strokeColor: WHITE, dissipatingTime: undefined});
    super(o);
    this.tracedPointFunc = tracedPointFunc;
    this.dissipatingTime = o.dissipatingTime;
    this.jointType = 'round';
    this.addUpdater((_m: Mobject, dt: number) => this.updatePath(dt));
  }
  public updatePath(dt: number): void {
    const p = this.tracedPointFunc();
    const point: Vec = [p[0], p[1], 0];
    if (this.points.length === 0) {
      this.points = [point, point, point, point];
      return;
    }
    const last = this.points[this.points.length - 1];
    if (Math.abs(last[0] - point[0]) > 1e-9 || Math.abs(last[1] - point[1]) > 1e-9) this.addLineTo(point);
    if (this.dissipatingTime !== undefined) {
      this.elapsed += dt;
      if (this.elapsed - 1 > this.dissipatingTime && this.points.length > 4) {
        this.points = this.points.slice(4);
      }
    }
  }
}

/** Filled in by index.ts to break the import cycle for `NumberPlane.getVector`. */
export const ArrowRef: {klass: any} = {klass: null};

for (const klass of [ValueTracker, VDict, DecimalNumber, NumberLine, ParametricFunction, Axes, NumberPlane, TracedPath]) {
  aliasSnake(klass.prototype);
}
aliasFields(NumberLine.prototype, ['xRange', 'xMin', 'xMax', 'xStep']);
aliasFields(Axes.prototype, ['xRange', 'yRange', 'xAxis', 'yAxis', 'xLength', 'yLength', 'axisLabels']);
aliasFields(NumberPlane.prototype, ['backgroundLines', 'fadedLines', 'xLines', 'yLines']);
aliasFields(ParametricFunction.prototype, ['tRange', 'underlyingFunction']);
export const alwaysRedraw = always_redraw;
