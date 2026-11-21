/**
 * Mobject model: a faithful, small re-implementation of Manim's object model
 * on top of Canvas Commons. Geometry lives in Manim units (frame is 8 units
 * tall, y is up). Every drawable leaf owns a Canvas Commons node, so mobjects
 * take part in the normal scene graph and can be mixed with native nodes.
 */
import {Node} from '@canvas-commons/2d';
import {BBox} from '@canvas-commons/core';
import {
  alignPoints,
  changeAnchorMode,
  cornersToPoints,
  curveLengths,
  insertCurves,
  lerpPoints,
  lineToCubic,
  partialPoints,
  pointAtProportion,
  Points,
  smoothPoints,
  splitSubpaths,
} from './bezier';
import {
  config,
  DEFAULT_MOBJECT_TO_EDGE_BUFFER,
  DEFAULT_MOBJECT_TO_MOBJECT_BUFFER,
  DEFAULT_STROKE_WIDTH,
  DL,
  LEFT,
  ORIGIN,
  RIGHT,
  UP,
  WHITE,
} from './constants';
import {aliasSnake, callerLine, hooks, kw, lerpColor, rgba, splitKw, toHex} from './util';
import {add, eq, mul, sub, Vec} from './vec';

export type Updater = (mob: any, dt: number) => void;
export type Bounds = [number, number, number, number]; // minX, minY, maxX, maxY

export type AffineOp =
  | {type: 'shift'; v: Vec}
  | {type: 'scale'; fx: number; fy: number; about: Vec}
  | {type: 'rotate'; angle: number; about: Vec};

let idCounter = 0;
export function resetMobjectIds() {
  idCounter = 0;
}

/** The Canvas Commons node that paints one leaf mobject. */
export class MobNode extends Node {
  public constructor(public readonly mob: Mobject) {
    super({});
  }

  protected override draw(context: CanvasRenderingContext2D) {
    this.mob._draw(context, config.unit);
  }

  protected override getCacheBBox(): BBox {
    const b = this.mob._ownBounds();
    if (!b) return new BBox();
    const u = config.unit;
    const pad = this.mob.strokeWidth * 0.01 * u + 2;
    return new BBox(
      b[0] * u - pad,
      -b[3] * u - pad,
      (b[2] - b[0]) * u + pad * 2,
      (b[3] - b[1]) * u + pad * 2,
    );
  }
}

export class Mobject {
  public id = ++idCounter;
  public name: string;
  public submobjects: Mobject[] = [];
  public parents: Mobject[] = [];
  public zIndex = 0;
  public updaters: Updater[] = [];
  public updatingSuspended = false;
  public target?: Mobject;
  public savedState?: Mobject;
  public sourceLine?: number;
  /** The Canvas Commons node that displays this leaf (see `_makeNode`). */
  public node?: Node;

  public fillColor: string = WHITE;
  public fillOpacity = 0;
  public strokeColor: string = WHITE;
  public strokeOpacity = 1;
  public strokeWidth = DEFAULT_STROKE_WIDTH;

  public constructor(opts: Record<string, any> = {}) {
    const ctor = this.constructor as any;
    this.name =
      opts.name ?? (Object.hasOwn(ctor, 'displayName') ? ctor.displayName : ctor.name);
    if (opts.zIndex !== undefined) this.zIndex = opts.zIndex;
    this.sourceLine = callerLine();
  }

  /** Apply the Manim style keyword arguments shared by all constructors. */
  protected initStyle(o: Record<string, any>, defaults: Record<string, any> = {}) {
    const color = o.color ?? defaults.color;
    if (color !== undefined) {
      this.fillColor = toHex(color);
      this.strokeColor = toHex(color);
    }
    const pick = (k: string) => o[k] ?? defaults[k];
    if (pick('fillColor') !== undefined) this.fillColor = toHex(pick('fillColor'));
    if (pick('strokeColor') !== undefined) this.strokeColor = toHex(pick('strokeColor'));
    if (pick('fillOpacity') !== undefined) this.fillOpacity = pick('fillOpacity');
    if (pick('strokeOpacity') !== undefined) this.strokeOpacity = pick('strokeOpacity');
    if (pick('strokeWidth') !== undefined) this.strokeWidth = pick('strokeWidth');
    if (o.fillColor !== undefined && o.fillOpacity === undefined && defaults.fillOpacity === undefined) {
      // Mirrors Manim: giving a fill colour without opacity makes it visible.
      this.fillOpacity = 1;
    }
  }

  // ---------------------------------------------------------------- family

  public add(...mobs: (Mobject | Mobject[])[]): this {
    for (const item of mobs.flat()) {
      // A native Canvas Commons node joins the family as a `NodeMobject`.
      const m: Mobject = hooks.toMobject(item);
      if (!m || m === this) continue;
      if (!this.submobjects.includes(m)) {
        this.submobjects.push(m);
        m.parents.push(this);
      }
    }
    return this;
  }

  public addToBack(...mobs: (Mobject | Mobject[])[]): this {
    const list: Mobject[] = mobs.flat().map(hooks.toMobject);
    this.remove(...list);
    this.submobjects.unshift(...list);
    for (const m of list) m.parents.push(this);
    return this;
  }

  public remove(...mobs: (Mobject | Mobject[])[]): this {
    for (const item of mobs.flat()) {
      const m: Mobject = hooks.toMobject(item);
      const i = this.submobjects.indexOf(m);
      if (i >= 0) {
        this.submobjects.splice(i, 1);
        m.parents = m.parents.filter(p => p !== this);
      }
    }
    return this;
  }

