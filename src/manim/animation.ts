/**
 * Manim's animation classes. The structure follows Manim: an animation has
 * `begin`, `interpolate(alpha)` and `finish`, and `Scene.play` drives it with
 * Canvas Commons' frame clock.
 */
import {arcPoints} from './bezier';
import {DOWN, ORIGIN, PI, TAU, YELLOW} from './constants';
import {Line, Rectangle, SurroundingRectangle} from './geometry';
import {Mobject, VGroup, VMobject} from './mobject';
import {
  double_smooth,
  linear,
  RateFunc,
  smooth,
  there_and_back,
  wiggle as wiggleRate,
} from './rate_functions';
import {Glyph} from './text';
import {aliasFields, aliasSnake, hooks, isPlain, isThread, kw, splitKw, toHex} from './util';
import {add, mul, rotate, sub, Vec} from './vec';

export interface SceneLike {
  add(...mobs: Mobject[]): any;
  remove(...mobs: Mobject[]): any;
  mobjects: Mobject[];
}

/** Whether `mob` is already on screen, on its own or inside a group. */
function inScene(scene: SceneLike, mob: Mobject): boolean {
  for (const m of scene.mobjects) {
    if (m === mob) return true;
    if (m.submobjects.length && m.getFamily().includes(mob)) return true;
  }
  return false;
}

/**
 * Add a mobject an animation needs, unless it is already there: as in Manim,
 * animating something never changes its place in the drawing order.
 */
function addIfMissing(scene: SceneLike, ...mobs: Mobject[]): void {
  for (const mob of mobs) if (!inScene(scene, mob)) scene.add(mob);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Animation {
  public mobject: Mobject;
  public runTime = 1;
  public rateFunc: RateFunc = smooth;
  public lagRatio = 0;
  public remover = false;
  public introducer = false;
  /** Play the animation backwards (Manim's `reverse_rate_function`). */
  public reverseRateFunction = false;
  public name: string;
  public startingMobject!: Mobject;
  /** Native tweens (generators) that `Scene.play` runs alongside this animation. */
  public threads: Generator[] = [];
  protected opts: Record<string, any>;

  public constructor(mobject: Mobject | null | undefined, opts: Record<string, any> = {}) {
    this.mobject = hooks.toMobject(mobject) ?? new VGroup();
    this.opts = opts;
    const ctor = this.constructor as any;
    this.name = opts.name ?? (Object.hasOwn(ctor, 'displayName') ? ctor.displayName : ctor.name);
    this.configure(opts);
  }

  /** Apply `run_time`, `rate_func`, `lag_ratio` and `remover`. */
  public configure(o: Record<string, any>): this {
    if (o.runTime !== undefined) this.runTime = o.runTime;
    if (o.rateFunc !== undefined) this.rateFunc = o.rateFunc;
    if (o.lagRatio !== undefined) this.lagRatio = o.lagRatio;
    if (o.remover !== undefined) this.remover = o.remover;
    if (o.introducer !== undefined) this.introducer = o.introducer;
    if (o.reverseRateFunction !== undefined) this.reverseRateFunction = o.reverseRateFunction;
    return this;
  }
  public setRunTime(t: number): this {
    this.runTime = t;
    return this;
  }
  public setRateFunc(f: RateFunc): this {
    this.rateFunc = f;
    return this;
  }
  public getRunTime(): number {
    return this.runTime;
  }

  public begin(scene: SceneLike): void {
    this.startingMobject = this.createStartingMobject();
    this.setupScene(scene);
    this.interpolate(0);
  }
  protected createStartingMobject(): Mobject {
    return this.mobject.copy();
  }
  protected setupScene(scene: SceneLike): void {
    addIfMissing(scene, this.mobject);
  }
  public finish(_scene: SceneLike): void {
    this.interpolate(1);
  }
  public cleanUp(scene: SceneLike): void {
    if (this.remover) scene.remove(this.mobject);
  }

  /** `alpha` is raw time progress in [0, 1]. */
  public interpolate(alpha: number): void {
    this.interpolateMobject(clamp01(alpha));
  }

  protected families(): Mobject[][] {
    return [this.mobject.getFamily(), this.startingMobject.getFamily()];
  }

  protected interpolateMobject(alpha: number): void {
    const families = this.families();
    const n = families[0].length;
    const full = (n - 1) * this.lagRatio + 1;
    for (let i = 0; i < n; i++) {
      const sub = clamp01(alpha * full - i * this.lagRatio);
      this.interpolateSubmobject(
        families[0][i],
        families[1][i],
        this.rateFunc(this.reverseRateFunction ? 1 - sub : sub),
        families[2]?.[i],
      );
    }
  }

  protected interpolateSubmobject(
    _sub: Mobject,
    _start: Mobject,
    _alpha: number,
    _extra?: Mobject,
  ): void {}
}

export class Wait extends Animation {
  public constructor(...args: any[]) {
    const o = kw(args, ['runTime'], {runTime: 1});
    super(null, {...o, rateFunc: linear});
  }
  protected override setupScene(): void {}
}

/** Give a leaf the portion `[a, b]` of another leaf's outline. */
function becomePartial(sub: Mobject, src: Mobject, a: number, b: number) {
  if (sub instanceof VMobject && src instanceof VMobject) {
    sub.pointwiseBecomePartial(src, a, b);
  } else if (sub instanceof Glyph) {
    sub.partial = a <= 0 && b >= 1 ? null : [a, b];
  } else if (sub._kind() === 'node') {
    // A native node has no outline to trace: it fades with the drawn portion.
    sub.fillOpacity = src.fillOpacity * (b - a);
  }
}

// ------------------------------------------------------------------ creation

export class ShowPartial extends Animation {
  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number): void {
    const [a, b] = this.bounds(alpha);
    becomePartial(sub, start, a, b);
    if (sub instanceof Glyph) {
      // Text has no outline to trace when it is fill-only, so fade the fill in.
      sub.fillOpacity = start.fillOpacity * (b - a);
    }
  }
  protected bounds(alpha: number): [number, number] {
    return [0, alpha];
  }
}

