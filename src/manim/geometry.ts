/** Manim's geometry mobjects, with the same defaults and argument names. */
import {arcPoints, cornersToPoints, lineToCubic, Points} from './bezier';
import {
  BLACK,
  BLUE,
  DEFAULT_ARROW_TIP_LENGTH,
  DEFAULT_DOT_RADIUS,
  DEFAULT_STROKE_WIDTH,
  DOWN,
  LEFT,
  MED_SMALL_BUFF,
  ORIGIN,
  RED,
  RIGHT,
  SMALL_BUFF,
  TAU,
  UP,
  WHITE,
  YELLOW,
} from './constants';
import {Mobject, VGroup, VMobject} from './mobject';
import {aliasSnake, kw, splitKw} from './util';
import {add, angleOf, dist, mul, normalize, rotate, sub, Vec} from './vec';

const pointOf = (x: Mobject | Vec): Vec => (x instanceof Mobject ? x.getCenter() : x);

export class Arc extends VMobject {
  public radius: number;
  public constructor(...args: any[]) {
    const o = kw(args, ['radius', 'startAngle', 'angle'], {
      radius: 1,
      startAngle: 0,
      angle: TAU / 4,
      arcCenter: ORIGIN,
    });
    super(o);
    this.radius = o.radius;
    this.points = arcPoints(o.startAngle, o.angle, o.radius, o.arcCenter, o.numComponents ?? 8);
  }
}

export class Circle extends VMobject {
  public radius: number;
  public constructor(...args: any[]) {
    const o = kw(args, ['radius'], {radius: 1, arcCenter: ORIGIN});
    super({color: RED, ...o});
    this.radius = o.radius;
    this.points = arcPoints(0, TAU, o.radius, o.arcCenter, 8);
  }
  public pointAtAngle(angle: number): Vec {
    return this.pointFromProportion((((angle % TAU) + TAU) % TAU) / TAU);
  }
  /** Resize and move to enclose `mob`. */
  public surround(mob: Mobject, ...rest: any[]): this {
    const o = kw(rest, ['dimToMatch', 'stretch', 'bufferFactor'], {bufferFactor: 1.2});
    const size = Math.hypot(mob.getWidth(), mob.getHeight());
    this.scaleToFitWidth(size * o.bufferFactor);
    return this.moveTo(mob.getCenter());
  }
  public static fromThreePoints(p1: Vec, p2: Vec, p3: Vec, opts: any = {}): Circle {
    const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
    const sq = (p: Vec) => p[0] * p[0] + p[1] * p[1];
    const cx = (sq(p1) * (p2[1] - p3[1]) + sq(p2) * (p3[1] - p1[1]) + sq(p3) * (p1[1] - p2[1])) / d;
    const cy = (sq(p1) * (p3[0] - p2[0]) + sq(p2) * (p1[0] - p3[0]) + sq(p3) * (p2[0] - p1[0])) / d;
    return new Circle({radius: dist([cx, cy, 0], p1), ...opts}).shift([cx, cy, 0]);
  }
}

export class Dot extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, ['point', 'radius'], {point: ORIGIN, radius: DEFAULT_DOT_RADIUS});
    super({color: WHITE, fillOpacity: 1, strokeWidth: 0, ...o});
    this.points = arcPoints(0, TAU, o.radius, o.point, 8);
  }
  public override _fillsByDefault() {
    return true;
  }
}

export class Ellipse extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, ['width', 'height'], {width: 2, height: 1});
    super({color: RED, ...o});
    this.points = arcPoints(0, TAU, 1, ORIGIN, 8);
    this.stretch(o.width / 2, 0, {aboutPoint: ORIGIN});
    this.stretch(o.height / 2, 1, {aboutPoint: ORIGIN});
  }
}

export class Annulus extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, ['innerRadius', 'outerRadius'], {innerRadius: 1, outerRadius: 2});
    super({color: WHITE, fillOpacity: 1, strokeWidth: 0, ...o});
    this.points = [
      ...arcPoints(0, TAU, o.outerRadius, ORIGIN, 8),
      ...arcPoints(0, -TAU, o.innerRadius, ORIGIN, 8),
    ];
  }
  public override _fillsByDefault() {
    return true;
  }
}

export class Sector extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, ['radius'], {radius: 1, startAngle: 0, angle: TAU / 4, arcCenter: ORIGIN});
    super({color: WHITE, fillOpacity: 1, strokeWidth: 0, ...o});
    const arc = arcPoints(o.startAngle, o.angle, o.radius, o.arcCenter, 8);
    this.points = [
      ...lineToCubic(o.arcCenter, arc[0]),
      ...arc,
      ...lineToCubic(arc[arc.length - 1], o.arcCenter),
    ];
  }
  public override _fillsByDefault() {
    return true;
  }
}