  public getFamily(): Mobject[] {
    const out: Mobject[] = [this];
    for (const s of this.submobjects) out.push(...s.getFamily());
    return out;
  }

  /** Leaves that actually paint something. */
  public familyMembersWithPoints(): Mobject[] {
    return this.getFamily().filter(m => m.hasPoints());
  }

  public hasPoints(): boolean {
    return false;
  }

  public get length(): number {
    return this.submobjects.length;
  }

  /** Reverse the order of the submobjects. */
  public invert(recursive = false): this {
    this.submobjects.reverse();
    if (recursive) for (const s of this.submobjects) s.invert(true);
    this._familyChanged();
    return this;
  }

  /** Sort submobjects by a function of their centre (default: x). */
  public sort(pointToNum: (p: Vec) => number = p => p[0], submobFunc?: (m: Mobject) => number): this {
    const key = submobFunc ?? ((m: Mobject) => pointToNum(m.getCenter()));
    this.submobjects.sort((a, b) => key(a) - key(b));
    this._familyChanged();
    return this;
  }

  public at(i: number): Mobject | undefined {
    return this.submobjects.at(i);
  }

  public slice(start?: number, end?: number): Mobject {
    return new VGroup(...this.submobjects.slice(start, end));
  }

  public [Symbol.iterator]() {
    return this.submobjects[Symbol.iterator]();
  }

  public copy(): this {
    const family = this.getFamily();
    const map = new Map<Mobject, Mobject>();
    const clone = (m: Mobject): Mobject => {
      const c: Mobject = Object.create(Object.getPrototypeOf(m));
      Object.assign(c, m);
      c.id = ++idCounter;
      c.node = undefined;
      c.parents = [];
      c.updaters = [...m.updaters];
      c.target = undefined;
      c.savedState = undefined;
      map.set(m, c);
      c.submobjects = m.submobjects.map(s => {
        const sc = clone(s);
        sc.parents = [c];
        return sc;
      });
      return c;
    };
    const root = clone(this);
    // Attributes that point into the family (arrow.tip, axes.xAxis, ...) must
    // point into the copied family.
    for (const m of family) {
      const c = map.get(m)! as any;
      for (const key of Object.keys(c)) {
        if (key === 'submobjects' || key === 'parents') continue;
        const v = c[key];
        if (v instanceof Mobject && map.has(v)) c[key] = map.get(v);
      }
      c._onCopy?.(m);
    }
    return root as this;
  }

  // ----------------------------------------------------------- leaf hooks

  public _ownBounds(): Bounds | null {
    return null;
  }
  public _affine(_op: AffineOp): void {}
  /** Map every point of this leaf through `fn` (non-linear transforms). */
  public _applyFunction(_fn: (p: Vec) => Vec): void {}
  public _draw(_ctx: CanvasRenderingContext2D, _unit: number): void {}
  /**
   * The Canvas Commons node that puts this leaf on screen, created on first
   * use. `null` keeps the leaf out of the scene's display list (a wrapped
   * native node that lives inside some other native container).
   */
  public _makeNode(_scene: {root: Node; view: Node; displayDirty?: boolean}): Node | null {
    return (this.node ??= new MobNode(this));
  }
  /** Copy leaf data (geometry + style) from another mobject of the same kind. */
  public _copyData(from: Mobject): void {
    this.fillColor = from.fillColor;
    this.fillOpacity = from.fillOpacity;
    this.strokeColor = from.strokeColor;
    this.strokeOpacity = from.strokeOpacity;
    this.strokeWidth = from.strokeWidth;
  }
  /** Set this leaf to the blend of two aligned leaves. */
  public _lerp(a: Mobject, b: Mobject, t: number): void {
    this.fillColor = lerpColor(a.fillColor, b.fillColor, t);
    this.strokeColor = lerpColor(a.strokeColor, b.strokeColor, t);
    this.fillOpacity = a.fillOpacity + (b.fillOpacity - a.fillOpacity) * t;
    this.strokeOpacity = a.strokeOpacity + (b.strokeOpacity - a.strokeOpacity) * t;
    this.strokeWidth = a.strokeWidth + (b.strokeWidth - a.strokeWidth) * t;
  }
  /** Make `this` and `other` structurally compatible for `_lerp`. */
  public _alignLeaf(_other: Mobject): void {}

  // -------------------------------------------------------- bounding box

  public getBounds(): Bounds {
    let out: Bounds | null = null;
    for (const m of this.getFamily()) {
      const b = m._ownBounds();
      if (!b) continue;
      out = out
        ? [
            Math.min(out[0], b[0]),
            Math.min(out[1], b[1]),
            Math.max(out[2], b[2]),
            Math.max(out[3], b[3]),
          ]
        : b;
    }
    return out ?? [0, 0, 0, 0];
  }

