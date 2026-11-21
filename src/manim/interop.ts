/**
 * The bridge between the two authoring styles.
 *
 * - `NodeMobject` wraps a Canvas Commons node as a leaf mobject, so a native
 *   node can be grouped, arranged and animated like any other mobject.
 *   `toMobject` (exported to scenes as `wrap`) does the wrapping, and the
 *   Manim layer calls it wherever it is handed a node.
 * - `MobjectHost` is a Canvas Commons node that draws a mobject, so a mobject
 *   can be a child of a native node. `Node.prototype.parseChildren` and
 *   `insert` are patched to create one wherever a mobject is passed as a child.
 *
 * Coordinates: a mobject lives in Manim space (units, y up). The local space
 * of the scene's root node and of every `MobjectHost` is that space in pixels
 * (`config.unit` per unit, y down).
 */
import * as cc2d from '@canvas-commons/2d';
import {Node, View2D} from '@canvas-commons/2d';
import {BBox, useScene, Vector2} from '@canvas-commons/core';
import {config, WHITE} from './constants';
import {
  applyInverse,
  applyMatrix,
  differs,
  reconcile,
  similarity,
  Similarity,
  SyncAction,
  toDegrees,
  toRadians,
} from './interop_math';
import {AffineOp, Bounds, MobNode, Mobject} from './mobject';
import {aliasSnake, callerLine, hooks, lerpColor, sceneFrameMarker, toHex} from './util';
import {rotate, Vec} from './vec';

export {px, to_pixels, to_units, units} from './interop_math';

// ------------------------------------------------------------- registries

const wrappers = new WeakMap<Node, NodeMobject>();
const hosts = new WeakMap<Mobject, MobjectHost>();
/** Wrapped nodes and hosts of one scene run. A run has its own view, so these empty themselves. */
const liveByView = new WeakMap<View2D, NodeMobject[]>();
const hostsByView = new WeakMap<View2D, MobjectHost[]>();
/** The root node of the Manim scene attached to a view, if any. */
const rootByView = new WeakMap<View2D, Node>();
const manimRoots = new WeakSet<Node>();
const renderSynced = new WeakSet<View2D>();

/** Canvas Commons' classes by constructor: a production build minifies class names, export names survive. */
const classNames = new Map<unknown, string>(
  Object.entries(cc2d)
    .filter(([name, value]) => typeof value === 'function' && /^[A-Z]/.test(name))
    .map(([name, value]) => [value, name]),
);

function nodeClassName(node: Node): string {
  for (let proto = Object.getPrototypeOf(node); proto; proto = Object.getPrototypeOf(proto)) {
    const known = classNames.get(proto.constructor);
    if (known) return known;
  }
  return 'Node';
}

/** Whether the local space of `node` is Manim space in pixels. */
const isManimSpace = (node: Node): boolean => manimRoots.has(node) || node instanceof MobjectHost;

/** Called by `Scene` when it puts its root node into a view. */
export function registerRoot(view: View2D, root: Node): void {
  rootByView.set(view, root);
  manimRoots.add(root);
  ensureRenderSync(view);
}

/**
 * Bring wrapped nodes and their mobjects in line right before each render, so
 * a change made from either side shows even when no `play` is running.
 * Canvas Commons drops these subscriptions when the scene resets.
 */
function ensureRenderSync(view: View2D): void {
  if (renderSynced.has(view)) return;
  let scene: any;
  try {
    scene = useScene();
  } catch {
    return;
  }
  renderSynced.add(view);
  scene.lifecycleEvents?.onBeforeRender.subscribe(() => {
    if (scene.getView?.() !== view) return;
    const manim = scene.manim;
    if (manim && manim.view === view) manim._renderSync();
    else syncView(view);
  });
}

/**
 * Reconcile every wrapped node of a view with its mobject and let hosts adopt
 * the wrapped nodes of their families. Returns whether the view has hosts.
 */
export function syncView(view: View2D): boolean {
  const live = liveByView.get(view);
  if (live) for (let i = 0; i < live.length; i++) live[i]._sync();
  const list = hostsByView.get(view);
  if (!list || list.length === 0) return false;
  for (let i = 0; i < list.length; i++) list[i]._adopt();
  return true;
}

// ------------------------------------------------------------ NodeMobject

type Paint = 'fill' | 'stroke' | null;

/** A solid, opaque colour of a fill/stroke signal as hex. */
function solidHex(value: any): string | undefined {
  if (!value || typeof value.hex !== 'function') return undefined;
  if (typeof value.alpha === 'function' && value.alpha() < 1) return undefined;
  return toHex(String(value.hex()));
}

