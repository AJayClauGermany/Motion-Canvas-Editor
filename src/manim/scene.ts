/**
 * `Scene` is Manim's entry point: subclass it, write `construct`, and call
 * `play`/`wait`. Underneath it is a regular Canvas Commons generator scene, so
 * seeking, the timeline and rendering all come from the engine.
 */
import {makeScene2D, Node as CCNode, View2D} from '@canvas-commons/2d';
import {ThreadGenerator, tween, useScene, useThread} from '@canvas-commons/core';
import {Animation, toAnimation, Wait} from './animation';
import {config} from './constants';
import {Rectangle} from './geometry';
import {MobNode, Mobject, resetMobjectIds} from './mobject';
import {aliasFields, aliasSnake, callerLine, kw, splitKw} from './util';

export interface Segment {
  kind: 'play' | 'wait';
  /** Animation class names, e.g. `Create, FadeIn`. */
  label: string;
  start: number;
  end: number;
  /** Line in the compiled scene module (mapped back to source by the editor). */
  line?: number;
  mobjects: number[];
}
export interface Section {
  name: string;
  time: number;
  line?: number;
}
export interface SceneReport {
  sceneName: string;
  segments: Segment[];
  sections: Section[];
  duration: number;
}

class Camera {
  public frame: Rectangle;
  private scene: Scene;
  public constructor(scene: Scene) {
    this.scene = scene;
    this.frame = new Rectangle({
      width: config.frameWidth,
      height: config.frameHeight,
      strokeWidth: 0,
      name: 'CameraFrame',
    });
  }
  public get backgroundColor(): string {
    return this.scene._background;
  }
  public set backgroundColor(color: string) {
    this.scene._background = color;
    this.scene.view?.fill(color);
  }
  public get background_color(): string {
    return this.backgroundColor;
  }
  public set background_color(color: string) {
    this.backgroundColor = color;
  }
  public get frameWidth() {
    return this.frame.getWidth();
  }
  public get frameHeight() {
    return this.frame.getHeight();
  }
  public get frame_width() {
    return this.frame.getWidth();
  }
  public get frame_height() {
    return this.frame.getHeight();
  }
  public get frameCenter() {
    return this.frame.getCenter();
  }
  public get frame_center() {
    return this.frame.getCenter();
  }
  /**
   * Fit the frame around `mobjects` (MovingCamera.auto_zoom). Returns the
   * frame, or an `.animate` builder when `animate` is true (the default).
   */
  public autoZoom(mobjects: Mobject | Mobject[], ...rest: any[]): any {
    const o = kw(rest, ['margin', 'onlyMobjectsInFrame', 'animate'], {margin: 0, animate: true});
    const list = Array.isArray(mobjects) ? mobjects : [mobjects];
    let b: number[] | null = null;
    for (const m of list) {
      const mb = m.getBounds();
      b = b ? [Math.min(b[0], mb[0]), Math.min(b[1], mb[1]), Math.max(b[2], mb[2]), Math.max(b[3], mb[3])] : [...mb];
    }
    if (!b) return this.frame;
    const width = b[2] - b[0] + o.margin;
    const height = b[3] - b[1] + o.margin;
    const ratio = config.frameWidth / config.frameHeight;
    const target = Math.max(width, height * ratio, 1e-6);
    const center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0];
    const subject: any = o.animate ? (this.frame as any).animate : this.frame;
    return subject.setWidth(target).moveTo(center);
  }
  public auto_zoom(mobjects: Mobject | Mobject[], ...rest: any[]): any {
    return this.autoZoom(mobjects, ...rest);
  }
}

export class Scene {
  /** Called when a run of `construct` reaches the end. */
  public static onReport?: (report: SceneReport) => void;
  /** The scene instance of the most recent run (for the editor's outline). */
  public static current: Scene | null = null;

  public mobjects: Mobject[] = [];
  public foregroundMobjects: Mobject[] = [];
  public view!: View2D;
  public root!: CCNode;
  public camera: Camera;
  public segments: Segment[] = [];
  public sections: Section[] = [];
  public _background = config.backgroundColor;
  private lastNodes: MobNode[] = [];
  private lastFrameKey = '';

  public constructor() {
    this.camera = new Camera(this);
  }