  public getCriticalPoint(direction: Vec): Vec {
    const [x0, y0, x1, y1] = this.getBounds();
    const pick = (lo: number, hi: number, d: number) =>
      d < 0 ? lo : d > 0 ? hi : (lo + hi) / 2;
    return [pick(x0, x1, direction[0]), pick(y0, y1, direction[1]), 0];
  }
  public getBoundingBoxPoint(direction: Vec): Vec {
    return this.getCriticalPoint(direction);
  }
  public getEdgeCenter(direction: Vec): Vec {
    return this.getCriticalPoint(direction);
  }
  public getCorner(direction: Vec): Vec {
    return this.getCriticalPoint(direction);
  }
  public getCenter(): Vec {
    return this.getCriticalPoint(ORIGIN);
  }
  public getTop(): Vec {
    return this.getCriticalPoint(UP);
  }
  public getBottom(): Vec {
    return this.getCriticalPoint([0, -1, 0]);
  }
  public getLeft(): Vec {
    return this.getCriticalPoint(LEFT);
  }
  public getRight(): Vec {
    return this.getCriticalPoint(RIGHT);
  }
  public getX(direction: Vec = ORIGIN): number {
    return this.getCriticalPoint(direction)[0];
  }
  public getY(direction: Vec = ORIGIN): number {
    return this.getCriticalPoint(direction)[1];
  }
  public getWidth(): number {
    const b = this.getBounds();
    return b[2] - b[0];
  }
  public getHeight(): number {
    const b = this.getBounds();
    return b[3] - b[1];
  }
  public get width(): number {
    return this.getWidth();
  }
  public set width(value: number) {
    this.scaleToFitWidth(value);
  }
  public get height(): number {
    return this.getHeight();
  }
  public set height(value: number) {
    this.scaleToFitHeight(value);
  }

  // ------------------------------------------------------ transformations

  public applyAffine(op: AffineOp): this {
    for (const m of this.getFamily()) m._affine(op);
    return this;
  }

  public shift(...vectors: Vec[]): this {
    let v: Vec = [0, 0, 0];
    for (const x of vectors) v = add(v, x);
    return this.applyAffine({type: 'shift', v});
  }

  public scale(factor: number, ...rest: any[]): this {
    const o = kw(rest, [], {aboutPoint: undefined, aboutEdge: ORIGIN});
    const about = o.aboutPoint ?? this.getCriticalPoint(o.aboutEdge);
    return this.applyAffine({type: 'scale', fx: factor, fy: factor, about});
  }

  public stretch(factor: number, dim: number, ...rest: any[]): this {
    const o = kw(rest, [], {aboutPoint: undefined, aboutEdge: ORIGIN});
    const about = o.aboutPoint ?? this.getCriticalPoint(o.aboutEdge);
    return this.applyAffine({
      type: 'scale',
      fx: dim === 0 ? factor : 1,
      fy: dim === 1 ? factor : 1,
      about,
    });
  }

  public rotate(angle: number, ...rest: any[]): this {
    const o = kw(rest, ['axis'], {aboutPoint: undefined, aboutEdge: ORIGIN, axis: [0, 0, 1]});
    const about = o.aboutPoint ?? this.getCriticalPoint(o.aboutEdge);
    const sign = (o.axis[2] ?? 0) < 0 ? -1 : 1;
    return this.applyAffine({type: 'rotate', angle: angle * sign, about});
  }

  public rotateAboutOrigin(angle: number): this {
    return this.rotate(angle, {aboutPoint: ORIGIN});
  }

  /** Apply an arbitrary point function to every point (handles included). */
  public applyFunction(fn: (p: Vec) => Vec): this {
    for (const m of this.getFamily()) m._applyFunction(fn);
    return this;
  }

  /** Apply a 2x2 or 3x3 matrix about `about_point` (default: the origin). */
  public applyMatrix(matrix: number[][], ...rest: any[]): this {
    const o = kw(rest, [], {aboutPoint: ORIGIN});
    const [ax, ay] = o.aboutPoint;
    const [[a, b], [c, d]] = matrix;
    return this.applyFunction(p => {
      const x = p[0] - ax;
      const y = p[1] - ay;
      return [ax + a * x + b * y, ay + c * x + d * y, 0];
    });
  }

  public flip(...args: any[]): this {
    const o = kw(args, ['axis'], {axis: UP, aboutPoint: undefined});
    const axis: Vec = o.axis;
    const about = o.aboutPoint ?? this.getCenter();
    const horizontal = Math.abs(axis[1]) >= Math.abs(axis[0]);
    return this.applyAffine({
      type: 'scale',
      fx: horizontal ? -1 : 1,
      fy: horizontal ? 1 : -1,
      about,
    });
  }

  public scaleToFitWidth(width: number, ...rest: any[]): this {
    const w = this.getWidth();
    return w === 0 ? this : this.scale(width / w, ...rest);
  }
  public scaleToFitHeight(height: number, ...rest: any[]): this {
    const h = this.getHeight();
    return h === 0 ? this : this.scale(height / h, ...rest);
  }
  public stretchToFitWidth(width: number, ...rest: any[]): this {
    const w = this.getWidth();
    return w === 0 ? this : this.stretch(width / w, 0, ...rest);
  }
  public stretchToFitHeight(height: number, ...rest: any[]): this {
    const h = this.getHeight();
    return h === 0 ? this : this.stretch(height / h, 1, ...rest);
  }
  /** Take the size (and position) of `mob`. */
  public replace(mob: Mobject, ...rest: any[]): this {
    const o = kw(rest, ['dimToMatch', 'stretch'], {dimToMatch: 0, stretch: false});
    if (o.stretch) {
      this.stretchToFitWidth(mob.getWidth());
      this.stretchToFitHeight(mob.getHeight());
    } else if (o.dimToMatch === 1) {
      this.scaleToFitHeight(mob.getHeight());
    } else {
      this.scaleToFitWidth(mob.getWidth());
    }
    return this.shift(sub(mob.getCenter(), this.getCenter()));
  }
  public surround(mob: Mobject, ...rest: any[]): this {
    const o = kw(rest, ['dimToMatch', 'stretch', 'buff'], {dimToMatch: 0, stretch: false, buff: 0.25});
    this.replace(mob, o.dimToMatch, o.stretch);
    const length = o.dimToMatch === 1 ? mob.getHeight() : mob.getWidth();
    return length === 0 ? this : this.scale((length + o.buff) / length);
  }
  public matchWidth(mob: Mobject, ...rest: any[]): this {
    return this.scaleToFitWidth(mob.getWidth(), ...rest);
  }
  public matchHeight(mob: Mobject, ...rest: any[]): this {
    return this.scaleToFitHeight(mob.getHeight(), ...rest);
  }
  public matchX(mob: Mobject, direction: Vec = ORIGIN): this {
    return this.shift([mob.getX(direction) - this.getX(direction), 0, 0]);
  }
  public matchY(mob: Mobject, direction: Vec = ORIGIN): this {
    return this.shift([0, mob.getY(direction) - this.getY(direction), 0]);
  }
  public matchColor(mob: Mobject): this {
    return this.setColor(mob.getColor());
  }
  /** Copy the outline of `mob`, family member by family member. */
  public matchPoints(mob: Mobject): this {
    const mine = this.getFamily();
    const theirs = mob.getFamily();
    for (let i = 0; i < mine.length && i < theirs.length; i++) {
      const a = mine[i];
      const b = theirs[i];
      if (a instanceof VMobject && b instanceof VMobject) a.points = b.points;
    }
    return this;
  }