export class Create extends ShowPartial {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {lagRatio: 1, introducer: true});
    super(mobject, o);
  }
}
export class ShowCreation extends Create {}

export class Uncreate extends Create {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {remover: true, introducer: false});
    super(mobject, o);
    const f = this.rateFunc;
    this.rateFunc = t => f(1 - t);
  }
}

export class ShowPassingFlash extends ShowPartial {
  private timeWidth: number;
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {timeWidth: 0.1, remover: true, introducer: true});
    super(mobject, o);
    this.timeWidth = o.timeWidth;
  }
  protected override bounds(alpha: number): [number, number] {
    const tw = this.timeWidth;
    const upper = alpha * (1 + tw);
    return [clamp01(upper - tw), clamp01(upper)];
  }
  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    this.mobject.become(this.startingMobject);
  }
}

export class DrawBorderThenFill extends Animation {
  protected outline!: Mobject;
  protected drawStrokeWidth: number;
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {runTime: 2, rateFunc: double_smooth, strokeWidth: 2, introducer: true});
    super(mobject, o);
    this.drawStrokeWidth = o.strokeWidth;
  }
  public override begin(scene: SceneLike): void {
    this.outline = this.mobject.copy();
    for (const m of this.outline.getFamily()) {
      const strokeVisible = m.strokeWidth > 0 && m.strokeOpacity > 0;
      m.strokeColor = strokeVisible ? m.strokeColor : m.fillColor;
      m.strokeWidth = this.drawStrokeWidth;
      m.strokeOpacity = 1;
      m.fillOpacity = 0;
    }
    super.begin(scene);
  }
  protected override families(): Mobject[][] {
    return [this.mobject.getFamily(), this.startingMobject.getFamily(), this.outline.getFamily()];
  }
  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number, outline?: Mobject): void {
    if (!outline) return;
    if (alpha < 0.5) {
      const a = alpha * 2;
      sub._copyData(start);
      Mobject.prototype._copyData.call(sub, outline);
      becomePartial(sub, outline, 0, a);
    } else {
      const a = alpha * 2 - 1;
      becomePartial(sub, start, 0, 1);
      sub._lerp(outline, start, a);
      if (sub instanceof Glyph) sub.partial = null;
    }
  }
}

export class Write extends DrawBorderThenFill {
  /** Start with the last submobject instead of the first. */
  protected reverse: boolean;
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {});
    const length = mobject.familyMembersWithPoints().length;
    const reverse = !!o.reverse;
    super(mobject, {
      runTime: length < 15 ? 1 : 2,
      lagRatio: Math.min(4 / Math.max(1, length), 0.2),
      rateFunc: linear,
      remover: reverse,
      introducer: !reverse,
      ...o,
    });
    this.reverse = reverse;
  }
  protected override families(): Mobject[][] {
    const families = super.families();
    return this.reverse ? families.map(f => [...f].reverse()) : families;
  }
}

export class Unwrite extends Write {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {reverse: true});
    super(mobject, {remover: true, introducer: false, ...o, reverseRateFunction: true});
  }
  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    // Leave the mobject intact so it can be shown again.
    this.mobject.become(this.startingMobject);
  }
}

export class ShowIncreasingSubsets extends Animation {
  private all: Mobject[];
  public constructor(group: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {rateFunc: linear, introducer: true});
    super(group, o);
    this.all = [...group.submobjects];
  }
  public override interpolate(alpha: number): void {
    const n = this.all.length;
    const k = Math.round(this.rateFunc(clamp01(alpha)) * n);
    this.updateList(k);
  }
  protected updateList(k: number) {
    this.mobject.submobjects = this.all.slice(0, k);
    this.mobject._familyChanged();
  }
  public override finish(scene: SceneLike): void {
    super.finish(scene);
    this.mobject.submobjects = this.all;
    this.mobject._familyChanged();
  }
}

export class AddTextLetterByLetter extends ShowIncreasingSubsets {
  public constructor(text: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {timePerChar: 0.1});
    super(text, {runTime: o.runTime ?? Math.max(0.1, text.submobjects.length * o.timePerChar), ...o});
  }
}