  // Overridden by users.
  public setup(): void {}
  public construct(): void | ThreadGenerator {}
  public tearDown(): void {}

  public get time(): number {
    return useThread().time();
  }
  public get renderer() {
    return {time: this.time};
  }

  // -------------------------------------------------------------- contents

  public add(...mobs: (Mobject | Mobject[])[]): this {
    const list = mobs.flat().filter(Boolean);
    this.mobjects = this.mobjects.filter(m => !list.includes(m));
    this.mobjects.push(...list);
    return this;
  }
  public addForegroundMobject(...mobs: Mobject[]): this {
    this.foregroundMobjects.push(...mobs);
    return this.add(...mobs);
  }
  public addForegroundMobjects(...mobs: Mobject[]): this {
    return this.addForegroundMobject(...mobs);
  }
  public remove(...mobs: (Mobject | Mobject[])[]): this {
    for (const target of mobs.flat()) {
      if (!target) continue;
      this.mobjects = removeFrom(this.mobjects, target);
      this.foregroundMobjects = this.foregroundMobjects.filter(m => m !== target);
    }
    return this;
  }
  /** Swap one mobject for another, keeping its place in the drawing order. */
  public replace(old: Mobject, replacement: Mobject): this {
    const at = this.mobjects.indexOf(old);
    if (at < 0) return this.remove(old).add(replacement);
    const list = this.mobjects.filter(m => m !== replacement);
    list[list.indexOf(old)] = replacement;
    this.mobjects = list;
    return this;
  }
  public clear(): this {
    this.mobjects = [];
    this.foregroundMobjects = [];
    return this;
  }
  public bringToFront(...mobs: Mobject[]): this {
    return this.add(...mobs);
  }
  public bringToBack(...mobs: Mobject[]): this {
    this.mobjects = [...mobs, ...this.mobjects.filter(m => !mobs.includes(m))];
    return this;
  }
  public getMobjectFamilyMembers(): Mobject[] {
    return this.mobjects.flatMap(m => m.getFamily());
  }
  public getTopLevelMobjects(): Mobject[] {
    return this.mobjects;
  }

  // ------------------------------------------------------------- animation

  /** `self.play(Create(circle), run_time=2)`. Returns a thread to `yield*`. */
  public play(...args: any[]): ThreadGenerator {
    const line = callerLine();
    const [items, kwargs] = splitKw(args);
    return this.run(() => {
      const anims = items.flat().map(toAnimation);
      for (const a of anims) a.configure(kwargs);
      return anims;
    }, line, 'play');
  }

  /** `self.wait(1)` */
  public wait(duration = 1): ThreadGenerator {
    const line = callerLine();
    return this.run(() => [new Wait(duration)], line, 'wait');
  }
  public pause(duration = 1): ThreadGenerator {
    return this.wait(duration);
  }

  /** Marks a named point on the timeline (Manim's sections). */
  public nextSection(name = 'unnamed'): void {
    this.sections.push({name: String(name), time: this.time, line: callerLine()});
  }

  private *run(
    build: () => Animation[],
    line: number | undefined,
    kind: 'play' | 'wait',
  ): ThreadGenerator {
    const anims = build();
    const start = this.time;
    for (const a of anims) a.begin(this);
    const duration = anims.reduce((m, a) => Math.max(m, a.runTime), 0);
    this.segments.push({
      kind,
      label: anims.map(a => a.name).join(', '),
      start,
      end: start + duration,
      line,
      mobjects: anims.flatMap(a => a.mobject.getFamily().map(m => m.id)),
    });
    this.sync();
    let last = 0;
    yield* tween(duration, (_value, time) => {
      for (const a of anims) a.interpolate(a.runTime === 0 ? 1 : Math.min(1, time / a.runTime));
      this.updateMobjects(time - last);
      last = time;
      this.sync();
    });
    for (const a of anims) a.finish(this);
    for (const a of anims) a.cleanUp(this);
    this.updateMobjects(0);
    this.sync();
  }

  public updateMobjects(dt: number): void {
    for (const m of [...this.mobjects]) m.update(dt);
    // The camera frame follows its updaters even when it was never `add`ed.
    const frame = this.camera.frame;
    if (frame.updaters.length && !this.mobjects.includes(frame)) frame.update(dt);
    for (const u of this.updaters) u(dt);
  }