  public setWidth(width: number, ...rest: any[]): this {
    return this.scaleToFitWidth(width, ...rest);
  }
  public setHeight(height: number, ...rest: any[]): this {
    return this.scaleToFitHeight(height, ...rest);
  }

  public moveTo(target: Mobject | Vec, ...rest: any[]): this {
    const o = kw(rest, ['alignedEdge'], {alignedEdge: ORIGIN});
    target = hooks.toMobject(target);
    const point =
      target instanceof Mobject ? target.getCriticalPoint(o.alignedEdge) : target;
    return this.shift(sub(point, this.getCriticalPoint(o.alignedEdge)));
  }

  public center(): this {
    return this.shift(mul(this.getCenter(), -1));
  }

  public setX(x: number, ...rest: any[]): this {
    const o = kw(rest, ['direction'], {direction: ORIGIN});
    return this.shift([x - this.getX(o.direction), 0, 0]);
  }
  public setY(y: number, ...rest: any[]): this {
    const o = kw(rest, ['direction'], {direction: ORIGIN});
    return this.shift([0, y - this.getY(o.direction), 0]);
  }

  public nextTo(target: Mobject | Vec, ...rest: any[]): this {
    const o = kw(rest, ['direction', 'buff', 'alignedEdge'], {
      direction: RIGHT,
      buff: DEFAULT_MOBJECT_TO_MOBJECT_BUFFER,
      alignedEdge: ORIGIN,
    });
    target = hooks.toMobject(target);
    const targetPoint =
      target instanceof Mobject
        ? target.getCriticalPoint(add(o.alignedEdge, o.direction))
        : target;
    const pointToAlign = this.getCriticalPoint(sub(o.alignedEdge, o.direction));
    return this.shift(add(sub(targetPoint, pointToAlign), mul(o.direction, o.buff)));
  }

  public alignTo(target: Mobject | Vec, ...rest: any[]): this {
    const direction: Vec = kw(rest, ['direction'], {direction: ORIGIN}).direction;
    target = hooks.toMobject(target);
    const point =
      target instanceof Mobject ? target.getCriticalPoint(direction) : target;
    const mine = this.getCriticalPoint(direction);
    return this.shift([
      direction[0] !== 0 ? point[0] - mine[0] : 0,
      direction[1] !== 0 ? point[1] - mine[1] : 0,
      0,
    ]);
  }

  public toEdge(...args: any[]): this {
    const o = kw(args, ['edge', 'buff'], {edge: LEFT, buff: DEFAULT_MOBJECT_TO_EDGE_BUFFER});
    return this.alignOnBorder(o.edge, o.buff);
  }
  public toCorner(...args: any[]): this {
    const o = kw(args, ['corner', 'buff'], {corner: DL, buff: DEFAULT_MOBJECT_TO_EDGE_BUFFER});
    return this.alignOnBorder(o.corner, o.buff);
  }
  /** Nudge the mobject back inside the frame if it sticks out. */
  public shiftOntoScreen(...rest: any[]): this {
    const o = kw(rest, [], {buff: DEFAULT_MOBJECT_TO_EDGE_BUFFER});
    const fw = config.frameWidth / 2;
    const fh = config.frameHeight / 2;
    for (const v of [UP, [0, -1, 0], LEFT, RIGHT] as Vec[]) {
      const dim = v[0] !== 0 ? 0 : 1;
      const max = (dim === 0 ? fw : fh) - o.buff;
      const edge = this.getCriticalPoint(v);
      if (edge[dim] * v[dim] > max) this.alignOnBorder(v, o.buff);
    }
    return this;
  }
  protected alignOnBorder(direction: Vec, buff: number): this {
    const sx = Math.sign(direction[0]);
    const sy = Math.sign(direction[1]);
    const target: Vec = [(sx * config.frameWidth) / 2, (sy * config.frameHeight) / 2, 0];
    const mine = this.getCriticalPoint(direction);
    return this.shift([
      sx !== 0 ? target[0] - mine[0] - buff * sx : 0,
      sy !== 0 ? target[1] - mine[1] - buff * sy : 0,
      0,
    ]);
  }

  public arrange(...rest: any[]): this {
    const o = kw(rest, ['direction', 'buff', 'center'], {
      direction: RIGHT,
      buff: DEFAULT_MOBJECT_TO_MOBJECT_BUFFER,
      center: true,
      alignedEdge: ORIGIN,
    });
    for (let i = 1; i < this.submobjects.length; i++) {
      this.submobjects[i].nextTo(this.submobjects[i - 1], o.direction, {
        buff: o.buff,
        alignedEdge: o.alignedEdge,
      });
    }
    if (o.center) this.center();
    return this;
  }