export class Line extends VMobject {
  public buff: number;
  public constructor(...args: any[]) {
    const o = kw(args, ['start', 'end'], {start: LEFT, end: RIGHT, buff: 0});
    super(o);
    this.buff = o.buff;
    this.setStartAndEnd(pointOf(o.start), pointOf(o.end));
  }
  protected setStartAndEnd(start: Vec, end: Vec) {
    if (this.buff > 0) {
      const dir = normalize(sub(end, start));
      const length = dist(start, end);
      const b = Math.min(this.buff, length / 2);
      start = add(start, mul(dir, b));
      end = sub(end, mul(dir, b));
    }
    this.points = lineToCubic(start, end);
  }
  public putStartAndEndOn(start: Vec, end: Vec): this {
    this.points = lineToCubic(start, end);
    return this;
  }
  public getVector(): Vec {
    return sub(this.getEnd(), this.getStart());
  }
  public getUnitVector(): Vec {
    return normalize(this.getVector());
  }
  public getAngle(): number {
    return angleOf(this.getVector());
  }
  public getLength(): number {
    return dist(this.getStart(), this.getEnd());
  }
  public getSlope(): number {
    return Math.tan(this.getAngle());
  }
  public setLength(length: number): this {
    const l = this.getLength();
    return l === 0 ? this : this.scale(length / l);
  }
  public setAngle(angle: number, ...rest: any[]): this {
    const o = kw(rest, ['aboutPoint'], {aboutPoint: undefined});
    return this.rotate(angle - this.getAngle(), {aboutPoint: o.aboutPoint ?? this.getStart()});
  }
}

export class DashedLine extends Line {
  public constructor(...args: any[]) {
    super(...args);
    const [, o] = splitKw(args);
    const dashLength = o.dashLength ?? 0.05;
    const ratio = o.dashedRatio ?? 0.5;
    this.dash = [dashLength, (dashLength * (1 - ratio)) / ratio];
  }
}

export class TangentLine extends Line {
  public constructor(vmob: VMobject, alpha: number, ...rest: any[]) {
    const o = kw(rest, ['length'], {length: 1, dAlpha: 1e-6});
    const a1 = Math.max(0, alpha - o.dAlpha);
    const a2 = Math.min(1, alpha + o.dAlpha);
    super(vmob.pointFromProportion(a1), vmob.pointFromProportion(a2), o);
    this.setLength(o.length);
  }
}

export class ArrowTriangleFilledTip extends VMobject {
  public constructor(o: Record<string, any> = {}) {
    super({fillOpacity: 1, strokeWidth: 0, ...o});
    const l = o.length ?? DEFAULT_ARROW_TIP_LENGTH;
    const w = o.width ?? l;
    // Pointing right, with the tip point at the origin.
    this.points = cornersToPoints([
      [0, 0, 0],
      [-l, w / 2, 0],
      [-l, -w / 2, 0],
      [0, 0, 0],
    ]);
  }
  public override _fillsByDefault() {
    return true;
  }
}

export class Arrow extends Line {
  public tip!: VMobject;
  public startTip?: VMobject;
  protected tipLength: number;
  protected maxTipRatio: number;
  protected maxStrokeRatio: number;
  protected initialStrokeWidth: number;
  protected double = false;

  public constructor(...args: any[]) {
    const o = kw(args, ['start', 'end'], {
      start: LEFT,
      end: RIGHT,
      buff: MED_SMALL_BUFF,
      strokeWidth: 6,
      tipLength: DEFAULT_ARROW_TIP_LENGTH,
      maxTipLengthToLengthRatio: 0.25,
      maxStrokeWidthToLengthRatio: 5,
    });
    super(o);
    this.tipLength = o.tipLength;
    this.maxTipRatio = o.maxTipLengthToLengthRatio;
    this.maxStrokeRatio = o.maxStrokeWidthToLengthRatio;
    this.initialStrokeWidth = this.strokeWidth;
    this.double = !!o._double;
    this.rebuild(this.getStart(), this.getEnd());
  }

  protected rebuild(start: Vec, end: Vec) {
    const length = dist(start, end);
    const tipLen = Math.min(this.tipLength, this.maxTipRatio * length);
    this.strokeWidth = Math.min(this.initialStrokeWidth, this.maxStrokeRatio * length);
    const dir = length === 0 ? RIGHT : normalize(sub(end, start));
    const angle = angleOf(dir);
    const makeTip = (at: Vec, a: number, existing?: VMobject) => {
      const tip = existing ?? new ArrowTriangleFilledTip({length: tipLen});
      const fresh = new ArrowTriangleFilledTip({length: tipLen});
      tip.points = fresh.points;
      tip.rotate(a, {aboutPoint: ORIGIN}).shift(at);
      if (!existing) {
        tip.fillColor = this.strokeColor;
        tip.strokeColor = this.strokeColor;
        tip.fillOpacity = this.strokeOpacity;
        this.add(tip);
      }
      return tip;
    };
    this.tip = makeTip(end, angle, this.tip);
    let lineStart = start;
    if (this.double) {
      this.startTip = makeTip(start, angle + Math.PI, this.startTip);
      lineStart = add(start, mul(dir, tipLen));
    }
    this.points = lineToCubic(lineStart, sub(end, mul(dir, tipLen)));
  }

