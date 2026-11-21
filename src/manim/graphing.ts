/** Value trackers, number displays and coordinate systems. */
import {cornersToPoints} from './bezier';
import {BLUE, BLUE_D, DOWN, LEFT, ORIGIN, RIGHT, UP, WHITE, config} from './constants';
import {ArrowTriangleFilledTip, Line} from './geometry';
import {Mobject, VGroup, VMobject} from './mobject';
import {Text} from './text';
import {aliasSnake, kw, splitKw} from './util';
import {add, angleOf, lerp, mul, normalize, sub, Vec} from './vec';

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

export class DecimalNumber extends VGroup {
  public number: number;
  private o: Record<string, any>;
  public constructor(...args: any[]) {
    const o = kw(args, ['number'], {
      number: 0,
      numDecimalPlaces: 2,
      includeSign: false,
      groupWithCommas: true,
      unit: '',
      fontSize: 48,
      color: WHITE,
      edgeToFix: LEFT,
    });
    super({name: o.name});
    this.o = o;
    this.number = o.number;
    this.rebuild();
  }
  private format(): string {
    const o = this.o;
    let s = this.number.toFixed(o.numDecimalPlaces);
    if (o.groupWithCommas) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, (m, _a, off) => (s.indexOf('.') >= 0 && off > s.indexOf('.') ? m : ','));
    if (o.includeSign && this.number >= 0) s = '+' + s;
    return s.replace('-', '−') + (o.unit ?? '');
  }
  private rebuild() {
    const hadGlyphs = this.submobjects.length > 0;
    const anchor = hadGlyphs ? this.getCriticalPoint(this.o.edgeToFix) : null;
    const style = this.submobjects[0];
    const text = new Text(this.format(), {
      fontSize: this.o.fontSize,
      color: style ? style.fillColor : this.o.color,
      font: this.o.font,
    });
    if (hadGlyphs) {
      text.scaleToFitHeight(Math.max(this._digitHeight ?? text.getHeight(), 1e-6) * (text.getHeight() / this._refHeight(text)));
    }
    if (text.submobjects.length === this.submobjects.length) {
      this.submobjects.forEach((g, i) => g._copyData(text.submobjects[i]));
    } else {
      this.submobjects = [...text.submobjects];
      for (const g of this.submobjects) g.parents = [this];
      this._familyChanged();
    }
    if (anchor) this.moveTo(anchor, this.o.edgeToFix);
    if (!hadGlyphs) this._digitHeight = this._refHeight(this);
  }
  private _digitHeight?: number;
  /** Height of a reference digit, so rescaled numbers keep their size. */
  private _refHeight(m: Mobject): number {
    const digit = m.submobjects.find(g => /\d/.test((g as any).char ?? ''));
    return digit ? digit.getHeight() : m.getHeight();
  }
  public override scale(factor: number, ...rest: any[]): this {
    super.scale(factor, ...rest);
    if (this._digitHeight !== undefined) this._digitHeight *= Math.abs(factor);
    return this;
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
}

export class Integer extends DecimalNumber {
  public constructor(...args: any[]) {
    const o = kw(args, ['number'], {number: 0});
    super({...o, numDecimalPlaces: 0});
  }
}

export class Variable extends VGroup {
  public tracker: ValueTracker;
  public label: Mobject;
  public value: DecimalNumber;
  public constructor(value: number, label: string | Mobject, ...rest: any[]) {
    const o = kw(rest, [], {numDecimalPlaces: 2});
    super();
    this.tracker = new ValueTracker(value);
    this.label = typeof label === 'string' ? new Text(`${label} = `, {fontSize: 36}) : label;
    this.value = new DecimalNumber(value, {numDecimalPlaces: o.numDecimalPlaces, fontSize: 36});
    this.value.nextTo(this.label, RIGHT);
    this.value.addUpdater((m: DecimalNumber) => {
      m.setValue(this.tracker.getValue());
    });
    this.add(this.label, this.value);
  }
}

function rangeOf(r: number[] | undefined, fallback: number[]): [number, number, number] {
  const a = r ?? fallback;
  return [a[0], a[1], a[2] ?? 1];
}