/**
 * A Canvas Commons node as a leaf mobject.
 *
 * The mobject keeps the node's placement in Manim terms (`pos`, `sx`, `sy`,
 * `rot`) and its opacity in `fillOpacity`, and both sides stay drivable:
 * `_sync` copies whichever side changed since the last call to the other (see
 * `reconcile` in `interop_math.ts`). Copies, which animations make all the
 * time, carry the state only; a copy gets a node of its own (a clone) when it
 * is put on screen.
 */
export class NodeMobject extends Mobject {
  /** Position of the node's origin, in Manim units. */
  public pos: Vec = [0, 0, 0];
  public sx = 1;
  public sy = 1;
  /** Rotation in radians, counter-clockwise. */
  public rot = 0;
  /** The node's local bounding box in pixels (y down): x, y, width, height. */
  public box: [number, number, number, number] = [0, 0, 0, 0];
  /** The node a copy clones when it needs one. */
  public _source?: Node;

  // What the mobject held and what the node held after the last `_sync`.
  private lx = 0;
  private ly = 0;
  private lsx = 1;
  private lsy = 1;
  private lrot = 0;
  private lop = 1;
  private lfill = WHITE;
  private nx = 0;
  private ny = 0;
  private nsx = 1;
  private nsy = 1;
  private nrot = 0;
  private nop = 1;
  private nodeParent: Node | null = null;
  /** Take everything from the node (first sync, or the node was reparented natively). */
  private pullAll = true;
  /** Give everything to the node (it was just cloned, or the scene moved it under its root). */
  private pushAll = false;
  private paint: Paint = null;
  /** The node's paint at the last sync, and the paint that `originalHex` stands for. */
  private npaint: unknown = null;
  private originalPaint: unknown = null;
  private originalHex = WHITE;
  private matrixKey: [unknown, unknown, Similarity] | null = null;

  public constructor(node: Node, opts: Record<string, any> = {}) {
    super({name: nodeClassName(node), ...opts});
    this.fillOpacity = 1;
    this.strokeWidth = 0;
    this.node = node;
    this._source = node;
    const created = sceneFrameMarker().exec((node as any).creationStack ?? '');
    this.sourceLine = created ? parseInt(created[1], 10) : callerLine();
    this.readPaint(node);
    this.goLive(node);
    this._sync();
  }

  public override hasPoints(): boolean {
    return true;
  }
  public override _kind(): string {
    return 'node';
  }
  public override _fillsByDefault(): boolean {
    return true;
  }

  /** The native node. A copy that has none yet gets its clone here. */
  public unwrap(): Node {
    if (!this.node) {
      if (!this._source) throw new Error(`${this.name}: this wrapped node has no native node to clone.`);
      const node = (this.node = this._source.clone());
      this.pushAll = true;
      this.pullAll = false;
      this.nodeParent = null;
      this.goLive(node);
      this._sync();
    }
    return this.node;
  }

  private goLive(node: Node): void {
    const view = node.view();
    let live = liveByView.get(view);
    if (!live) liveByView.set(view, (live = []));
    live.push(this);
    ensureRenderSync(view);
  }

  /** Which paint `set_color` changes: the fill if the node has one, else its stroke. */
  private readPaint(node: Node): void {
    const n = node as any;
    const fill = typeof n.fill === 'function' ? n.fill() : undefined;
    const stroke = typeof n.stroke === 'function' ? n.stroke() : undefined;
    this.paint = fill ? 'fill' : stroke ? 'stroke' : typeof n.fill === 'function' ? 'fill' : null;
    if (!this.paint) return;
    this.npaint = this.originalPaint = this.paint === 'fill' ? fill : stroke;
    this.fillColor = this.strokeColor = solidHex(this.npaint) ?? WHITE;
    this.originalHex = this.lfill = this.fillColor;
  }

  // ------------------------------------------------------------ two-way sync

  /**
   * Parent space (pixels) → Manim space (pixels), or `null` when they are the
   * same. Only a node that lives inside a native container needs one.
   */
  private matrixFor(node: Node, parent: Node | null): Similarity | null {
    if (!parent || isManimSpace(parent)) return null;
    const view = node.view();
    const base: Node = rootByView.get(view) ?? view;
    if (parent === base) return null;
    const toBase = base.worldToLocal();
    const toWorld = parent.localToWorld();
    const key = this.matrixKey;
    if (key && key[0] === toBase && key[1] === toWorld) return key[2];
    const m = similarity(toBase.multiply(toWorld));
    this.matrixKey = [toBase, toWorld, m];
    return m;
  }