// ------------------------------------------------------------------ transform

export class Transform extends Animation {
  public targetMobject: Mobject;
  public targetCopy!: Mobject;
  protected pathArc: number;
  public replace = false;

  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {pathArc: 0});
    super(mobject, o);
    this.targetMobject = hooks.toMobject(target);
    this.pathArc = o.pathArc;
    if (o.replaceMobjectWithTargetInScene) this.replace = true;
  }

  protected createTarget(): Mobject {
    return this.targetMobject;
  }

  public override begin(scene: SceneLike): void {
    this.targetMobject = this.createTarget();
    this.targetCopy = this.targetMobject.copy();
    this.mobject.alignData(this.targetCopy);
    super.begin(scene);
  }

  protected override families(): Mobject[][] {
    return [
      this.mobject.getFamily(),
      this.startingMobject.getFamily(),
      this.targetCopy.getFamily(),
    ];
  }

  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number, target?: Mobject): void {
    if (!target) return;
    sub._lerp(start, target, alpha);
    if (this.pathArc !== 0 && sub instanceof VMobject && alpha > 0 && alpha < 1) {
      this.applyArc(sub, start as VMobject, target as VMobject, alpha);
    }
  }

  /** Move points along circular arcs instead of straight lines. */
  private applyArc(sub: VMobject, a: VMobject, b: VMobject, t: number) {
    if (a.points.length !== b.points.length) return;
    const angle = this.pathArc;
    const k = 1 / (2 * Math.tan(angle / 2));
    sub.points = a.points.map((p, i) => {
      const q = b.points[i];
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const cx = mx - (q[1] - p[1]) * k;
      const cy = my + (q[0] - p[0]) * k;
      return rotate(p, angle * t, [cx, cy, 0]);
    });
  }

  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    if (this.replace) {
      // Manim's `scene.replace`: the target takes the mobject's place in the
      // drawing order when it can.
      const at = scene.mobjects.indexOf(this.mobject);
      if (at >= 0 && !inScene(scene, this.targetMobject)) {
        const list = [...scene.mobjects];
        list[at] = this.targetMobject;
        scene.mobjects = list;
      } else {
        scene.remove(this.mobject);
        addIfMissing(scene, this.targetMobject);
      }
    }
  }
}

export class ReplacementTransform extends Transform {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    super(mobject, target, ...rest);
    this.replace = true;
  }
}

export class TransformFromCopy extends Transform {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    super(mobject.copy(), target, ...rest);
    this.replace = true;
  }
}

export class ClockwiseTransform extends Transform {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {pathArc: -PI});
    super(mobject, target, o);
  }
}
export class CounterclockwiseTransform extends Transform {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {pathArc: PI});
    super(mobject, target, o);
  }
}

export class MoveToTarget extends Transform {
  public constructor(mobject: Mobject, ...rest: any[]) {
    if (!mobject.target) throw new Error('MoveToTarget called on a mobject without a target. Call generate_target() first.');
    super(mobject, mobject.target, ...rest);
  }
}

export class Restore extends Transform {
  public constructor(mobject: Mobject, ...rest: any[]) {
    if (!mobject.savedState) throw new Error('Restore called on a mobject without a saved state. Call save_state() first.');
    super(mobject, mobject.savedState, ...rest);
  }
}

export class ApplyFunction extends Transform {
  public constructor(fn: (m: Mobject) => Mobject, mobject: Mobject, ...rest: any[]) {
    const target = fn(mobject.copy());
    super(mobject, target, ...rest);
  }
}

/** `ApplyPointwiseFunction(lambda p: ..., mob)`: bend a mobject through a point function. */
export class ApplyPointwiseFunction extends Transform {
  public constructor(fn: (p: Vec) => Vec, mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {runTime: 3});
    super(mobject, mobject.copy().applyFunction(fn), o);
  }
}

export class ApplyMatrix extends Transform {
  public constructor(matrix: number[][], mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {aboutPoint: ORIGIN});
    super(mobject, mobject.copy().applyMatrix(matrix, {aboutPoint: o.aboutPoint}), o);
  }
}

/** Move each mobject to where the next one is (the last goes to the first). */
export class CyclicReplace extends Transform {
  public constructor(...args: any[]) {
    const [mobs, o] = splitKw(args);
    const group = new VGroup(...mobs);
    const target = group.copy();
    target.submobjects.forEach((m, i) => m.moveTo(mobs[(i + 1) % mobs.length].getCenter()));
    super(group, target, {pathArc: PI / 2, ...o});
  }
}
export class Swap extends CyclicReplace {}

export class ScaleInPlace extends Transform {
  public constructor(mobject: Mobject, factor: number, ...rest: any[]) {
    super(mobject, mobject.copy().scale(factor), ...rest);
  }
}

export class FadeToColor extends Transform {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, ['color'], {});
    super(mobject, mobject.copy().setColor(o.color), o);
  }
}