  public arrangeInGrid(...rest: any[]): this {
    const o: Record<string, any> = kw(rest, ['rows', 'cols', 'buff'], {
      rows: undefined,
      cols: undefined,
      buff: DEFAULT_MOBJECT_TO_MOBJECT_BUFFER,
    });
    const n = this.submobjects.length;
    let rows: number = o.rows;
    let cols: number = o.cols;
    if (!rows && !cols) cols = Math.ceil(Math.sqrt(n));
    if (!cols) cols = Math.ceil(n / rows);
    if (!rows) rows = Math.ceil(n / cols);
    const [bx, by] = Array.isArray(o.buff) ? o.buff : [o.buff, o.buff];
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    this.submobjects.forEach((m, i) => {
      colW[i % cols] = Math.max(colW[i % cols], m.getWidth());
      rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], m.getHeight());
    });
    const xs: number[] = [];
    const ys: number[] = [];
    let x = 0;
    for (let c = 0; c < cols; c++) {
      xs.push(x + colW[c] / 2);
      x += colW[c] + bx;
    }
    let y = 0;
    for (let r = 0; r < rows; r++) {
      ys.push(y - rowH[r] / 2);
      y -= rowH[r] + by;
    }
    const center = this.getCenter();
    this.submobjects.forEach((m, i) => m.moveTo([xs[i % cols], ys[Math.floor(i / cols)], 0]));
    return this.moveTo(center);
  }

  /** `mob.set(width=3, color=RED)`: assign attributes by name, chainable. */
  public set(...args: any[]): this {
    const [, o] = splitKw(args);
    for (const key of Object.keys(o)) {
      if (key === 'color') this.setColor(o[key]);
      else (this as any)[key] = o[key];
    }
    return this;
  }

  public setZIndex(z: number): this {
    for (const m of this.getFamily()) m.zIndex = z;
    return this;
  }
  public getZIndex(): number {
    return this.zIndex;
  }

  // ---------------------------------------------------------------- style

  public setColor(color: any): this {
    const hex = toHex(color);
    for (const m of this.getFamily()) {
      m.fillColor = hex;
      m.strokeColor = hex;
    }
    return this;
  }

  public setFill(...args: any[]): this {
    const o = kw(args, ['color', 'opacity']);
    for (const m of this.getFamily()) {
      if (o.color !== undefined) m.fillColor = toHex(o.color);
      if (o.opacity !== undefined) m.fillOpacity = o.opacity;
    }
    return this;
  }

  public setStroke(...args: any[]): this {
    const o = kw(args, ['color', 'width', 'opacity']);
    for (const m of this.getFamily()) {
      if (o.color !== undefined) m.strokeColor = toHex(o.color);
      if (o.width !== undefined) m.strokeWidth = o.width;
      if (o.opacity !== undefined) m.strokeOpacity = o.opacity;
    }
    return this;
  }

  /** As in Manim, this sets fill *and* stroke opacity (so outlines get filled). */
  public setOpacity(opacity: number): this {
    for (const m of this.getFamily()) {
      m.fillOpacity = opacity;
      m.strokeOpacity = opacity;
    }
    return this;
  }

  public setStyle(...args: any[]): this {
    const o = kw(args, [], {});
    if (o.fillColor !== undefined || o.fillOpacity !== undefined) this.setFill(o.fillColor, o.fillOpacity);
    if (o.strokeColor !== undefined || o.strokeWidth !== undefined || o.strokeOpacity !== undefined) {
      this.setStroke(o.strokeColor, o.strokeWidth, o.strokeOpacity);
    }
    if (o.color !== undefined) this.setColor(o.color);
    return this;
  }
  public getFillColor(): string {
    return (this.hasPoints() ? this : (this.familyMembersWithPoints()[0] ?? this)).fillColor;
  }
  public getStrokeColor(): string {
    return (this.hasPoints() ? this : (this.familyMembersWithPoints()[0] ?? this)).strokeColor;
  }
  public getFillOpacity(): number {
    return (this.hasPoints() ? this : (this.familyMembersWithPoints()[0] ?? this)).fillOpacity;
  }
  public getStrokeWidth(): number {
    return (this.hasPoints() ? this : (this.familyMembersWithPoints()[0] ?? this)).strokeWidth;
  }

  public _fillsByDefault(): boolean {
    return false;
  }

  public fade(darkness = 0.5): this {
    for (const m of this.getFamily()) {
      m.fillOpacity *= 1 - darkness;
      m.strokeOpacity *= 1 - darkness;
    }
    return this;
  }

  public setColorByGradient(...colors: any[]): this {
    const leaves = this.familyMembersWithPoints();
    const list = colors.flat();
    leaves.forEach((m, i) => {
      const x = leaves.length > 1 ? (i / (leaves.length - 1)) * (list.length - 1) : 0;
      const k = Math.min(Math.floor(x), Math.max(list.length - 2, 0));
      const c = list.length > 1 ? lerpColor(list[k], list[k + 1], x - k) : toHex(list[0]);
      m.fillColor = c;
      m.strokeColor = c;
    });
    return this;
  }

  public matchStyle(other: Mobject): this {
    const src = other.familyMembersWithPoints()[0] ?? other;
    for (const m of this.getFamily()) Mobject.prototype._copyData.call(m, src);
    return this;
  }

  public getColor(): string {
    const leaf = this.hasPoints() ? this : (this.familyMembersWithPoints()[0] ?? this);
    return leaf.strokeOpacity > 0 && leaf.strokeWidth > 0 ? leaf.strokeColor : leaf.fillColor;
  }
  public get color(): string {
    return this.getColor();
  }
  public set color(value: any) {
    this.setColor(value);
  }

  // ---------------------------------------------------------------- state

  public saveState(): this {
    this.savedState = this.copy();
    return this;
  }

  public restore(): this {
    if (this.savedState) this.become(this.savedState);
    return this;
  }

  public generateTarget(): Mobject {
    this.target = this.copy();
    return this.target;
  }

  /** Take on the geometry and style of `other`. */
  public become(other: Mobject): this {
    const mine = this.getFamily();
    const theirs = other.getFamily();
    const sameShape =
      mine.length === theirs.length &&
      mine.every((m, i) => m._kind() === theirs[i]._kind());
    if (sameShape) {
      mine.forEach((m, i) => m._copyData(theirs[i]));
    } else {
      const copy = other.copy();
      for (const s of [...this.submobjects]) this.remove(s);
      this._copyData(copy);
      this.add(...copy.submobjects.map(s => ((s.parents = []), s)));
      this._familyChanged();
    }
    return this;
  }

  public _kind(): string {
    return 'group';
  }

  /** Set by the scene so structural changes trigger a node re-sync. */
  public _familyChanged(): void {
    Mobject.onFamilyChanged?.();
  }
  public static onFamilyChanged?: () => void;

  /** Blend two mobjects with identical family structure into this one. */
  public interpolate(a: Mobject, b: Mobject, t: number): this {
    const mine = this.getFamily();
    const fa = a.getFamily();
    const fb = b.getFamily();
    for (let i = 0; i < mine.length; i++) {
      if (fa[i] && fb[i]) mine[i]._lerp(fa[i], fb[i], t);
    }
    return this;
  }

  /** Make both families the same shape (submobject counts and point counts). */
  public alignData(other: Mobject): void {
    alignFamilies(this, other);
  }

  // ------------------------------------------------------------- updaters

  public addUpdater(fn: Updater, ...rest: any[]): this {
    const o = kw(rest, ['index', 'callUpdater'], {callUpdater: false});
    if (o.index === undefined) this.updaters.push(fn);
    else this.updaters.splice(o.index, 0, fn);
    if (o.callUpdater) fn(this, 0);
    return this;
  }
  public removeUpdater(fn: Updater): this {
    this.updaters = this.updaters.filter(u => u !== fn);
    return this;
  }
  public clearUpdaters(): this {
    for (const m of this.getFamily()) m.updaters = [];
    return this;
  }
  public suspendUpdating(): this {
    for (const m of this.getFamily()) m.updatingSuspended = true;
    return this;
  }
  public resumeUpdating(): this {
    for (const m of this.getFamily()) m.updatingSuspended = false;
    return this;
  }
  public update(dt = 0): this {
    if (this.updatingSuspended) return this;
    for (const u of [...this.updaters]) u(this, dt);
    for (const s of [...this.submobjects]) s.update(dt);
    return this;
  }
  public hasUpdaters(): boolean {
    return this.getFamily().some(m => m.updaters.length > 0);
  }

  public toString(): string {
    return this.name;
  }
}