  /**
   * Reconcile the mobject with its node, value by value: what the native side
   * changed since the last call is pulled into the mobject, what the Manim
   * side changed is pushed to the node. Cheap when nothing changed.
   */
  public _sync(): void {
    const node = this.node;
    if (!node) return;
    const {pullAll, pushAll} = this;
    try {
      this.reconcile(node);
    } catch {
      // Outside a scene context (the editor inspecting) or a disposed node:
      // keep the last known state and try again next time.
      this.pullAll = pullAll;
      this.pushAll = pushAll;
    }
  }

  private reconcile(node: Node): void {
    const parent = node.parent();
    let pullAll = this.pullAll;
    const pushAll = this.pushAll;
    if (parent !== this.nodeParent) {
      // Moved by the scene (`pushAll`): the mobject says where it is. Moved
      // natively: the node does.
      if (!pushAll) pullAll = true;
      this.nodeParent = parent;
    }
    this.pullAll = this.pushAll = false;
    const m = this.matrixFor(node, parent);
    const derived = m !== null;
    const u = config.unit;

    // Position.
    let nx = node.x();
    let ny = node.y();
    let action: SyncAction = pushAll
      ? 'push'
      : reconcile(
          pullAll || differs(nx, this.nx) || differs(ny, this.ny),
          differs(this.pos[0], this.lx) || differs(this.pos[1], this.ly),
          derived,
        );
    if (action === 'push') {
      let x = this.pos[0] * u;
      let y = -this.pos[1] * u;
      if (m) [x, y] = applyInverse(m, x, y);
      node.x(x);
      node.y(y);
      // Read back: a node placed by a layout does not take a position.
      nx = node.x();
      ny = node.y();
    } else if (action === 'pull') {
      let x = nx;
      let y = ny;
      if (m) [x, y] = applyMatrix(m, x, y);
      if (differs(x / u, this.pos[0]) || differs(-y / u, this.pos[1])) this.pos = [x / u, -y / u, 0];
    }
    this.nx = nx;
    this.ny = ny;
    this.lx = this.pos[0];
    this.ly = this.pos[1];

    // Scale.
    const k = m ? m.scale : 1;
    let nsx = node.scale.x();
    let nsy = node.scale.y();
    action = pushAll
      ? 'push'
      : reconcile(
          pullAll || differs(nsx, this.nsx) || differs(nsy, this.nsy),
          differs(this.sx, this.lsx) || differs(this.sy, this.lsy),
          derived,
        );
    if (action === 'push') {
      node.scale.x(this.sx / k);
      node.scale.y(this.sy / k);
      nsx = node.scale.x();
      nsy = node.scale.y();
    } else if (action === 'pull') {
      this.sx = nsx * k;
      this.sy = nsy * k;
    }
    this.nsx = nsx;
    this.nsy = nsy;
    this.lsx = this.sx;
    this.lsy = this.sy;

    // Rotation.
    const turn = m ? m.rotation : 0;
    let nrot = node.rotation();
    action = pushAll ? 'push' : reconcile(pullAll || differs(nrot, this.nrot), differs(this.rot, this.lrot), derived);
    if (action === 'push') {
      node.rotation(toDegrees(this.rot) - turn);
      nrot = node.rotation();
    } else if (action === 'pull') {
      this.rot = toRadians(nrot + turn);
    }
    this.nrot = nrot;
    this.lrot = this.rot;

    // Opacity is the node's own, whatever its parents'.
    let nop = node.opacity();
    action = pushAll ? 'push' : reconcile(pullAll || differs(nop, this.nop), differs(this.fillOpacity, this.lop));
    if (action === 'push') {
      node.opacity(Math.min(1, Math.max(0, this.fillOpacity)));
      nop = node.opacity();
    } else if (action === 'pull') {
      this.fillOpacity = nop;
    }
    this.nop = nop;
    this.lop = this.fillOpacity;

    // Colour. A paint that is not a plain colour (a gradient, say) reads as
    // white, and only an explicit change on the mobject replaces it.
    if (this.paint) {
      const signal = (node as any)[this.paint];
      const value = signal();
      if (!pushAll && value !== this.npaint) {
        this.originalPaint = value;
        this.originalHex = this.lfill = this.fillColor = this.strokeColor = solidHex(value) ?? WHITE;
        this.npaint = value;
      } else if (this.fillColor !== this.lfill) {
        signal(this.fillColor === this.originalHex ? this.originalPaint : this.fillColor);
        this.lfill = this.fillColor;
        this.npaint = signal();
      } else {
        this.npaint = value;
      }
    }

    // The bounding box needs the scene context, so it is snapshotted here.
    const b = node.cacheBBox();
    const box = this.box;
    if (b.x !== box[0] || b.y !== box[1] || b.width !== box[2] || b.height !== box[3]) {
      this.box = [b.x, b.y, b.width, b.height];
    }
  }