  public override getEnd(): Vec {
    return this.tip ? this.tip.points[0] : super.getEnd();
  }
  public override getStart(): Vec {
    return this.startTip ? this.startTip.points[0] : super.getStart();
  }
  public override putStartAndEndOn(start: Vec, end: Vec): this {
    this.rebuild(start, end);
    return this;
  }
  public getTip(): VMobject {
    return this.tip;
  }
}

export class Vector extends Arrow {
  public constructor(...args: any[]) {
    const o = kw(args, ['direction'], {direction: RIGHT, buff: 0});
    super(ORIGIN, o.direction, o);
  }
}

export class DoubleArrow extends Arrow {
  public constructor(...args: any[]) {
    const [pos, o] = splitKw(args);
    super(...pos, {...o, _double: true});
  }
}

export class Polygon extends VMobject {
  public constructor(...args: any[]) {
    const [vertices, o] = splitKw(args);
    super({color: BLUE, ...o});
    const v: Vec[] = vertices.length === 1 && Array.isArray(vertices[0][0]) ? vertices[0] : vertices;
    this.points = cornersToPoints([...v, v[0]]);
  }
}

export class Polyline extends VMobject {
  public constructor(...args: any[]) {
    const [vertices, o] = splitKw(args);
    super(o);
    const v: Vec[] = vertices.length === 1 && Array.isArray(vertices[0][0]) ? vertices[0] : vertices;
    this.points = cornersToPoints(v);
  }
}

export class RegularPolygon extends Polygon {
  public constructor(...args: any[]) {
    const o = kw(args, ['n'], {n: 6, radius: 1, startAngle: undefined});
    const start = o.startAngle ?? (o.n % 2 === 0 ? 0 : TAU / 4);
    const verts: Vec[] = [];
    for (let i = 0; i < o.n; i++) {
      verts.push(rotate([o.radius, 0, 0], start + (i * TAU) / o.n));
    }
    super(...verts, {color: WHITE, ...o});
  }
}

export class Triangle extends RegularPolygon {
  public constructor(...args: any[]) {
    const [, o] = splitKw(args);
    super({n: 3, ...o});
  }
}

export class Star extends Polygon {
  public constructor(...args: any[]) {
    const o = kw(args, ['n'], {n: 5, outerRadius: 1, innerRadius: undefined, startAngle: TAU / 4});
    const inner = o.innerRadius ?? o.outerRadius * 0.382;
    const verts: Vec[] = [];
    for (let i = 0; i < o.n * 2; i++) {
      const r = i % 2 === 0 ? o.outerRadius : inner;
      verts.push(rotate([r, 0, 0], o.startAngle + (i * TAU) / (o.n * 2)));
    }
    super(...verts, {color: WHITE, ...o});
  }
}

export class Rectangle extends Polygon {
  public constructor(...args: any[]) {
    const o = kw(args, [], {width: 4, height: 2});
    const w = o.width / 2;
    const h = o.height / 2;
    super([w, h, 0], [-w, h, 0], [-w, -h, 0], [w, -h, 0], {color: WHITE, ...o});
  }
}

export class Square extends Rectangle {
  public sideLength: number;
  public constructor(...args: any[]) {
    const o = kw(args, ['sideLength'], {sideLength: 2});
    super({...o, width: o.sideLength, height: o.sideLength});
    this.sideLength = o.sideLength;
  }
}

export class RoundedRectangle extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, [], {width: 4, height: 2, cornerRadius: 0.5});
    super({color: WHITE, ...o});
    const w = o.width / 2;
    const h = o.height / 2;
    const r = Math.min(o.cornerRadius, w, h);
    const corners: [Vec, number][] = [
      [[w - r, h - r, 0], 0],
      [[-w + r, h - r, 0], TAU / 4],
      [[-w + r, -h + r, 0], TAU / 2],
      [[w - r, -h + r, 0], (3 * TAU) / 4],
    ];
    const pts: Points = [];
    let first: Vec | null = null;
    let last: Vec | null = null;
    for (const [c, a] of corners) {
      const arc = arcPoints(a, TAU / 4, r, c, 2);
      if (last) pts.push(...lineToCubic(last, arc[0]));
      else first = arc[0];
      pts.push(...arc);
      last = arc[arc.length - 1];
    }
    pts.push(...lineToCubic(last!, first!));
    this.points = pts;
  }
}