/** Numeric indexing (`group[0]`) without paying for a Proxy on every access. */
for (let i = 0; i < 256; i++) {
  Object.defineProperty(Mobject.prototype, i, {
    get(this: Mobject) {
      return this.submobjects[i];
    },
    configurable: true,
  });
}

/** Python's `group[-1]`. */
for (let i = 1; i <= 16; i++) {
  Object.defineProperty(Mobject.prototype, String(-i), {
    get(this: Mobject) {
      return this.submobjects[this.submobjects.length - i];
    },
    configurable: true,
  });
}

export interface VMobject {
  [index: number]: Mobject;
}
export interface Mobject {
  [index: number]: Mobject;
}

export class VMobject extends Mobject {
  public points: Points = [];
  public jointType: CanvasLineJoin = 'miter';
  public capStyle: CanvasLineCap = 'butt';
  public dash: number[] | null = null;
  private pathCache: {points: Points; unit: number; path: Path2D} | null = null;

  public constructor(...args: any[]) {
    const [, o] = splitKw(args);
    super(o);
    this.initStyle(o);
    if (o.jointType) this.jointType = o.jointType;
    if (o.capStyle) this.capStyle = o.capStyle;
  }

  public override hasPoints(): boolean {
    return this.points.length > 0;
  }
  public override _kind(): string {
    return 'vmobject';
  }

  // ------------------------------------------------------------ building

  public setPoints(points: Points): this {
    this.points = points;
    return this;
  }
  public clearPoints(): this {
    this.points = [];
    return this;
  }
  public setPointsAsCorners(corners: Vec[]): this {
    this.points = cornersToPoints(corners);
    return this;
  }
  public startNewPath(point: Vec): this {
    (this as any)._pen = point;
    (this as any)._pathStart = point;
    return this;
  }
  public addLineTo(point: Vec): this {
    const pen = this.penPoint();
    this.points = [...this.points, ...lineToCubic(pen, point)];
    (this as any)._pen = point;
    return this;
  }
  public addCubicBezierCurveTo(h1: Vec, h2: Vec, anchor: Vec): this {
    const pen = this.penPoint();
    this.points = [...this.points, pen, h1, h2, anchor];
    (this as any)._pen = anchor;
    return this;
  }
  public addPointsAsCorners(corners: Vec[]): this {
    for (const c of corners) this.addLineTo(c);
    return this;
  }
  public closePath(): this {
    const start = (this as any)._pathStart ?? this.points[0];
    const pen = this.penPoint();
    if (start && !eq(start, pen)) this.addLineTo(start);
    return this;
  }
  private penPoint(): Vec {
    return (this as any)._pen ?? this.points[this.points.length - 1] ?? [0, 0, 0];
  }