  // -------------------------------------------------------------- leaf hooks

  public override _makeNode(scene: {root: Node; view: Node; displayDirty?: boolean}): Node | null {
    const node = this.unwrap();
    const parent = node.parent();
    // Inside a native container (or a host): it is drawn there, not by the scene.
    if (parent && parent !== scene.root && parent !== scene.view) return null;
    if (parent !== scene.root) {
      // The scene is about to take it under its root, where the mobject's
      // state is the truth.
      this.pushAll = true;
      scene.displayDirty = true;
    }
    return node;
  }

  public override _ownBounds(): Bounds {
    this._sync();
    const u = config.unit;
    const [bx, by, bw, bh] = this.box;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const xa = (bx / u) * this.sx;
    const xb = ((bx + bw) / u) * this.sx;
    const ya = (-by / u) * this.sy;
    const yb = (-(by + bh) / u) * this.sy;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const lx = i & 1 ? xb : xa;
      const ly = i & 2 ? yb : ya;
      const x = lx * c - ly * s;
      const y = lx * s + ly * c;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return [x0 + this.pos[0], y0 + this.pos[1], x1 + this.pos[0], y1 + this.pos[1]];
  }

  public override _affine(op: AffineOp): void {
    this._sync();
    if (op.type === 'shift') {
      this.pos = [this.pos[0] + op.v[0], this.pos[1] + op.v[1], 0];
    } else if (op.type === 'scale') {
      this.pos = [
        op.about[0] + (this.pos[0] - op.about[0]) * op.fx,
        op.about[1] + (this.pos[1] - op.about[1]) * op.fy,
        0,
      ];
      if (op.fx === op.fy) {
        this.sx *= op.fx;
        this.sy *= op.fy;
      } else {
        // A stretch along the frame's axes shears a rotated node, which a
        // node cannot express: keep the closest rotation and scale.
        const c = Math.cos(this.rot);
        const s = Math.sin(this.rot);
        const kx = Math.hypot(op.fx * c, op.fy * s);
        const ky = Math.hypot(op.fx * s, op.fy * c);
        if (kx > 0) this.rot = Math.atan2(op.fy * s, op.fx * c);
        this.sx *= kx;
        this.sy *= ky * (op.fx * op.fy < 0 ? -1 : 1);
      }
    } else {
      this.pos = rotate(this.pos, op.angle, op.about);
      this.rot += op.angle;
    }
    this._sync();
  }

  public override _applyFunction(fn: (p: Vec) => Vec): void {
    this._sync();
    const p = fn(this.pos);
    this.pos = [p[0], p[1], 0];
    this._sync();
  }

  public override _copyData(from: Mobject): void {
    this._sync();
    super._copyData(from);
    if (from instanceof NodeMobject) {
      from._sync();
      this.pos = from.pos;
      this.sx = from.sx;
      this.sy = from.sy;
      this.rot = from.rot;
      if (!this.node) {
        this.box = from.box;
        this._source = from.node ?? from._source;
      }
    }
    this._sync();
  }