export class NumberLine extends VGroup {
  public xRange: [number, number, number];
  public line: Line;
  public ticks: VGroup;
  public numbers?: VGroup;
  public tip?: VMobject;
  private o: Record<string, any>;

  public constructor(...args: any[]) {
    const o = kw(args, ['xRange', 'length'], {
      xRange: [-8, 8, 1],
      length: undefined,
      unitSize: 1,
      includeTicks: true,
      tickSize: 0.1,
      includeNumbers: false,
      includeTip: false,
      numbersToExclude: undefined,
      numbersToInclude: undefined,
      fontSize: 24,
      labelDirection: DOWN,
      color: WHITE,
      strokeWidth: 2,
      rotation: 0,
    });
    super({name: o.name});
    this.o = o;
    this.xRange = rangeOf(o.xRange, [-8, 8, 1]);
    const [min, max] = this.xRange;
    const length = o.length ?? (max - min) * o.unitSize;
    this.line = new Line([-length / 2, 0, 0], [length / 2, 0, 0], {color: o.color, strokeWidth: o.strokeWidth});
    this.add(this.line);
    this.ticks = new VGroup();
    if (o.includeTicks) {
      for (const x of this.tickValues()) {
        const p = this.n2p(x);
        this.ticks.add(
          new Line(add(p, [0, -o.tickSize, 0]), add(p, [0, o.tickSize, 0]), {color: o.color, strokeWidth: o.strokeWidth}),
        );
      }
    }
    this.add(this.ticks);
    if (o.includeTip) {
      this.tip = new ArrowTriangleFilledTip({length: 0.25, color: o.color});
      this.tip.shift(add(this.line.getEnd(), [0.25, 0, 0]));
      this.line.putStartAndEndOn(this.line.getStart(), add(this.line.getEnd(), [0.02, 0, 0]));
      this.add(this.tip);
    }
    if (o.includeNumbers) this.addNumbers();
    if (o.rotation) this.rotate(o.rotation, {aboutPoint: ORIGIN});
  }

  public tickValues(): number[] {
    const [min, max, step] = this.xRange;
    const out: number[] = [];
    const first = Math.ceil(min / step - 1e-9) * step;
    for (let x = first; x <= max + 1e-9; x += step) out.push(Math.round(x * 1e9) / 1e9);
    if (this.o.includeTip && out.length && Math.abs(out[out.length - 1] - max) < 1e-9) out.pop();
    return out;
  }

  /** Position of the number `x` (works after any shift/rotate/scale). */
  public numberToPoint(x: number): Vec {
    const [min, max] = this.xRange;
    const start = this._origStart();
    const end = this._origEnd();
    return lerp(start, end, (x - min) / (max - min));
  }
  public n2p(x: number): Vec {
    return this.numberToPoint(x);
  }
  public pointToNumber(p: Vec): number {
    const [min, max] = this.xRange;
    const start = this._origStart();
    const end = this._origEnd();
    const d = sub(end, start);
    const len2 = d[0] * d[0] + d[1] * d[1];
    const t = ((p[0] - start[0]) * d[0] + (p[1] - start[1]) * d[1]) / len2;
    return min + t * (max - min);
  }
  public p2n(p: Vec): number {
    return this.pointToNumber(p);
  }
  private _origStart(): Vec {
    return this.line.points[0];
  }
  private _origEnd(): Vec {
    // The line is extended slightly under the tip; ignore that extension.
    const end = this.line.points[this.line.points.length - 1];
    if (!this.tip) return end;
    const dir = normalize(sub(end, this.line.points[0]));
    return sub(end, mul(dir, 0.02));
  }
  public getUnitSize(): number {
    const [min, max] = this.xRange;
    const d = sub(this._origEnd(), this._origStart());
    return Math.hypot(d[0], d[1]) / (max - min);
  }
  public getUnitVector(): Vec {
    return mul(normalize(sub(this._origEnd(), this._origStart())), this.getUnitSize());
  }