/** Cross-fade between two mobjects of any kind. */
export class FadeTransform extends Animation {
  private target: Mobject;
  private targetStart!: Mobject;
  private targetEnd!: Mobject;
  private sourceEnd!: Mobject;
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(mobject, o);
    this.target = target;
  }
  public override begin(scene: SceneLike): void {
    this.startingMobject = this.mobject.copy();
    this.targetEnd = this.target.copy();
    // The source ends where the target is; the target starts where the source is.
    this.sourceEnd = this.mobject.copy();
    fitTo(this.sourceEnd, this.target);
    this.sourceEnd.fade(1);
    this.targetStart = this.target.copy();
    fitTo(this.targetStart, this.mobject);
    this.targetStart.fade(1);
    addIfMissing(scene, this.mobject, this.target);
    this.interpolate(0);
  }
  public override interpolate(alpha: number): void {
    const a = this.rateFunc(clamp01(alpha));
    this.mobject.interpolate(this.startingMobject, this.sourceEnd, a);
    this.target.interpolate(this.targetStart, this.targetEnd, a);
  }
  public override cleanUp(scene: SceneLike): void {
    scene.remove(this.mobject);
    this.mobject.become(this.startingMobject);
  }
}

function fitTo(m: Mobject, reference: Mobject) {
  const w = m.getWidth();
  const h = m.getHeight();
  if (w > 1e-6 && reference.getWidth() > 1e-6) m.stretch(reference.getWidth() / w, 0);
  if (h > 1e-6 && reference.getHeight() > 1e-6) m.stretch(reference.getHeight() / h, 1);
  m.moveTo(reference.getCenter());
}

// ---------------------------------------------------------------------- fade

function fadedCopy(mob: Mobject, o: Record<string, any>, incoming: boolean): Mobject {
  const c = mob.copy();
  c.fade(1);
  if (o.scale !== undefined) c.scale(incoming ? o.scale : 1 / o.scale);
  if (o.shift) c.shift(incoming ? mul(o.shift, -1) : o.shift);
  if (o.targetPosition) {
    const p = o.targetPosition instanceof Mobject ? o.targetPosition.getCenter() : o.targetPosition;
    c.moveTo(p);
  }
  return c;
}

export class FadeIn extends Transform {
  private fadeOpts: Record<string, any>;
  public constructor(...args: any[]) {
    const [mobs, o] = splitKw(args);
    const mobject = mobs.length === 1 ? mobs[0] : new VGroup(...mobs);
    super(mobject, mobject, {introducer: true, ...o});
    this.fadeOpts = o;
  }
  public override begin(scene: SceneLike): void {
    this.targetMobject = this.mobject.copy();
    this.targetCopy = this.targetMobject.copy();
    this.startingMobject = fadedCopy(this.mobject, this.fadeOpts, true);
    this.setupScene(scene);
    this.interpolate(0);
  }
}

export class FadeOut extends Transform {
  private fadeOpts: Record<string, any>;
  public constructor(...args: any[]) {
    const [mobs, o] = splitKw(args);
    const mobject = mobs.length === 1 ? mobs[0] : new VGroup(...mobs);
    super(mobject, mobject, {remover: true, ...o});
    this.fadeOpts = o;
  }
  public override begin(scene: SceneLike): void {
    this.startingMobject = this.mobject.copy();
    this.targetCopy = fadedCopy(this.mobject, this.fadeOpts, false);
    this.setupScene(scene);
    this.interpolate(0);
  }
  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    // Leave the mobject as it was, so it can be re-added later.
    this.mobject.become(this.startingMobject);
  }
}

// -------------------------------------------------------------------- growing

export class GrowFromPoint extends Transform {
  protected point: Vec;
  protected pointColor?: any;
  public constructor(mobject: Mobject, point: Vec, ...rest: any[]) {
    const o = kw(rest, ['pointColor'], {introducer: true});
    super(mobject, mobject, o);
    this.point = point;
    this.pointColor = o.pointColor;
  }
  public override begin(scene: SceneLike): void {
    this.targetCopy = this.mobject.copy();
    const start = this.mobject.copy();
    start.scale(0, {aboutPoint: this.point});
    if (this.pointColor) start.setColor(this.pointColor);
    this.startingMobject = start;
    this.setupScene(scene);
    this.interpolate(0);
  }
}
export class GrowFromCenter extends GrowFromPoint {
  public constructor(mobject: Mobject, ...rest: any[]) {
    super(mobject, mobject.getCenter(), ...rest);
  }
}
export class GrowFromEdge extends GrowFromPoint {
  public constructor(mobject: Mobject, edge: Vec, ...rest: any[]) {
    super(mobject, mobject.getCriticalPoint(edge), ...rest);
  }
}
export class GrowArrow extends GrowFromPoint {
  public constructor(arrow: Mobject, ...rest: any[]) {
    super(arrow, (arrow as any).getStart(), ...rest);
  }
}
export class SpinInFromNothing extends GrowFromPoint {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {pathArc: PI});
    super(mobject, mobject.getCenter(), o);
  }
}
export class ShrinkToCenter extends Transform {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {remover: true});
    super(mobject, mobject, o);
  }
  public override begin(scene: SceneLike): void {
    this.startingMobject = this.mobject.copy();
    this.targetCopy = this.mobject.copy().scale(0);
    this.setupScene(scene);
    this.interpolate(0);
  }
  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    this.mobject.become(this.startingMobject);
  }
}