  /**
   * Only what differs between `a` and `b` is written, so an animation that
   * moves a node leaves, say, its opacity to a native tween.
   */
  public override _lerp(a: Mobject, b: Mobject, t: number): void {
    this._sync();
    if (a instanceof NodeMobject && b instanceof NodeMobject) {
      const mix = (x: number, y: number) => x + (y - x) * t;
      if (a.pos !== b.pos && (a.pos[0] !== b.pos[0] || a.pos[1] !== b.pos[1])) {
        this.pos = [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), 0];
      }
      // Sizes are compared on screen, so a node morphs towards the size of
      // another node, not just towards its scale factor.
      const [, , w, h] = this.box;
      const aw = a.sx * a.box[2];
      const bw = b.sx * b.box[2];
      const ah = a.sy * a.box[3];
      const bh = b.sy * b.box[3];
      if (aw !== bw) this.sx = w > 0 ? mix(aw, bw) / w : mix(a.sx, b.sx);
      if (ah !== bh) this.sy = h > 0 ? mix(ah, bh) / h : mix(a.sy, b.sy);
      if (a.rot !== b.rot) this.rot = mix(a.rot, b.rot);
      if (a.fillOpacity !== b.fillOpacity) this.fillOpacity = mix(a.fillOpacity, b.fillOpacity);
      if (a.fillColor !== b.fillColor) this.fillColor = this.strokeColor = lerpColor(a.fillColor, b.fillColor, t);
    } else {
      // Towards a mobject of another kind there is nothing to morph into:
      // travel to where it is.
      const from = a.getCenter();
      const to = b.getCenter();
      const here = this.getCenter();
      this.pos = [
        this.pos[0] + from[0] + (to[0] - from[0]) * t - here[0],
        this.pos[1] + from[1] + (to[1] - from[1]) * t - here[1],
        0,
      ];
    }
    this._sync();
  }

  /** Copies are made field by field from a live original: catch up with its node first. */
  public _onCopy(original: NodeMobject): void {
    original._sync();
    this.pos = original.pos;
    this.sx = original.sx;
    this.sy = original.sy;
    this.rot = original.rot;
    this.box = original.box;
    this.fillOpacity = original.fillOpacity;
    this._source = original.node ?? original._source;
    this.matrixKey = null;
  }
}
aliasSnake(NodeMobject.prototype);

// ------------------------------------------------------------- MobjectHost

/**
 * A Canvas Commons node that draws a mobject and its family. Its local space
 * is Manim space: the mobject's `[0, 0, 0]` is the host's origin, one unit is
 * `config.unit` pixels and y points up.
 */
export class MobjectHost extends Node {
  public readonly mobject: Mobject;
  private adopted: Node[] = [];

  public constructor(mobject: Mobject) {
    super({});
    this.mobject = mobject;
    hosts.set(mobject, this);
    const view = this.view();
    let list = hostsByView.get(view);
    if (!list) hostsByView.set(view, (list = []));
    list.push(this);
    ensureRenderSync(view);
    this._adopt();
  }

  /** A clone of the host (its parent was cloned) draws a copy of the mobject. */
  public override instantiate(): this {
    return new MobjectHost(this.mobject.copy()) as this;
  }

  /** Wrapped native nodes in the hosted family are drawn as real children. */
  public _adopt(): void {
    let nodes: Node[] | null = null;
    for (const m of this.mobject.getFamily()) {
      if (m instanceof NodeMobject) (nodes ??= []).push(m.unwrap());
    }
    const prev = this.adopted;
    if (!nodes) {
      if (prev.length === 0) return;
      nodes = [];
    } else if (nodes.length === prev.length && nodes.every((n, i) => n === prev[i])) {
      return;
    }
    this.adopted = nodes;
    this.children(nodes);
  }

  /**
   * Mobjects are plain objects, not signals: reading the clock makes a cache
   * that contains this node (a faded or filtered parent) refresh every frame.
   */
  private touch(): void {
    this.view().globalTime();
  }

  protected override draw(context: CanvasRenderingContext2D): void {
    this.touch();
    const u = config.unit;
    const family = this.mobject.getFamily();
    let leaves = family;
    if (family.some(m => m.zIndex !== 0)) {
      leaves = family
        .map((m, i) => [m, i] as const)
        .sort((a, b) => a[0].zIndex - b[0].zIndex || a[1] - b[1])
        .map(([m]) => m);
    }
    for (const m of leaves) {
      if (!m.hasPoints()) continue;
      if (m instanceof NodeMobject) {
        if (m.node && this.adopted.includes(m.node)) m.node.render(context);
      } else {
        m._draw(context, u);
      }
    }
  }

  protected override getCacheBBox(): BBox {
    this.touch();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let stroke = 0;
    for (const m of this.mobject.getFamily()) {
      const b = m._ownBounds();
      if (!b) continue;
      if (b[0] < x0) x0 = b[0];
      if (b[1] < y0) y0 = b[1];
      if (b[2] > x1) x1 = b[2];
      if (b[3] > y1) y1 = b[3];
      if (m.strokeWidth > stroke) stroke = m.strokeWidth;
    }
    if (x0 > x1) return new BBox();
    const u = config.unit;
    const pad = stroke * 0.01 * u + 2;
    return new BBox(x0 * u - pad, -y1 * u - pad, (x1 - x0) * u + pad * 2, (y1 - y0) * u + pad * 2);
  }