  /** Smooth curve through the given points (Manim's `set_points_smoothly`). */
  public setPointsSmoothly(corners: Vec[]): this {
    this.points = smoothPoints(corners.map(p => [p[0], p[1], 0]));
    return this;
  }
  public makeSmooth(): this {
    for (const m of this.familyMembersWithPoints()) {
      if (m instanceof VMobject) m.points = changeAnchorMode(m.points, 'smooth');
    }
    return this;
  }
  public makeJagged(): this {
    for (const m of this.familyMembersWithPoints()) {
      if (m instanceof VMobject) m.points = changeAnchorMode(m.points, 'jagged');
    }
    return this;
  }
  public changeAnchorMode(mode: 'smooth' | 'jagged'): this {
    return mode === 'smooth' ? this.makeSmooth() : this.makeJagged();
  }
  /** Subdivide so the outline has `n` more curves (same shape). */
  public insertNCurves(n: number): this {
    this.points = insertCurves(this.points, n);
    return this;
  }
  public appendPoints(points: Points): this {
    this.points = [...this.points, ...points];
    return this;
  }
  public getPoints(): Points {
    return this.points;
  }
  public getLastPoint(): Vec {
    return this.points[this.points.length - 1];
  }
  public getStartAndEnd(): [Vec, Vec] {
    return [this.getStart(), this.getEnd()];
  }
  public getSubpaths(): Points[] {
    return splitSubpaths(this.points);
  }
  public getArcLength(): number {
    return curveLengths(this.points).total;
  }

  /** Scale and rotate about the start so the outline runs from `start` to `end`. */
  public putStartAndEndOn(start: Vec, end: Vec): this {
    const s0 = this.getStart();
    const e0 = this.getEnd();
    const cur = sub(e0, s0);
    const target = sub(end, start);
    const curLen = Math.hypot(cur[0], cur[1]);
    if (curLen < 1e-9) return this.shift(sub(start, s0));
    this.scale(Math.hypot(target[0], target[1]) / curLen, {aboutPoint: s0});
    this.rotate(Math.atan2(target[1], target[0]) - Math.atan2(cur[1], cur[0]), {aboutPoint: s0});
    return this.shift(sub(start, s0));
  }

  public getNumCurves(): number {
    return this.points.length / 4;
  }
  public getStart(): Vec {
    return this.points[0] ?? this.getCenter();
  }
  public getEnd(): Vec {
    return this.points[this.points.length - 1] ?? this.getCenter();
  }
  public getAnchors(): Vec[] {
    const out: Vec[] = [];
    for (let i = 0; i < this.points.length; i += 4) out.push(this.points[i], this.points[i + 3]);
    return out;
  }
  public getVertices(): Vec[] {
    const out: Vec[] = [];
    for (let i = 0; i < this.points.length; i += 4) out.push(this.points[i]);
    return out;
  }
  public pointFromProportion(alpha: number): Vec {
    return pointAtProportion(this.points, alpha) ?? this.getCenter();
  }
  public pointwiseBecomePartial(other: VMobject, a: number, b: number): this {
    this.points = partialPoints(other.points, a, b);
    return this;
  }
  public reversePoints(): this {
    this.points = [...this.points].reverse();
    return this;
  }

  // ---------------------------------------------------------- leaf hooks

