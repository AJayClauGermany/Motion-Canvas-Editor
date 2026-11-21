/** Manim's geometry mobjects, with the same defaults and argument names. */
import {arcPoints, cornersToPoints, lineToCubic, Points, svgPathToPoints} from './bezier';
import {
  BLACK,
  BLUE,
  DEFAULT_ARROW_TIP_LENGTH,
  DEFAULT_DOT_RADIUS,
  DEFAULT_FONT_SIZE,
  DEFAULT_SMALL_DOT_RADIUS,
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
import {MathTex, Tex} from './tex';
import {aliasFields, aliasSnake, kw, splitKw} from './util';
import {add, angleOf, dist, mul, normalize, rotate, sub, Vec} from './vec';

const pointOf = (x: Mobject | Vec): Vec => (x instanceof Mobject ? x.getCenter() : x);

/**
 * Manim's `TipableVMobject.add_tip`: put a triangular tip at the end (or
 * start) of an open outline and shorten the outline so it meets the tip base.
 */
function attachTip(vm: VMobject, o: Record<string, any>): VMobject {
  const length = o.tipLength ?? DEFAULT_ARROW_TIP_LENGTH;
  const width = o.tipWidth ?? length;
  const atStart = !!o.atStart;
  const pts = vm.points;
  const anchor = atStart ? pts[0] : pts[pts.length - 1];
  let handle = atStart ? pts[1] : pts[pts.length - 2];
  if (dist(anchor, handle) < 1e-9) handle = atStart ? pts[3] : pts[pts.length - 4];
  const dir = normalize(sub(anchor, handle));
  const tip = new ArrowTriangleFilledTip({length, width});
  tip.rotate(angleOf(dir), {aboutPoint: ORIGIN}).shift(anchor);
  tip.fillColor = vm.strokeColor;
  tip.strokeColor = vm.strokeColor;
  tip.fillOpacity = vm.strokeOpacity;
  const base = sub(anchor, mul(dir, length));
  const start = vm.getStart();
  const end = vm.getEnd();
  // Only the outline itself is refitted; tips already attached stay put.
  const subs = vm.submobjects;
  vm.submobjects = [];
  if (dist(start, end) > length) {
    if (atStart) VMobject.prototype.putStartAndEndOn.call(vm, base, end);
    else VMobject.prototype.putStartAndEndOn.call(vm, start, base);
  }
  vm.submobjects = subs;
  vm.add(tip);
  if (atStart) (vm as any).startTip = tip;
  else (vm as any).tip = tip;
  return tip;
}

export class Arc extends VMobject {
  public radius: number;
  public startAngle: number;
  public angle: number;
  public tip?: VMobject;
  public startTip?: VMobject;
  public constructor(...args: any[]) {
    const o = kw(args, ['radius', 'startAngle', 'angle'], {
      radius: 1,
      startAngle: 0,
      angle: TAU / 4,
      arcCenter: ORIGIN,
    });
    super(o);
    this.radius = o.radius;
    this.startAngle = o.startAngle;
    this.angle = o.angle;
    this.points = arcPoints(o.startAngle, o.angle, o.radius, o.arcCenter, o.numComponents ?? 8);
  }
  /** Centre of the circle this arc is part of (works after shifts and scales). */
  public getArcCenter(): Vec {
    const p = this.points;
    if (p.length < 4) return this.getCenter();
    // Normals to the tangents at the first curve's two anchors meet at the centre.
    const [a1, h1, h2, a2] = p;
    const t1 = sub(h1, a1);
    const t2 = sub(h2, a2);
    const n1: Vec = [-t1[1], t1[0], 0];
    const n2: Vec = [-t2[1], t2[0], 0];
    const det = n1[0] * -n2[1] - -n2[0] * n1[1];
    if (Math.abs(det) < 1e-12) return this.getCenter();
    const dx = a2[0] - a1[0];
    const dy = a2[1] - a1[1];
    const t = (dx * -n2[1] - -n2[0] * dy) / det;
    return [a1[0] + n1[0] * t, a1[1] + n1[1] * t, 0];
  }
  public addTip(...args: any[]): this {
    attachTip(this, kw(args, [], {}));
    return this;
  }
  public getTip(): VMobject | undefined {
    return this.tip;
  }
}

export class ArcBetweenPoints extends Arc {
  public constructor(start: Vec, end: Vec, ...rest: any[]) {
    const o = kw(rest, ['angle', 'radius'], {angle: TAU / 4, radius: undefined});
    let angle = o.angle;
    if (o.radius !== undefined) {
      const sign = o.radius < 0 ? -1 : 1;
      const r = Math.abs(o.radius);
      const half = dist(start, end) / 2;
      if (r < half) throw new Error('ArcBetweenPoints called with a radius that is smaller than half the distance between the points.');
      angle = sign * 2 * Math.asin(half / r);
    }
    super({...o, radius: 1, startAngle: 0, angle, arcCenter: ORIGIN});
    if (angle === 0) this.points = lineToCubic(start, end);
    else VMobject.prototype.putStartAndEndOn.call(this, start, end);
    this.radius = o.radius ?? dist(start, end) / 2 / Math.abs(Math.sin(angle / 2) || 1);
  }
}

export class CurvedArrow extends ArcBetweenPoints {
  public constructor(start: Vec, end: Vec, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(start, end, o);
    attachTip(this, o);
  }
}

export class CurvedDoubleArrow extends CurvedArrow {
  public constructor(start: Vec, end: Vec, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(start, end, o);
    attachTip(this, {...o, atStart: true});
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
  public override surround(mob: Mobject, ...rest: any[]): this {
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
    // numpy accepts `[point]` where a point is expected; so do we.
    const point: Vec = Array.isArray(o.point[0]) ? o.point[0] : pointOf(o.point);
    this.radius = o.radius;
    this.points = arcPoints(0, TAU, o.radius, point, 8);
  }
  public radius: number;
  public override _fillsByDefault() {
    return true;
  }
}

/** A dot with a bigger radius and an outline, for annotations. */
export class AnnotationDot extends Dot {
  public constructor(...args: any[]) {
    const o = kw(args, ['radius'], {
      radius: DEFAULT_DOT_RADIUS * 1.3,
      strokeWidth: 5,
      strokeColor: WHITE,
      fillColor: BLUE,
    });
    super(o);
  }
}

export class SmallDot extends Dot {
  public constructor(...args: any[]) {
    const o = kw(args, ['point'], {radius: DEFAULT_SMALL_DOT_RADIUS});
    super(o);
  }
}

/** A dot containing a label (a string becomes `MathTex`). */
export class LabeledDot extends Dot {
  public label: Mobject;
  public constructor(label: string | Mobject, ...rest: any[]) {
    const o = kw(rest, ['radius'], {radius: undefined, color: WHITE});
    const mob = typeof label === 'string' ? new MathTex(label, {color: BLACK}) : label;
    const radius = o.radius ?? 0.1 + Math.max(mob.getWidth(), mob.getHeight()) / 2;
    super({...o, radius});
    mob.moveTo(this.getCenter());
    this.label = mob;
    this.add(mob);
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
  public override putStartAndEndOn(start: Vec, end: Vec): this {
    this.points = lineToCubic(start, end);
    return this;
  }
  public setPointsByEnds(start: Vec | Mobject, end: Vec | Mobject, ...rest: any[]): this {
    const o = kw(rest, ['buff'], {buff: 0});
    this.buff = o.buff;
    this.setStartAndEnd(pointOf(start), pointOf(end));
    return this;
  }
  /** Foot of the perpendicular from `point` onto the (infinite) line. */
  public getProjection(point: Vec): Vec {
    const start = this.getStart();
    const unit = this.getUnitVector();
    const t = (point[0] - start[0]) * unit[0] + (point[1] - start[1]) * unit[1];
    return [start[0] + unit[0] * t, start[1] + unit[1] * t, 0];
  }
  public addTip(...args: any[]): this {
    attachTip(this, kw(args, [], {}));
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

/** The two-segment right-angle marker (an "L" shape). */
export class Elbow extends VMobject {
  public constructor(...args: any[]) {
    const o = kw(args, ['width', 'angle'], {width: 0.2, angle: 0});
    super(o);
    this.points = cornersToPoints([UP, add(UP, RIGHT), RIGHT]);
    this.scaleToFitWidth(o.width, {aboutPoint: ORIGIN});
    this.rotate(o.angle, {aboutPoint: ORIGIN});
  }
}

function lineIntersection(a: [Vec, Vec], b: [Vec, Vec]): Vec | null {
  const d1 = sub(a[1], a[0]);
  const d2 = sub(b[1], b[0]);
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((b[0][0] - a[0][0]) * d2[1] - (b[0][1] - a[0][1]) * d2[0]) / det;
  return [a[0][0] + d1[0] * t, a[0][1] + d1[1] * t, 0];
}

/** The arc (or elbow) marking the angle between two lines. */
export class Angle extends VMobject {
  public lines: [Line, Line];
  public quadrant: [number, number];
  public radius: number;
  public angleValue = 0;
  public constructor(line1: Line, line2: Line, ...rest: any[]) {
    const o: Record<string, any> = kw(rest, ['radius', 'quadrant', 'otherAngle', 'dot'], {
      radius: undefined,
      quadrant: [1, 1],
      otherAngle: false,
      dot: false,
      dotRadius: undefined,
      dotDistance: 0.55,
      dotColor: WHITE,
      elbow: false,
    });
    super(o);
    this.lines = [line1, line2];
    this.quadrant = o.quadrant;
    this.radius = o.radius ?? 0.4;
    const inter = lineIntersection(
      [line1.getStart(), line1.getEnd()],
      [line2.getStart(), line2.getEnd()],
    );
    // Parallel lines have no vertex: the angle is empty, as in Manim.
    if (!inter) return;
    const [q1, q2] = o.quadrant;
    let radius: number = o.radius;
    if (radius === undefined) {
      const d1 = dist(q1 === 1 ? line1.getEnd() : line1.getStart(), inter);
      const d2 = dist(q2 === 1 ? line2.getEnd() : line2.getStart(), inter);
      radius = Math.min(d1, d2) < 0.6 ? (2 / 3) * Math.min(d1, d2) : 0.4;
    }
    this.radius = radius;
    const anchor1 = add(inter, mul(line1.getUnitVector(), q1 * radius));
    const anchor2 = add(inter, mul(line2.getUnitVector(), q2 * radius));
    if (o.elbow) {
      const middle = add(anchor1, mul(line2.getUnitVector(), q2 * radius));
      this.points = cornersToPoints([anchor1, middle, anchor2]);
      this.angleValue = TAU / 4;
      return;
    }
    const a1 = angleOf(sub(anchor1, inter));
    const a2 = angleOf(sub(anchor2, inter));
    let sweep: number;
    if (!o.otherAngle) sweep = a2 > a1 ? a2 - a1 : TAU - (a1 - a2);
    else sweep = a2 < a1 ? a2 - a1 : -TAU + (a2 - a1);
    this.angleValue = sweep;
    this.points = arcPoints(a1, sweep, radius, inter, 8);
    if (o.dot) {
      const mid = rotate([radius * o.dotDistance, 0, 0], a1 + sweep / 2);
      this.add(new Dot(add(inter, mid), {radius: o.dotRadius ?? radius / 10, color: o.dotColor}));
    }
  }
  public getLines(): VGroup {
    return new VGroup(...this.lines);
  }
  public getValue(...args: any[]): number {
    const o = kw(args, ['degrees'], {degrees: false});
    return o.degrees ? (this.angleValue / TAU) * 360 : this.angleValue;
  }
  /** The angle ABC, with its vertex at B. */
  public static fromThreePoints(A: Vec, B: Vec, C: Vec, opts: Record<string, any> = {}): Angle {
    return new Angle(new Line(B, A), new Line(B, C), opts);
  }
}

export class RightAngle extends Angle {
  public constructor(line1: Line, line2: Line, ...rest: any[]) {
    const o = kw(rest, ['length'], {length: undefined});
    super(line1, line2, {...o, radius: o.length ?? o.radius, elbow: true});
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

/** Manim's brace outline; `{0}` / `{1}` are the stretchable straight parts. */
const BRACE_PATH =
  'm0.01216 0c-0.01152 0-0.01216 6.103e-4 -0.01216 0.01311v0.007762c0.06776 ' +
  '0.122 0.1799 0.1455 0.2307 0.1455h{0}c0.03046 3.899e-4 0.07964 0.00449 ' +
  '0.1246 0.02636 0.0537 0.02695 0.07418 0.05816 0.08648 0.07769 0.001562 ' +
  '0.002538 0.004539 0.002563 0.01098 0.002563 0.006444-2e-8 0.009421-2.47e-' +
  '5 0.01098-0.002563 0.0123-0.01953 0.03278-0.05074 0.08648-0.07769 0.04491' +
  '-0.02187 0.09409-0.02597 0.1246-0.02636h{0}c0.05077 0 0.1629-0.02346 ' +
  '0.2307-0.1455v-0.007762c-1.78e-6 -0.0125-6.365e-4 -0.01311-0.01216-0.0131' +
  '1-0.006444-3.919e-8 -0.009348 2.448e-5 -0.01091 0.002563-0.0123 0.01953-' +
  '0.03278 0.05074-0.08648 0.07769-0.04491 0.02187-0.09416 0.02597-0.1246 ' +
  '0.02636h{1}c-0.04786 0-0.1502 0.02094-0.2185 0.1256-0.06833-0.1046-0.1706' +
  '-0.1256-0.2185-0.1256h{1}c-0.03046-3.899e-4 -0.07972-0.004491-0.1246-0.02' +
  '636-0.0537-0.02695-0.07418-0.05816-0.08648-0.07769-0.001562-0.002538-' +
  '0.004467-0.002563-0.01091-0.002563z';
const BRACE_MIN_WIDTH = 0.90552;

/** A curly brace next to a mobject (same outline as Manim's). */
export class Brace extends VMobject {
  public buff: number;
  private tipIndex = 0;
  public constructor(mob: Mobject, ...rest: any[]) {
    const o = kw(rest, ['direction', 'buff', 'sharpness'], {direction: DOWN, buff: 0.2, sharpness: 2});
    super({color: WHITE, fillOpacity: 1, strokeWidth: 0, ...o});
    this.buff = o.buff;
    const angle = -Math.atan2(o.direction[0], o.direction[1]) + Math.PI;
    // The brace is built below the mobject as seen in a frame rotated by `angle`.
    const probe = mob.copy().rotate(-angle, {aboutPoint: ORIGIN});
    const left = probe.getCriticalPoint([-1, -1, 0]);
    const right = probe.getCriticalPoint([1, -1, 0]);
    const targetWidth = right[0] - left[0];
    const linear = Math.max(0, (targetWidth * o.sharpness - BRACE_MIN_WIDTH) / 2);
    const fmt = (x: number) => x.toFixed(6);
    const path = BRACE_PATH.replace(/\{0\}/g, fmt(linear)).replace(/\{1\}/g, fmt(-linear));
    // SVG's y axis points down: flip it so the tip points down in Manim's frame.
    const pts: Points = svgPathToPoints(path).map(p => [p[0], -p[1], 0]);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    const cx = (x0 + x1) / 2;
    let best = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - cx, p[1] - y0);
      if (d < best) {
        best = d;
        this.tipIndex = i;
      }
    });
    const fx = x1 - x0 > 0 && targetWidth > 0 ? targetWidth / (x1 - x0) : 1;
    const dx = left[0] - x0 * fx;
    const dy = left[1] - y1 - o.buff;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    this.points = pts.map(p => {
      const x = p[0] * fx + dx;
      const y = p[1] + dy;
      return [x * c - y * sn, x * sn + y * c, 0];
    });
  }
  public override _fillsByDefault() {
    return true;
  }
  public getTip(): Vec {
    return this.points[this.tipIndex] ?? this.getCenter();
  }
  /** Unit vector from the brace's centre to its tip. */
  public getDirection(): Vec {
    return normalize(sub(this.getTip(), this.getCenter()));
  }
  public putAtTip(mob: Mobject, ...rest: any[]): this {
    const o = kw(rest, ['useNextTo'], {useNextTo: true, buff: undefined});
    const dir = this.getDirection();
    const buff = o.buff ?? 0.25;
    if (o.useNextTo) {
      mob.nextTo(this.getTip(), [Math.round(dir[0]), Math.round(dir[1]), 0], {buff});
    } else {
      mob.moveTo(this.getTip());
      mob.shift(mul(dir, mob.getWidth() / 2 + buff));
    }
    return this;
  }
  /** A `Tex` label at the tip. */
  public getText(...args: any[]): Mobject {
    const [parts, o] = splitKw(args);
    const {buff, useNextTo, ...texOpts} = o;
    const mob = new Tex(...parts, texOpts);
    this.putAtTip(mob, {buff, useNextTo: useNextTo ?? true});
    return mob;
  }
  /** A `MathTex` label at the tip. */
  public getTex(...args: any[]): Mobject {
    const [parts, o] = splitKw(args);
    const {buff, useNextTo, ...texOpts} = o;
    const mob = new MathTex(...parts, texOpts);
    this.putAtTip(mob, {buff, useNextTo: useNextTo ?? true});
    return mob;
  }
}

/** A brace spanning two points. */
export class BraceBetweenPoints extends Brace {
  public constructor(point1: Vec, point2: Vec, ...rest: any[]) {
    const o = kw(rest, ['direction'], {direction: undefined});
    const d = sub(point2, point1);
    const direction = o.direction ?? [d[1], -d[0], 0];
    super(new Line(point1, point2), {...o, direction});
  }
}

/** A brace with a label attached (`MathTex` by default). */
export class BraceLabel extends VGroup {
  public brace: Brace;
  public label: Mobject;
  protected labelConstructor: any;
  protected braceDirection: Vec;
  public constructor(obj: Mobject, text: string | string[], ...rest: any[]) {
    const o = kw(rest, ['braceDirection', 'labelConstructor', 'fontSize', 'buff'], {
      braceDirection: DOWN,
      labelConstructor: MathTex,
      fontSize: DEFAULT_FONT_SIZE,
      buff: 0.2,
      braceConfig: {},
    });
    super();
    this.labelConstructor = o.labelConstructor;
    this.braceDirection = o.braceDirection;
    this.brace = new Brace(obj, o.braceDirection, o.buff, o.braceConfig);
    const parts = Array.isArray(text) ? text : [String(text)];
    this.label = new this.labelConstructor(...parts, {fontSize: o.fontSize});
    this.brace.putAtTip(this.label);
    this.add(this.brace, this.label);
  }
  public changeLabel(...args: any[]): this {
    const [parts, o] = splitKw(args);
    this.remove(this.label);
    this.label = new this.labelConstructor(...parts, o);
    this.brace.putAtTip(this.label);
    this.add(this.label);
    this._familyChanged();
    return this;
  }
  public shiftBrace(obj: Mobject, ...rest: any[]): this {
    const [, o] = splitKw(rest);
    this.brace.become(new Brace(obj, this.braceDirection, o));
    this.brace.putAtTip(this.label);
    return this;
  }
}

/** A brace with a `Tex` label. */
export class BraceText extends BraceLabel {
  public constructor(obj: Mobject, text: string | string[], ...rest: any[]) {
    const o = kw(rest, ['braceDirection'], {});
    super(obj, text, {labelConstructor: Tex, ...o});
  }
}

for (const klass of [Arc, Circle, Line, Arrow, Angle, Brace, BraceLabel]) aliasSnake(klass.prototype);
aliasFields(Arc.prototype, ['startAngle']);
aliasFields(Arrow.prototype, ['startTip']);
aliasFields(Square.prototype, ['sideLength']);
aliasFields(Angle.prototype, ['angleValue']);