// ------------------------------------------------------------------- movement

export class Rotate extends Animation {
  protected angle: number;
  protected about?: Vec;
  protected aboutEdge?: Vec;
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, ['angle', 'axis'], {angle: PI, aboutPoint: undefined, aboutEdge: undefined});
    super(mobject, o);
    this.angle = o.angle * ((o.axis?.[2] ?? 1) < 0 ? -1 : 1);
    this.about = o.aboutPoint;
    this.aboutEdge = o.aboutEdge;
  }
  public override begin(scene: SceneLike): void {
    this.about ??= this.mobject.getCriticalPoint(this.aboutEdge ?? ORIGIN);
    super.begin(scene);
  }
  public override interpolate(alpha: number): void {
    this.mobject.become(this.startingMobject);
    this.mobject.rotate(this.rateFunc(clamp01(alpha)) * this.angle, {aboutPoint: this.about});
  }
}

export class Rotating extends Rotate {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, ['angle'], {runTime: 5, rateFunc: linear});
    super(mobject, {...o, angle: o.radians ?? o.angle ?? TAU});
  }
}

export class MoveAlongPath extends Animation {
  private path: VMobject;
  public constructor(mobject: Mobject, path: VMobject, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(mobject, o);
    this.path = path;
  }
  public override interpolate(alpha: number): void {
    this.mobject.moveTo(this.path.pointFromProportion(this.rateFunc(clamp01(alpha))));
  }
}

export class UpdateFromFunc extends Animation {
  private fn: (m: Mobject) => void;
  public constructor(mobject: Mobject, fn: (m: Mobject) => void, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(mobject, o);
    this.fn = fn;
  }
  public override interpolate(): void {
    this.fn(this.mobject);
  }
}

export class UpdateFromAlphaFunc extends Animation {
  private fn: (m: Mobject, alpha: number) => void;
  public constructor(mobject: Mobject, fn: (m: Mobject, alpha: number) => void, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(mobject, o);
    this.fn = fn;
  }
  public override interpolate(alpha: number): void {
    this.fn(this.mobject, this.rateFunc(clamp01(alpha)));
  }
}

/** Move every point along `homotopy(x, y, z, t)` as `t` runs from 0 to 1. */
export class Homotopy extends Animation {
  private homotopy: (x: number, y: number, z: number, t: number) => Vec;
  public constructor(homotopy: (x: number, y: number, z: number, t: number) => Vec, mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {runTime: 3});
    super(mobject, o);
    this.homotopy = homotopy;
  }
  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number): void {
    sub._copyData(start);
    sub._applyFunction(p => this.homotopy(p[0], p[1], p[2] ?? 0, alpha));
  }
}

/** Animate a `DecimalNumber` toward a value. */
export class ChangingDecimal extends Animation {
  private fn: (alpha: number) => number;
  public constructor(decimal: Mobject, fn: (alpha: number) => number, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(decimal, o);
    this.fn = fn;
  }
  public override interpolate(alpha: number): void {
    (this.mobject as any).setValue(this.fn(this.rateFunc(clamp01(alpha))));
  }
}
export class ChangeDecimalToValue extends ChangingDecimal {
  public constructor(decimal: Mobject, target: number, ...rest: any[]) {
    const start: number = (decimal as any).number ?? 0;
    super(decimal, (a: number) => start + (target - start) * a, ...rest);
  }
}

// ----------------------------------------------------------------- indication

export class Indicate extends Transform {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {scaleFactor: 1.2, color: YELLOW, rateFunc: there_and_back});
    super(mobject, mobject, o);
  }
  public override begin(scene: SceneLike): void {
    this.startingMobject = this.mobject.copy();
    this.targetCopy = this.mobject.copy().scale(this.opts.scaleFactor).setColor(this.opts.color);
    this.setupScene(scene);
    this.interpolate(0);
  }
}

export class Wiggle extends Animation {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {scaleValue: 1.1, rotationAngle: 0.01 * TAU, nWiggles: 6, runTime: 2, rateFunc: linear});
    super(mobject, o);
  }
  public override interpolate(alpha: number): void {
    const a = clamp01(alpha);
    const o = this.opts;
    this.mobject.become(this.startingMobject);
    const about = this.startingMobject.getCenter();
    this.mobject.scale(1 + (o.scaleValue - 1) * there_and_back(a), {aboutPoint: about});
    this.mobject.rotate(wiggleRate(a, o.nWiggles) * o.rotationAngle, {aboutPoint: about});
  }
}