export class SurroundingRectangle extends RoundedRectangle {
  public constructor(mob: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {color: YELLOW, buff: SMALL_BUFF, cornerRadius: 0});
    super({
      ...o,
      width: mob.getWidth() + 2 * o.buff,
      height: mob.getHeight() + 2 * o.buff,
    });
    this.moveTo(mob.getCenter());
  }
}

export class BackgroundRectangle extends SurroundingRectangle {
  public constructor(mob: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {color: BLACK, strokeWidth: 0, fillOpacity: 0.75, buff: 0});
    super(mob, o);
  }
}

export class Underline extends Line {
  public constructor(mob: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {buff: SMALL_BUFF});
    super(LEFT, RIGHT, {...o, buff: 0});
    this.scaleToFitWidth(mob.getWidth());
    this.nextTo(mob, DOWN, {buff: o.buff});
  }
}

export class Cross extends VGroup {
  public constructor(...args: any[]) {
    const o = kw(args, ['mobject'], {strokeColor: RED, strokeWidth: 6, scaleFactor: 1});
    super();
    const a = new Line(UP_LEFT, DOWN_RIGHT, {color: o.strokeColor, strokeWidth: o.strokeWidth});
    const b = new Line(UP_RIGHT, DOWN_LEFT, {color: o.strokeColor, strokeWidth: o.strokeWidth});
    this.add(a, b);
    if (o.mobject) {
      this.stretchToFitWidth(o.mobject.getWidth()).stretchToFitHeight(o.mobject.getHeight());
      this.moveTo(o.mobject.getCenter());
    }
    this.scale(o.scaleFactor);
  }
}
const UP_LEFT: Vec = [-1, 1, 0];
const UP_RIGHT: Vec = [1, 1, 0];
const DOWN_LEFT: Vec = [-1, -1, 0];
const DOWN_RIGHT: Vec = [1, -1, 0];

/** A curly brace next to a mobject, built from Bézier curves. */
export class Brace extends VMobject {
  public direction: Vec;
  public constructor(mob: Mobject, ...rest: any[]) {
    const o = kw(rest, ['direction'], {direction: DOWN, buff: 0.2, sharpness: 2});
    super({color: WHITE, fillOpacity: 1, strokeWidth: 0, ...o});
    this.direction = o.direction;
    const angle = angleOf(o.direction) + TAU / 4; // rotate so the brace opens toward `direction`
    const probe = mob.copy().rotate(-angle, {aboutPoint: ORIGIN});
    const left = probe.getCriticalPoint([-1, -1, 0]);
    const right = probe.getCriticalPoint([1, -1, 0]);
    const width = Math.max(right[0] - left[0], 0.3);
    const h = 0.25;
    const t = 0.055; // thickness
    const q = Math.min(0.25, width / 4);
    const half = width / 2;
    // Outline of a brace pointing down, centred on x=0, top edge at y=0.
    const top: Points = [
      [-half, 0, 0], [-half, -h * 0.6, 0], [-half + q * 0.4, -h / 2, 0], [-half + q, -h / 2, 0],
      [-half + q, -h / 2, 0], [-q * 1.5, -h / 2, 0], [-q * 1.5, -h / 2, 0], [-q, -h / 2, 0],
      [-q, -h / 2, 0], [-q * 0.3, -h / 2, 0], [0, -h * 0.7, 0], [0, -h, 0],
      [0, -h, 0], [0, -h * 0.7, 0], [q * 0.3, -h / 2, 0], [q, -h / 2, 0],
      [q, -h / 2, 0], [q * 1.5, -h / 2, 0], [q * 1.5, -h / 2, 0], [half - q, -h / 2, 0],
      [half - q, -h / 2, 0], [half - q * 0.4, -h / 2, 0], [half, -h * 0.6, 0], [half, 0, 0],
    ];
    const back: Points = top
      .map(p => [p[0] * (1 - (2 * t) / width), p[1] + t * (p[1] < -h * 0.75 ? -0.2 : 1), 0])
      .reverse();
    this.points = [
      ...top,
      ...lineToCubic(top[top.length - 1], back[0]),
      ...back,
      ...lineToCubic(back[back.length - 1], top[0]),
    ];
    this.shift([(left[0] + right[0]) / 2, left[1] - o.buff, 0]);
    this.rotate(angle, {aboutPoint: ORIGIN});
  }
  public override _fillsByDefault() {
    return true;
  }
  public getTip(): Vec {
    return this.getCriticalPoint(this.direction);
  }
  public putAtTip(mob: Mobject, ...rest: any[]): this {
    const o = kw(rest, [], {buff: 0.2});
    mob.nextTo(this, this.direction, {buff: o.buff});
    return this;
  }
}

for (const klass of [Circle, Line, Arrow, Brace]) aliasSnake(klass.prototype);