  /** Scene-level updaters: `self.add_updater(lambda dt: ...)`. */
  public updaters: ((dt: number) => void)[] = [];
  public addUpdater(fn: (dt: number) => void): this {
    this.updaters.push(fn);
    return this;
  }
  public removeUpdater(fn: (dt: number) => void): this {
    this.updaters = this.updaters.filter(u => u !== fn);
    return this;
  }

  // ------------------------------------------------------------- rendering

  /** Reconcile the Canvas Commons node list with the mobjects on screen. */
  public sync(): void {
    let leaves: Mobject[] = [];
    for (const m of this.mobjects) {
      for (const f of m.getFamily()) if (f.hasPoints() && f.name !== 'CameraFrame') leaves.push(f);
    }
    // A mobject reachable twice (say through `text[0...3]` and `text`) is
    // painted once, at its front-most position.
    if (new Set(leaves).size !== leaves.length) {
      const seen = new Set<Mobject>();
      const unique: Mobject[] = [];
      for (let i = leaves.length - 1; i >= 0; i--) {
        if (!seen.has(leaves[i])) {
          seen.add(leaves[i]);
          unique.push(leaves[i]);
        }
      }
      leaves = unique.reverse();
    }
    const foreground = new Set(this.foregroundMobjects.flatMap(m => m.getFamily()));
    const rank = (m: Mobject) => m.zIndex + (foreground.has(m) ? 1e6 : 0);
    const ordered = leaves
      .map((m, i) => [m, i] as const)
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([m]) => m);
    const nodes = ordered.map(m => (m.node ??= new MobNode(m)));
    const prev = this.lastNodes;
    if (nodes.length !== prev.length || nodes.some((n, i) => n !== prev[i])) {
      this.root.children(nodes);
      this.lastNodes = nodes;
    }
    // Camera frame → root transform.
    const [x0, y0, x1, y1] = this.camera.frame.getBounds();
    const key = `${x0},${y0},${x1},${y1}`;
    if (key !== this.lastFrameKey) {
      this.lastFrameKey = key;
      const zoom = config.frameWidth / Math.max(x1 - x0, 1e-6);
      const u = config.unit;
      this.root.scale(zoom);
      this.root.position([(-(x0 + x1) / 2) * u * zoom, ((y0 + y1) / 2) * u * zoom]);
    }
  }

  /** @internal Runs the scene inside a Canvas Commons generator. */
  public *_run(view: View2D): ThreadGenerator {
    this.view = view;
    Scene.current = this;
    (useScene() as any).manim = this;
    resetMobjectIds();
    view.fill(this._background);
    this.root = new CCNode({});
    view.add(this.root);
    Mobject.onFamilyChanged = undefined;
    this.setup();
    const result = this.construct();
    if (result && typeof (result as any).next === 'function') yield* result as ThreadGenerator;
    this.tearDown();
    this.sync();
    const ctor = this.constructor as any;
    Scene.onReport?.({
      sceneName: ctor.name,
      segments: this.segments,
      sections: this.sections,
      duration: this.time,
    });
  }
}

function removeFrom(list: Mobject[], target: Mobject): Mobject[] {
  const out: Mobject[] = [];
  for (const m of list) {
    if (m === target) continue;
    if (m.submobjects.length && m.getFamily().includes(target)) {
      // Split the parent: keep its other members on screen (Manim's
      // `restructure_mobjects`).
      out.push(...removeFrom(m.submobjects, target));
    } else {
      out.push(m);
    }
  }
  return out;
}

export class MovingCameraScene extends Scene {}
export class ThreeDScene extends Scene {}
export class ZoomedScene extends Scene {}

/** Wrap a `Scene` subclass as a Canvas Commons scene description. */
export function makeManimScene(SceneClass: new () => Scene) {
  const description = makeScene2D(function* (view) {
    const scene = new SceneClass();
    yield* scene._run(view);
  });
  (description as any).manimClass = SceneClass;
  return description;
}

aliasSnake(Scene.prototype);
aliasFields(Scene.prototype, ['foregroundMobjects']);