export class Flash extends Animation {
  private lines: VGroup;
  private center: Vec;
  public constructor(point: Mobject | Vec, ...rest: any[]) {
    const o = kw(rest, [], {
      lineLength: 0.2,
      numLines: 12,
      flashRadius: 0.1,
      lineStrokeWidth: 3,
      color: YELLOW,
      timeWidth: 1,
      runTime: 1,
      remover: true,
    });
    const center = point instanceof Mobject ? point.getCenter() : point;
    const lines = new VGroup();
    for (let i = 0; i < o.numLines; i++) {
      const dir = rotate([1, 0, 0], (i * TAU) / o.numLines);
      lines.add(
        new Line(
          add(center, mul(dir, o.flashRadius)),
          add(center, mul(dir, o.flashRadius + o.lineLength)),
          {color: o.color, strokeWidth: o.lineStrokeWidth},
        ),
      );
    }
    super(lines, o);
    this.lines = lines;
    this.center = center;
  }
  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number): void {
    if (!(sub instanceof VMobject) || !(start instanceof VMobject)) return;
    const upper = alpha * 2;
    becomePartial(sub, start, clamp01(upper - 1), clamp01(upper));
  }
}

export class Circumscribe extends Animation {
  private frame: VMobject;
  private fadeOut: boolean;
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, ['shape'], {color: YELLOW, buff: 0.1, timeWidth: 0.3, fadeOut: false, runTime: 1, strokeWidth: 4});
    const frame =
      o.shape && o.shape !== Rectangle && (o.shape.displayName === 'Circle' || o.shape.name === 'Circle')
        ? circleAround(mobject, o)
        : new SurroundingRectangle(mobject, {color: o.color, buff: o.buff, strokeWidth: o.strokeWidth});
    super(frame, {...o, remover: true, introducer: true});
    this.frame = frame;
    this.fadeOut = o.fadeOut;
  }
  protected override interpolateSubmobject(sub: Mobject, start: Mobject, alpha: number): void {
    if (this.fadeOut) {
      // Draw, then fade.
      if (alpha < 0.5) becomePartial(sub, start, 0, alpha * 2);
      else {
        becomePartial(sub, start, 0, 1);
        sub.strokeOpacity = start.strokeOpacity * (1 - (alpha * 2 - 1));
      }
    } else {
      // Draw, then erase from the start.
      if (alpha < 0.5) becomePartial(sub, start, 0, alpha * 2);
      else becomePartial(sub, start, alpha * 2 - 1, 1);
    }
  }
}

function circleAround(mob: Mobject, o: Record<string, any>): VMobject {
  const c = new VMobject({color: o.color, strokeWidth: o.strokeWidth});
  const r = Math.hypot(mob.getWidth(), mob.getHeight()) / 2 + o.buff;
  c.points = arcPoints(0, TAU, r, mob.getCenter(), 8);
  return c;
}

export class FocusOn extends Transform {
  public constructor(point: Mobject | Vec, ...rest: any[]) {
    const o = kw(rest, [], {opacity: 0.2, color: '#888888', runTime: 2, remover: true});
    const center = point instanceof Mobject ? point.getCenter() : point;
    const big = new VMobject({fillColor: o.color, fillOpacity: 0, strokeWidth: 0});
    big.points = arcPoints(0, TAU, 8, center, 8);
    const small = new VMobject({fillColor: o.color, fillOpacity: o.opacity, strokeWidth: 0});
    small.points = arcPoints(0, TAU, 0.2, center, 8);
    super(big, small, o);
  }
}

export class ApplyWave extends Animation {
  public constructor(mobject: Mobject, ...rest: any[]) {
    const o = kw(rest, ['direction'], {direction: [0, 1, 0], amplitude: 0.2, ripples: 1, runTime: 2, rateFunc: linear});
    super(mobject, o);
  }
  public override interpolate(alpha: number): void {
    const t = clamp01(alpha);
    const o = this.opts;
    const [x0, , x1] = this.startingMobject.getBounds();
    const span = Math.max(x1 - x0, 1e-6);
    const mine = this.mobject.getFamily();
    const starts = this.startingMobject.getFamily();
    const width = 0.35;
    mine.forEach((m, i) => {
      const s = starts[i];
      const wave = (px: number) => {
        const rel = (px - x0) / span;
        const d = (rel - (t * (1 + 2 * width) - width)) / width;
        return Math.abs(d) < 1 ? o.amplitude * Math.cos((d * Math.PI) / 2) ** 2 : 0;
      };
      if (m instanceof VMobject && s instanceof VMobject) {
        m.points = s.points.map(p => add(p, mul(o.direction, wave(p[0]))));
      } else if (m instanceof Glyph && s instanceof Glyph) {
        m.pos = add(s.pos, mul(o.direction, wave(s.pos[0])));
      }
    });
  }
}

// ---------------------------------------------------------------- composition

export class AnimationGroup extends Animation {
  public animations: Animation[];
  protected timings: {anim: Animation; start: number; end: number; begun: boolean; done: boolean}[] = [];
  protected scene!: SceneLike;
  protected lazy = false;

  public constructor(...args: any[]) {
    const [items, o] = splitKw(args);
    const flat = items.flat();
    const anims = flat.filter(x => !isThread(x)).map(toAnimation);
    super(new VGroup(), {lagRatio: 0, rateFunc: linear, ...o});
    // Native tweens are not on the group's clock: they start with the play.
    this.threads = flat.filter(isThread);
    this.animations = anims;
    this.buildTimings();
    this.runTime = this.maxEnd();
    // Stretch the children so the whole group lasts `run_time`.
    if (o.runTime !== undefined) this.configure({runTime: o.runTime});
  }