  public addNumbers(...args: any[]): this {
    const o = kw(args, ['xValues'], {});
    const values: number[] = o.xValues ?? this.o.numbersToInclude ?? this.tickValues();
    const exclude: number[] = this.o.numbersToExclude ?? [];
    this.numbers = new VGroup();
    const angle = angleOf(sub(this._origEnd(), this._origStart()));
    const down = Math.abs(Math.cos(angle)) > 0.5 ? this.o.labelDirection : LEFT;
    for (const x of values) {
      if (exclude.includes(x)) continue;
      const label = new Text(formatNumber(x), {fontSize: o.fontSize ?? this.o.fontSize, color: this.o.color});
      label.nextTo(this.n2p(x), down, {buff: 0.2});
      this.numbers.add(label);
    }
    this.add(this.numbers);
    return this;
  }
}

function formatNumber(x: number): string {
  const s = Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
  return s.replace('-', '−');
}

export class ParametricFunction extends VMobject {
  public constructor(fn: (t: number) => Vec, ...rest: any[]) {
    const o = kw(rest, ['tRange'], {tRange: [0, 1], samples: undefined});
    super(o);
    const [t0, t1, step] = [o.tRange[0], o.tRange[1], o.tRange[2]];
    const n = o.samples ?? (step ? Math.max(2, Math.round((t1 - t0) / step)) : 120);
    const corners: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      const p = fn(t0 + ((t1 - t0) * i) / n);
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) corners.push([p[0], p[1], 0]);
    }
    this.points = cornersToPoints(corners);
    this.jointType = 'round';
  }
}

export class FunctionGraph extends ParametricFunction {
  public fn: (x: number) => number;
  public constructor(fn: (x: number) => number, ...rest: any[]) {
    const o = kw(rest, ['xRange'], {xRange: [-config.frameWidth / 2, config.frameWidth / 2], color: BLUE});
    super((t: number) => [t, fn(t), 0], {...o, tRange: o.xRange});
    this.fn = fn;
  }
}