  public override _ownBounds(): Bounds | null {
    const pts = this.points;
    if (pts.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }

  public override _affine(op: AffineOp): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const out: Points = new Array(pts.length);
    if (op.type === 'shift') {
      const [dx, dy] = op.v;
      for (let i = 0; i < pts.length; i++) out[i] = [pts[i][0] + dx, pts[i][1] + dy, 0];
    } else if (op.type === 'scale') {
      const [ax, ay] = op.about;
      for (let i = 0; i < pts.length; i++) {
        out[i] = [ax + (pts[i][0] - ax) * op.fx, ay + (pts[i][1] - ay) * op.fy, 0];
      }
    } else {
      const c = Math.cos(op.angle);
      const s = Math.sin(op.angle);
      const [ax, ay] = op.about;
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0] - ax;
        const y = pts[i][1] - ay;
        out[i] = [ax + x * c - y * s, ay + x * s + y * c, 0];
      }
    }
    this.points = out;
    const self = this as any;
    if (self._pen) self._pen = undefined;
  }

  public override _applyFunction(fn: (p: Vec) => Vec): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const out: Points = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = fn(pts[i]);
      out[i] = [p[0], p[1], 0];
    }
    this.points = out;
  }

  public override _copyData(from: Mobject): void {
    super._copyData(from);
    if (from instanceof VMobject) {
      this.points = from.points;
      this.jointType = from.jointType;
      this.capStyle = from.capStyle;
      this.dash = from.dash;
    }
  }

  public override _lerp(a: Mobject, b: Mobject, t: number): void {
    super._lerp(a, b, t);
    if (a instanceof VMobject && b instanceof VMobject) {
      if (a.points.length === b.points.length) {
        this.points = t <= 0 ? a.points : t >= 1 ? b.points : lerpPoints(a.points, b.points, t);
      } else {
        this.points = t < 0.5 ? a.points : b.points;
      }
    }
  }

  public override _alignLeaf(other: Mobject): void {
    if (!(other instanceof VMobject)) return;
    const [a, b] = alignPoints(this.points, other.points);
    this.points = a;
    other.points = b;
  }

  public override _draw(ctx: CanvasRenderingContext2D, u: number): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const fill = this.fillOpacity > 0.001;
    const stroke = this.strokeOpacity > 0.001 && this.strokeWidth > 0.001;
    if (!fill && !stroke) return;
    let cache = this.pathCache;
    if (!cache || cache.points !== pts || cache.unit !== u) {
      const path = new Path2D();
      for (const sub of splitSubpaths(pts)) {
        path.moveTo(sub[0][0] * u, -sub[0][1] * u);
        for (let i = 0; i < sub.length; i += 4) {
          path.bezierCurveTo(
            sub[i + 1][0] * u,
            -sub[i + 1][1] * u,
            sub[i + 2][0] * u,
            -sub[i + 2][1] * u,
            sub[i + 3][0] * u,
            -sub[i + 3][1] * u,
          );
        }
        if (sub.length > 4 && eq(sub[0], sub[sub.length - 1], 1e-5)) path.closePath();
      }
      cache = this.pathCache = {points: pts, unit: u, path};
    }
    if (fill) {
      ctx.fillStyle = rgba(this.fillColor, this.fillOpacity);
      ctx.fill(cache.path, 'evenodd');
    }
    if (stroke) {
      ctx.strokeStyle = rgba(this.strokeColor, this.strokeOpacity);
      ctx.lineWidth = this.strokeWidth * 0.01 * u;
      ctx.lineJoin = this.jointType;
      ctx.lineCap = this.capStyle;
      if (this.dash) ctx.setLineDash(this.dash.map(d => d * u));
      ctx.stroke(cache.path);
      if (this.dash) ctx.setLineDash([]);
    }
  }

  /** Hit test in Manim coordinates, used by the editor's click-to-select. */
  public _containsPoint(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): boolean {
    const path = this.pathCache?.path;
    if (!path) return false;
    if (this.fillOpacity > 0.001 && ctx.isPointInPath(path, x * u, -y * u, 'evenodd')) return true;
    ctx.lineWidth = Math.max(this.strokeWidth * 0.01 * u, 12);
    return ctx.isPointInStroke(path, x * u, -y * u);
  }
}

export class VGroup extends VMobject {
  public constructor(...mobs: any[]) {
    const [list, o] = splitKw(mobs);
    super(o);
    this.add(...list.flat());
  }
  public override _kind(): string {
    return 'group';
  }
}

export class Group extends VGroup {}

/** A zero-size stand-in used when two families need padding to match. */
function nullLike(m: Mobject): Mobject {
  const c = m.copy();
  const center = m.getCenter();
  for (const f of c.getFamily()) {
    f._affine({type: 'scale', fx: 0, fy: 0, about: center});
    f.fillOpacity = 0;
    f.strokeOpacity = 0;
  }
  return c;
}

export function alignFamilies(a: Mobject, b: Mobject): void {
  // A leaf paired with a group: wrap the leaf's geometry into a submobject so
  // both sides are groups of leaves.
  const aLeaf = a.hasPoints() && a.submobjects.length === 0;
  const bLeaf = b.hasPoints() && b.submobjects.length === 0;
  if (a.submobjects.length !== b.submobjects.length) {
    if (a.submobjects.length === 0 && aLeaf) pushSelfDown(a);
    if (b.submobjects.length === 0 && bLeaf) pushSelfDown(b);
    const na = a.submobjects.length;
    const nb = b.submobjects.length;
    if (na < nb) padSubmobjects(a, nb, b);
    else if (nb < na) padSubmobjects(b, na, a);
  }
  if (a.hasPoints() || b.hasPoints()) {
    if (a._kind() === b._kind()) a._alignLeaf(b);
  }
  for (let i = 0; i < a.submobjects.length; i++) {
    alignFamilies(a.submobjects[i], b.submobjects[i]);
  }
}

function pushSelfDown(m: Mobject) {
  const child = m.copy();
  child.submobjects = [];
  if (m instanceof VMobject) m.points = [];
  (m as any)._pushedDown = true;
  m.submobjects = [child];
  child.parents = [m];
  m._familyChanged();
}

function padSubmobjects(m: Mobject, n: number, reference: Mobject) {
  const have = m.submobjects.length;
  if (have === 0) {
    // Nothing to duplicate: fade in from the group's centre.
    for (let i = 0; i < n; i++) {
      const ghost = nullLike(reference.submobjects[i]);
      ghost.moveTo(m.getCenter());
      m.add(ghost);
    }
  } else {
    // Repeat existing submobjects evenly, as Manim does.
    const out: Mobject[] = [];
    for (let i = 0; i < n; i++) {
      const src = m.submobjects[Math.floor((i * have) / n)];
      const first = Math.floor((i * have) / n) !== Math.floor(((i - 1) * have) / n) || i === 0;
      if (first) out.push(src);
      else {
        const dup = src.copy();
        for (const f of dup.getFamily()) (f as any)._ghost = true;
        out.push(dup);
      }
    }
    m.submobjects = out;
    for (const s of out) if (!s.parents.includes(m)) s.parents.push(m);
  }
  m._familyChanged();
}

for (const klass of [Mobject, VMobject]) aliasSnake(klass.prototype);

/** snake_case accessors for the style fields. */
for (const field of ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth', 'zIndex', 'savedState']) {
  const alias = field.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  Object.defineProperty(Mobject.prototype, alias, {
    get(this: any) {
      return this[field];
    },
    set(this: any, v: any) {
      this[field] = v;
    },
    configurable: true,
  });
}