  protected override setupScene(): void {}

  public override configure(o: Record<string, any>): this {
    super.configure(o);
    if (o.runTime !== undefined && this.animations) {
      const total = this.maxEnd();
      const k = total > 0 ? o.runTime / total : 1;
      for (const a of this.animations) a.configure({runTime: a.runTime * k});
      this.buildTimings();
      this.runTime = this.maxEnd();
    }
    return this;
  }

  private maxEnd(): number {
    return this.timings.reduce((m, t) => Math.max(m, t.end), 0);
  }

  protected buildTimings() {
    this.timings = [];
    let cursor = 0;
    for (const anim of this.animations) {
      const start = cursor;
      const end = start + anim.runTime;
      this.timings.push({anim, start, end, begun: false, done: false});
      cursor = start + (end - start) * this.lagRatio;
    }
  }

  public override begin(scene: SceneLike): void {
    this.scene = scene;
    this.lazy = this.lagRatio >= 1;
    if (!this.lazy) {
      for (const t of this.timings) {
        t.anim.begin(scene);
        t.begun = true;
      }
    }
    this.interpolate(0);
  }

  public override interpolate(alpha: number): void {
    const time = this.rateFunc(clamp01(alpha)) * this.runTime;
    for (const t of this.timings) {
      const span = t.end - t.start;
      if (this.lazy && !t.begun) {
        if (time < t.start && !(alpha >= 1)) continue;
        t.anim.begin(this.scene);
        t.begun = true;
      }
      if (t.done) continue;
      const sub = span === 0 ? (time >= t.start ? 1 : 0) : clamp01((time - t.start) / span);
      t.anim.interpolate(sub);
      if (this.lazy && sub >= 1) {
        t.anim.finish(this.scene);
        t.anim.cleanUp(this.scene);
        t.done = true;
      }
    }
  }

  public override finish(scene: SceneLike): void {
    this.interpolate(1);
    for (const t of this.timings) {
      if (!t.done) {
        t.anim.finish(scene);
        t.done = true;
        (t as any).needsCleanup = true;
      }
    }
  }

  public override cleanUp(scene: SceneLike): void {
    for (const t of this.timings) {
      if ((t as any).needsCleanup) t.anim.cleanUp(scene);
    }
  }
}

export class LaggedStart extends AnimationGroup {
  public constructor(...args: any[]) {
    const [items, o] = splitKw(args);
    super(...items, {lagRatio: 0.05, ...o});
  }
}

export class Succession extends AnimationGroup {
  public constructor(...args: any[]) {
    const [items, o] = splitKw(args);
    super(...items, {lagRatio: 1, ...o});
  }
}

export class LaggedStartMap extends LaggedStart {
  public constructor(AnimClass: any, group: Mobject, ...rest: any[]) {
    const [pos, o] = splitKw(rest);
    const argCreator = typeof pos[0] === 'function' ? pos[0] : (m: Mobject) => [m];
    const {lagRatio, runTime, ...animOpts} = o;
    super(
      ...group.submobjects.map(m => new AnimClass(...argCreator(m), animOpts)),
      {lagRatio: lagRatio ?? 0.05, ...(runTime !== undefined ? {runTime} : {})},
    );
  }
}

// ---------------------------------------------------------- matching transforms

/** A size- and position-independent fingerprint of a leaf's shape. */
function shapeKey(m: Mobject): string {
  if (m instanceof Glyph) return `glyph:${m.char}:${m.font}`;
  if (!(m instanceof VMobject) || m.points.length === 0) return `empty:${m.id}`;
  const [x0, y0, x1, y1] = m._ownBounds()!;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const size = y1 - y0 > 1e-9 ? y1 - y0 : x1 - x0 > 1e-9 ? x1 - x0 : 1;
  let key = `${m.points.length}:`;
  for (const p of m.points) {
    key += `${Math.round(((p[0] - cx) / size) * 50)},${Math.round(((p[1] - cy) / size) * 50)};`;
  }
  return key;
}

/**
 * Shared machinery of `TransformMatchingShapes` / `TransformMatchingTex`:
 * parts with the same key morph into each other, the rest fade out and in.
 */
class TransformMatchingBase extends AnimationGroup {
  private source: Mobject;
  private targetMobject: Mobject;
  private helpers: Mobject[] = [];