export class Axes extends VGroup {
  public xAxis: NumberLine;
  public yAxis: NumberLine;
  public axes: VGroup;
  public xRange: [number, number, number];
  public yRange: [number, number, number];

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
      color: WHITE,
    });
    super({name: o.name});
    this.xRange = rangeOf(o.xRange, [-7, 7, 1]);
    this.yRange = rangeOf(o.yRange, [-4, 4, 1]);
    const camel = (c: Record<string, any>) => kw([c], []);
    const base = {color: o.color, includeTip: o.tips, ...camel(o.axisConfig)};
    this.xAxis = new NumberLine({xRange: this.xRange, length: o.xLength, ...base, ...camel(o.xAxisConfig)});
    this.yAxis = new NumberLine({
      xRange: this.yRange,
      length: o.yLength,
      labelDirection: LEFT,
      ...base,
      ...camel(o.yAxisConfig),
      includeNumbers: false,
    });
    this.yAxis.rotate(Math.PI / 2, {aboutPoint: ORIGIN});
    const yCfg = {...base, ...camel(o.yAxisConfig)};
    if (yCfg.includeNumbers) this.yAxis.addNumbers();
    // Cross the axes at their origins (or at the range minimum when 0 is outside).
    const ox = clampTo(0, this.xRange);
    const oy = clampTo(0, this.yRange);
    this.xAxis.shift(sub(ORIGIN, this.xAxis.n2p(ox)));
    this.yAxis.shift(sub(ORIGIN, this.yAxis.n2p(oy)));
    this.axes = new VGroup(this.xAxis, this.yAxis);
    this.add(this.xAxis, this.yAxis);
    this.center();
  }

  public coordsToPoint(x: number, y = 0): Vec {
    const px = this.xAxis.n2p(x);
    const py = this.yAxis.n2p(y);
    const oy = this.yAxis.n2p(clampTo(0, this.yRange));
    return add(px, sub(py, oy));
  }
  public c2p(x: number, y = 0): Vec {
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

  public plot(fn: (x: number) => number, ...rest: any[]): ParametricFunction {
    const o = kw(rest, ['xRange'], {xRange: undefined, color: BLUE});
    const r = o.xRange ?? this.xRange;
    const graph = new ParametricFunction((t: number) => this.c2p(t, fn(t)), {
      ...o,
      tRange: [r[0], r[1]],
      samples: r[2] && r[2] < (r[1] - r[0]) / 4 ? Math.round((r[1] - r[0]) / r[2]) : 160,
    });
    (graph as any).underlyingFunction = fn;
    (graph as any).tRange = [r[0], r[1]];
    return graph;
  }
  public getGraph(fn: (x: number) => number, ...rest: any[]) {
    return this.plot(fn, ...rest);
  }
  public plotParametricCurve(fn: (t: number) => Vec, ...rest: any[]): ParametricFunction {
    const o = kw(rest, ['tRange'], {tRange: [0, 1], color: BLUE});
    return new ParametricFunction((t: number) => {
      const p = fn(t);
      return this.c2p(p[0], p[1]);
    }, o);
  }
  public inputToGraphPoint(x: number, graph: any): Vec {
    return this.c2p(x, graph.underlyingFunction(x));
  }
  public i2gp(x: number, graph: any): Vec {
    return this.inputToGraphPoint(x, graph);
  }

  public getAxisLabels(...args: any[]): VGroup {
    const o = kw(args, ['xLabel', 'yLabel'], {xLabel: 'x', yLabel: 'y'});
    return new VGroup(this.getXAxisLabel(o.xLabel), this.getYAxisLabel(o.yLabel));
  }
  public getXAxisLabel(label: string | Mobject, ...rest: any[]): Mobject {
    const o = kw(rest, ['edge', 'direction'], {edge: [1, 1, 0], direction: [1, 1, 0], buff: 0.1});
    const m = typeof label === 'string' ? new Text(label, {fontSize: 30, slant: 'italic'}) : label;
    m.nextTo(this.xAxis.getCriticalPoint(RIGHT), UP, {buff: 0.25});
    void o;
    return m;
  }
  public getYAxisLabel(label: string | Mobject, ...rest: any[]): Mobject {
    void rest;
    const m = typeof label === 'string' ? new Text(label, {fontSize: 30, slant: 'italic'}) : label;
    m.nextTo(this.yAxis.getCriticalPoint(UP), RIGHT, {buff: 0.25});
    return m;
  }
  public getGraphLabel(graph: any, ...rest: any[]): Mobject {
    const o = kw(rest, ['label', 'xVal', 'direction'], {label: 'f(x)', xVal: undefined, direction: RIGHT, buff: 0.25, color: undefined});
    const m = typeof o.label === 'string' ? new Text(o.label, {fontSize: 30}) : o.label;
    const x = o.xVal ?? graph.tRange[1];
    m.nextTo(this.inputToGraphPoint(x, graph), o.direction, {buff: o.buff});
    m.setColor(o.color ?? graph.getColor());
    return m;
  }
  public getVerticalLine(point: Vec, ...rest: any[]): Line {
    const o = kw(rest, [], {color: WHITE, strokeWidth: 2});
    return new Line([point[0], this.c2p(0, 0)[1], 0], point, o);
  }
  public getHorizontalLine(point: Vec, ...rest: any[]): Line {
    const o = kw(rest, [], {color: WHITE, strokeWidth: 2});
    return new Line([this.c2p(0, 0)[0], point[1], 0], point, o);
  }
  public getArea(graph: any, ...rest: any[]): VMobject {
    const o = kw(rest, ['xRange'], {xRange: undefined, color: BLUE, opacity: 0.3});
    const [a, b] = o.xRange ?? graph.tRange;
    const fn = graph.underlyingFunction;
    const n = 80;
    const corners: Vec[] = [this.c2p(a, 0)];
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n;
      corners.push(this.c2p(x, fn(x)));
    }
    corners.push(this.c2p(b, 0), this.c2p(a, 0));
    const area = new VMobject({fillColor: o.color, fillOpacity: o.opacity, strokeWidth: 0});
    area.points = cornersToPoints(corners);
    return area;
  }
  public getRiemannRectangles(graph: any, ...rest: any[]): VGroup {
    const o = kw(rest, ['xRange', 'dx'], {xRange: undefined, dx: 0.1, color: [BLUE, '#83C167'], fillOpacity: 1, strokeWidth: 1, strokeColor: '#000000'});
    const [a, b] = o.xRange ?? graph.tRange;
    const fn = graph.underlyingFunction;
    const group = new VGroup();
    for (let x = a; x < b - 1e-9; x += o.dx) {
      const r = new VMobject({fillOpacity: o.fillOpacity, strokeWidth: o.strokeWidth, strokeColor: o.strokeColor});
      r.points = cornersToPoints([
        this.c2p(x, 0),
        this.c2p(x, fn(x)),
        this.c2p(x + o.dx, fn(x)),
        this.c2p(x + o.dx, 0),
        this.c2p(x, 0),
      ]);
      group.add(r);
    }
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    group.submobjects.forEach((r, i) => {
      const t = group.submobjects.length > 1 ? i / (group.submobjects.length - 1) : 0;
      r.setFill(colors.length > 1 ? mixColors(colors, t) : colors[0]);
    });
    return group;
  }
}