  public override hit(position: Vector2): Node | null {
    const child = super.hit(position);
    if (child) return child;
    const local = position.transformAsPoint(this.localToParent().inverse());
    return this.getCacheBBox().includes(local) ? this : null;
  }
}

// ----------------------------------------------------------- conversions

/**
 * The mobject for a value: a Canvas Commons node comes back as the mobject
 * that wraps it (always the same one for the same node), a `MobjectHost` as
 * the mobject it hosts, and anything else unchanged.
 */
export function toMobject(x: any): any {
  if (!(x instanceof Node)) return x;
  if (x instanceof MobjectHost) return x.mobject;
  if (x instanceof MobNode) return x.mob;
  let m = wrappers.get(x);
  if (!m) wrappers.set(x, (m = new NodeMobject(x)));
  return m;
}
hooks.toMobject = toMobject;

/**
 * The Canvas Commons node for a value: a wrapped node comes back as itself,
 * any other mobject as the `MobjectHost` that draws it (always the same one
 * for the same mobject), and anything else unchanged.
 */
export function toNode(x: any): any {
  if (!(x instanceof Mobject)) return x;
  if (x instanceof NodeMobject) return x.unwrap();
  return hosts.get(x) ?? new MobjectHost(x);
}

/** `wrap(<Rect />)`: use a native node as a mobject. */
export function wrap(node: any): Mobject {
  const m = toMobject(node);
  if (!(m instanceof Mobject)) throw new Error(`wrap() expected a Canvas Commons node but got ${String(node)}`);
  return m;
}

/** `unwrap(mob)`: the native node of a wrapped node, or the node that hosts a mobject. */
export function unwrap(mob: any): Node {
  const node = toNode(mob);
  if (!(node instanceof Node)) throw new Error(`unwrap() expected a mobject but got ${String(mob)}`);
  return node;
}

/** The attached host that draws `m`, directly or through one of its groups. */
export function hostOf(m: Mobject): MobjectHost | undefined {
  const own = hosts.get(m);
  if (own && own.parent()) return own;
  for (const p of m.parents) {
    const host = hostOf(p);
    if (host) return host;
  }
  return undefined;
}

/** Mobjects that native nodes of this view host (for the editor's outline). */
export function hostedMobjects(view: View2D): Mobject[] {
  return (hostsByView.get(view) ?? []).map(h => h.mobject);
}

/**
 * Bounding box of a mobject in frame coordinates (Manim units, as seen with
 * the default camera). Differs from `getBounds()` for a hosted mobject, whose
 * own coordinates are relative to its host.
 */
export function frameBounds(m: Mobject): Bounds {
  const b = m.getBounds();
  const host = hostOf(m);
  if (!host) return b;
  const u = config.unit;
  const matrix = host.view().worldToLocal().multiply(host.localToWorld());
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = new Vector2((i & 1 ? b[2] : b[0]) * u, -(i & 2 ? b[3] : b[1]) * u).transformAsPoint(matrix);
    x0 = Math.min(x0, p.x / u);
    x1 = Math.max(x1, p.x / u);
    y0 = Math.min(y0, -p.y / u);
    y1 = Math.max(y1, -p.y / u);
  }
  return [x0, y0, x1, y1];
}

// ------------------------------------------------- mobjects as node children

/**
 * Canvas Commons keeps only `Node` instances among children and drops the
 * rest silently. These two patches turn a mobject child into its node first,
 * so `<Rect><Circle radius={1} /></Rect>` (with Manim's `Circle`),
 * `node.add(mob)`, `view.add(mob)` and the `children` signal all work.
 */
function childNodes(children: any): any {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      if (children[i] instanceof Mobject) return children.map(toNode);
    }
    return children;
  }
  return children instanceof Mobject ? toNode(children) : children;
}

const PATCHED = Symbol.for('manim/interop');
const nodeProto = Node.prototype as any;
if (!nodeProto[PATCHED]) {
  nodeProto[PATCHED] = true;
  const parseChildren = nodeProto.parseChildren;
  nodeProto.parseChildren = function (this: Node, children: any) {
    // The scene's own root only ever receives nodes.
    return parseChildren.call(this, manimRoots.has(this) ? children : childNodes(children));
  };
  // `add` and `insert` test for nodes themselves instead of parsing.
  const insert = nodeProto.insert;
  nodeProto.insert = function (this: Node, node: any, index?: number) {
    return insert.call(this, childNodes(node), index);
  };
}