  public constructor(
    mobject: Mobject,
    target: Mobject,
    parts: (m: Mobject) => Mobject[],
    keyOf: (m: Mobject) => string,
    o: Record<string, any>,
  ) {
    const {transformMismatches, fadeTransformMismatches, keyMap, ...animOpts} = o;
    const index = (list: Mobject[]) => {
      const map = new Map<string, Mobject[]>();
      for (const part of list) {
        const key = keyOf(part);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(part);
      }
      return map;
    };
    const src = index(parts(mobject));
    const tgt = index(parts(target));
    // `key_map: {"a": "b"}` forces a source key to morph into a target key.
    for (const [from, to] of Object.entries<string>(keyMap ?? {})) {
      if (src.has(from) && tgt.has(to)) {
        const moved = src.get(from)!;
        src.delete(from);
        src.set(to, [...(src.get(to) ?? []), ...moved]);
      }
    }
    const matchedSource = new VGroup();
    const matchedTarget = new VGroup();
    const sourceOnly = new VGroup();
    const targetOnly = new VGroup();
    for (const [key, list] of src) {
      const other = tgt.get(key);
      if (other) {
        matchedSource.add(new VGroup(...list));
        matchedTarget.add(new VGroup(...other));
      } else sourceOnly.add(...list);
    }
    for (const [key, list] of tgt) if (!src.has(key)) targetOnly.add(...list);
    const anims: Animation[] = [];
    if (matchedSource.submobjects.length) anims.push(new Transform(matchedSource, matchedTarget, animOpts));
    if (transformMismatches && sourceOnly.submobjects.length && targetOnly.submobjects.length) {
      anims.push(new Transform(sourceOnly, targetOnly, animOpts));
    } else if (fadeTransformMismatches && sourceOnly.submobjects.length && targetOnly.submobjects.length) {
      anims.push(new FadeTransform(sourceOnly, targetOnly, animOpts));
    } else {
      if (sourceOnly.submobjects.length) anims.push(new FadeOut(sourceOnly, {targetPosition: target, ...animOpts}));
      if (targetOnly.submobjects.length) anims.push(new FadeIn(targetOnly, {targetPosition: mobject, ...animOpts}));
    }
    super(...anims, {});
    this.mobject = mobject;
    this.source = mobject;
    this.targetMobject = target;
    this.helpers = [matchedSource, sourceOnly, targetOnly];
  }

  public override cleanUp(scene: SceneLike): void {
    super.cleanUp(scene);
    scene.remove(this.source, ...this.helpers);
    for (const part of this.source.getFamily()) scene.remove(part);
    scene.add(this.targetMobject);
  }
}

/** Morph the pieces of one mobject into the identically shaped pieces of another. */
export class TransformMatchingShapes extends TransformMatchingBase {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {});
    super(mobject, target, m => m.familyMembersWithPoints(), shapeKey, o);
  }
}

/** Morph the parts of one `MathTex` into the parts of another with the same TeX. */
export class TransformMatchingTex extends TransformMatchingBase {
  public constructor(mobject: Mobject, target: Mobject, ...rest: any[]) {
    const o = kw(rest, [], {});
    const parts = (m: Mobject): Mobject[] =>
      m.submobjects.flatMap(s => ((s as any).texString !== undefined ? [s] : parts(s)));
    super(mobject, target, parts, m => (m as any).texString ?? `part:${m.id}`, o);
  }
}

// ------------------------------------------------------------------- .animate

/**
 * `mob.animate.shift(UP).set_color(RED)` — the calls are applied to a copy
 * and the animation interpolates the mobject toward it (Manim's
 * `_AnimationBuilder`).
 */
export class AnimateBuilder {
  public target: Mobject;
  public opts: Record<string, any> = {};
  public calls: string[] = [];
  public constructor(public readonly mobject: Mobject) {
    this.target = mobject.generateTarget();
  }
  public build(): Animation {
    const anim = new MoveToTarget(this.mobject, this.opts);
    anim.name = this.calls.length ? `animate.${this.calls.join('.')}` : 'animate';
    return anim;
  }
}

function makeAnimateProxy(mobject: Mobject): any {
  const builder = new AnimateBuilder(mobject);
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop: string | symbol) {
      if (prop === '__builder') return builder;
      if (prop === 'build') return () => builder.build();
      if (typeof prop === 'symbol') return undefined;
      const member = (builder.target as any)[prop];
      if (typeof member !== 'function') {
        throw new Error(`.animate: ${builder.target.name} has no method "${prop}"`);
      }
      return (...args: any[]) => {
        member.apply(builder.target, args);
        builder.calls.push(prop);
        return proxy;
      };
    },
    apply(_t, _this, args) {
      // mob.animate(run_time: 2).shift(UP)
      if (args.length && isPlain(args[0])) Object.assign(builder.opts, kw(args, []));
      return proxy;
    },
  });
  return proxy;
}

Object.defineProperty(Mobject.prototype, 'animate', {
  get(this: Mobject) {
    return makeAnimateProxy(this);
  },
  configurable: true,
});

export function toAnimation(x: any): Animation {
  if (x instanceof Animation) return x;
  const builder: AnimateBuilder | undefined = x?.__builder;
  if (builder) return builder.build();
  x = hooks.toMobject(x);
  if (x instanceof Mobject) {
    throw new Error(`play() got a ${x.name} instead of an animation. Did you mean ${x.name}.animate, or FadeIn(...)?`);
  }
  throw new Error(`play() expected an animation but got ${String(x)}`);
}

export {toHex, DOWN, sub};
for (const klass of [Animation]) aliasSnake(klass.prototype);
aliasFields(Animation.prototype, ['runTime', 'rateFunc', 'lagRatio', 'startingMobject', 'targetMobject', 'targetCopy']);