function mixColors(colors: any[], t: number): string {
  const tmp = new VGroup(new VMobject(), new VMobject());
  void tmp;
  const x = t * (colors.length - 1);
  const k = Math.min(Math.floor(x), colors.length - 2);
  const probe = new VMobject();
  const a = new VMobject({fillColor: colors[k]});
  const b = new VMobject({fillColor: colors[k + 1]});
  Mobject.prototype._lerp.call(probe, a, b, x - k);
  return probe.fillColor;
}

function clampTo(x: number, r: [number, number, number]): number {
  return Math.min(Math.max(x, r[0]), r[1]);
}

export class NumberPlane extends Axes {
  public backgroundLines: VGroup;
  public fadedLines: VGroup;
  public constructor(...args: any[]) {
    const [, raw] = splitKw(args);
    const fw = config.frameWidth / 2;
    const fh = config.frameHeight / 2;
    const xRange = rangeOf(raw.xRange, [-fw, fw, 1]);
    const yRange = rangeOf(raw.yRange, [-fh, fh, 1]);
    const o = {
      xRange,
      yRange,
      xLength: raw.xLength ?? xRange[1] - xRange[0],
      yLength: raw.yLength ?? yRange[1] - yRange[0],
      tips: false,
      ...raw,
      axisConfig: {includeTicks: false, strokeWidth: 2, ...(raw.axisConfig ?? {})},
    };
    super(o);
    const style = {strokeColor: BLUE_D, strokeWidth: 2, strokeOpacity: 1, ...kw([raw.backgroundLineStyle ?? {}], [])};
    const faded = {strokeColor: style.strokeColor, strokeWidth: 1, strokeOpacity: 0.5, ...kw([raw.fadedLineStyle ?? {}], [])};
    const ratio = raw.fadedLineRatio ?? 1;
    this.backgroundLines = new VGroup();
    this.fadedLines = new VGroup();
    const build = (range: [number, number, number], other: [number, number, number], vertical: boolean) => {
      const step = range[2];
      const first = Math.ceil(range[0] / step - 1e-9) * step;
      for (let v = first; v <= range[1] + 1e-9; v += step) {
        const mk = (val: number, s: Record<string, any>, into: VGroup) => {
          const a = vertical ? this.c2p(val, other[0]) : this.c2p(other[0], val);
          const b = vertical ? this.c2p(val, other[1]) : this.c2p(other[1], val);
          into.add(new Line(a, b, s));
        };
        if (Math.abs(v) > 1e-9) mk(v, style, this.backgroundLines);
        for (let k = 1; k <= ratio; k++) {
          const f = v + (step * k) / (ratio + 1);
          if (f < range[1]) mk(f, faded, this.fadedLines);
        }
      }
    };
    build(this.xRange, this.yRange, true);
    build(this.yRange, this.xRange, false);
    this.addToBack(this.fadedLines, this.backgroundLines);
  }
  public getVector(coords: number[], ...rest: any[]): Mobject {
    const o = kw(rest, [], {buff: 0});
    // Imported lazily to avoid a cycle with geometry's Arrow at module load.
    return new (ArrowRef.klass)(this.c2p(0, 0), this.c2p(coords[0], coords[1]), o);
  }
}

/** Filled in by index.ts to break the import cycle for `NumberPlane.getVector`. */
export const ArrowRef: {klass: any} = {klass: null};

for (const klass of [ValueTracker, DecimalNumber, NumberLine, Axes, NumberPlane]) aliasSnake(klass.prototype);
export const alwaysRedraw = always_redraw;
