/**
 * Preview engine: evaluates compiled scene code and drives a Canvas Commons
 * `Player` + `Stage` directly (no Vite plugin, no iframe), so the same code
 * runs in the browser build and inside the Electrobun webview.
 */
import * as cc2d from '@canvas-commons/2d';
import * as jsxRuntime from '@canvas-commons/2d/jsx-runtime';
import * as core from '@canvas-commons/core';
import {
  createSceneMetadata,
  createSettingsMetadata,
  Logger,
  LogLevel,
  Player,
  ProjectMetadata,
  Stage,
  ValueDispatcher,
  Vector2,
} from '@canvas-commons/core';
import type {FullSceneDescription, Project, SceneDescription} from '@canvas-commons/core';
import * as manim from '../manim';
import {api, apiNames, config, makeManimScene, Mobject, Scene, SceneReport, VMobject} from '../manim';
import type {CompileResult, Diagnostic} from './compile';

export interface SceneEntry {
  name: string;
  kind: 'manim' | 'canvas-commons';
}

export interface TimelineSegment {
  kind: 'play' | 'wait';
  label: string;
  start: number;
  end: number;
  /** 1-based line in the user's source. */
  line?: number;
  mobjects: number[];
}

export interface Timeline {
  sceneName: string;
  segments: TimelineSegment[];
  sections: {name: string; time: number; line?: number}[];
  duration: number;
}

export interface OutlineNode {
  id: number;
  name: string;
  kind: string;
  line?: number;
  color?: string;
  visible: boolean;
  children: OutlineNode[];
}

export interface MobjectInfo {
  id: number;
  name: string;
  kind: string;
  line?: number;
  center: [number, number];
  width: number;
  height: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  zIndex: number;
  points?: number;
  submobjects: number;
  updaters: number;
  text?: string;
}

export interface EngineEvents {
  frame(frame: number): void;
  duration(frames: number): void;
  state(state: {paused: boolean; loop: boolean; speed: number}): void;
  timeline(timeline: Timeline): void;
  diagnostics(list: Diagnostic[]): void;
  rendered(): void;
}

const MODULES: Record<string, any> = {
  '@canvas-commons/2d': cc2d,
  '@canvas-commons/core': core,
  '@canvas-commons/2d/jsx-runtime': jsxRuntime,
  // Motion Canvas snippets paste in unchanged.
  '@motion-canvas/2d': cc2d,
  '@motion-canvas/core': core,
  '@motion-canvas/2d/jsx-runtime': jsxRuntime,
  '@motion-canvas/2d/lib/jsx-runtime': jsxRuntime,
  manim: api,
};

const SOURCE_URL = 'scene-source.js';

/** How many lines `new Function` puts before the first line of its body. */
let headerLines: number | null = null;
function headerOffset(): number {
  if (headerLines !== null) return headerLines;
  try {
    const probe = new Function(
      'a',
      `return (function(){ return new Error().stack; })()\n//# sourceURL=scene-calibrate.js`,
    );
    const m = /scene-calibrate\.js:(\d+)/.exec(String(probe()));
    headerLines = m ? parseInt(m[1], 10) - 1 : 2;
  } catch {
    headerLines = 2;
  }
  return headerLines;
}

function isSceneDescription(value: unknown): value is SceneDescription {
  return typeof value === 'object' && value !== null && 'klass' in value && typeof (value as any).klass === 'function';
}

export class Engine {
  public readonly stage = new Stage();
  public readonly canvas: HTMLCanvasElement = this.stage.finalBuffer;
  public player: Player | null = null;
  public scenes: SceneEntry[] = [];
  public activeScene: string | null = null;
  public fps = config.frameRate;
  public resolutionScale = 1;

  private logger = new Logger();
  private onReplaced: ValueDispatcher<FullSceneDescription> | null = null;
  private compiled: CompileResult | null = null;
  private descriptions = new Map<string, SceneDescription>();
  private listeners: {[K in keyof EngineEvents]?: Set<EngineEvents[K]>} = {};
  private runtimeDiagnostics: Diagnostic[] = [];
  private hitCanvas = document.createElement('canvas').getContext('2d')!;

  public constructor() {
    this.logger.onLogged.subscribe(payload => {
      if (payload.level !== LogLevel.Error && payload.level !== LogLevel.Warn) return;
      if (payload.level === LogLevel.Warn) return;
      this.pushRuntimeError(payload.message, payload.stack);
    });
    Scene.onReport = report => this.handleReport(report);
  }

  // ---------------------------------------------------------------- events

  public on<K extends keyof EngineEvents>(event: K, fn: EngineEvents[K]): () => void {
    const set = ((this.listeners[event] as any) ??= new Set());
    set.add(fn);
    return () => set.delete(fn);
  }
  private emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>) {
    for (const fn of (this.listeners[event] as Set<any>) ?? []) fn(...args);
  }

  // --------------------------------------------------------------- loading

  /** Map a line in the evaluated module to the user's source line. */
  public mapLine(jsLine: number | undefined): number | undefined {
    if (!jsLine || !this.compiled) return undefined;
    const idx = jsLine - headerOffset() - 1;
    return this.compiled.lineMap[idx] ?? undefined;
  }

  private lineFromStack(stack: string | undefined): number | undefined {
    if (!stack) return undefined;
    const m = new RegExp(`${SOURCE_URL.replace('.', '\\.')}:(\\d+)`).exec(stack);
    return m ? this.mapLine(parseInt(m[1], 10)) : undefined;
  }

  private pushRuntimeError(message: string, stack?: string) {
    let text = String(message);
    const undefinedName = /^(\w+) is not defined/.exec(text)?.[1];
    if (undefinedName && apiNames.includes(undefinedName) && !this.compiled?.prelude) {
      text += ` — add "from manim import *" at the top of the file.`;
    }
    const diag: Diagnostic = {stage: 'runtime', message: text, line: this.lineFromStack(stack)};
    if (this.runtimeDiagnostics.some(d => d.message === diag.message && d.line === diag.line)) return;
    this.runtimeDiagnostics.push(diag);
    this.emit('diagnostics', [...this.runtimeDiagnostics]);
  }

  /**
   * Evaluate freshly compiled code and show it. Keeps the playhead where it
   * was, so editing feels live.
   */
  public async load(compiled: CompileResult, preferredScene?: string | null): Promise<boolean> {
    this.runtimeDiagnostics = [];
    if (!compiled.ok) {
      this.emit('diagnostics', compiled.diagnostics);
      return false;
    }
    this.compiled = compiled;

    let exports: Record<string, any>;
    try {
      exports = this.evaluate(compiled);
    } catch (e: any) {
      this.pushRuntimeError(e?.message ?? String(e), e?.stack);
      return false;
    }

    this.descriptions.clear();
    const entries: SceneEntry[] = [];
    if (isSceneDescription(exports.default)) {
      this.descriptions.set('default', exports.default);
      entries.push({name: 'default', kind: 'canvas-commons'});
    }
    for (const [name, value] of Object.entries(exports)) {
      if (name === 'default' || name === '__classes') continue;
      if (isSceneDescription(value)) {
        this.descriptions.set(name, value);
        entries.push({name, kind: 'canvas-commons'});
      }
    }
    for (const [name, klass] of Object.entries<any>(exports.__classes ?? {})) {
      if (typeof klass === 'function' && klass.prototype instanceof Scene) {
        this.descriptions.set(name, makeManimScene(klass));
        entries.push({name, kind: 'manim'});
      }
    }
    this.scenes = entries;
    if (entries.length === 0) {
      this.pushRuntimeError(
        'No scene found. Define a class that extends Scene, or default-export makeScene2D(...).',
      );
      return false;
    }

    const name =
      preferredScene && this.descriptions.has(preferredScene) ? preferredScene : entries[0].name;
    this.activeScene = name;
    this.show(this.descriptions.get(name)!, name);
    this.emit('diagnostics', []);
    return true;
  }

  public selectScene(name: string) {
    const description = this.descriptions.get(name);
    if (!description) return;
    this.activeScene = name;
    this.runtimeDiagnostics = [];
    this.emit('diagnostics', []);
    this.show(description, name);
    this.player?.requestSeek(0);
  }

  private evaluate(compiled: CompileResult): Record<string, any> {
    const names = compiled.prelude ? apiNames : ['__op'];
    const factory = new Function(
      ...names,
      `return function(require, exports, module){${compiled.js}\n}\n//# sourceURL=${SOURCE_URL}`,
    );
    const body = factory(...names.map(n => api[n]));
    const module = {exports: {} as Record<string, any>};
    const require = (id: string) => {
      const mod = MODULES[id];
      if (!mod) throw new Error(`Cannot import "${id}". Available: ${Object.keys(MODULES).join(', ')}`);
      return mod;
    };
    body(require, module.exports, module);
    return module.exports;
  }

  private toFullScene(description: SceneDescription, name: string): FullSceneDescription {
    const scene = {
      klass: description.klass,
      config: description.config,
      meta: description.meta ?? createSceneMetadata(),
      name,
    } as FullSceneDescription;
    scene.onReplaced = this.onReplaced ?? new ValueDispatcher(scene);
    return scene;
  }

  private show(description: SceneDescription, name: string) {
    if (!this.player) {
      const scene = this.toFullScene(description, name);
      this.onReplaced = scene.onReplaced;
      const draft: Omit<Project, 'meta'> = {
        name: 'editor',
        scenes: [scene],
        plugins: [],
        logger: this.logger,
        settings: createSettingsMetadata(),
        versions: {core: '0.4.0', two: '0.4.0', ui: null, vitePlugin: null},
        experimentalFeatures: true,
        variables: {},
      };
      const project = draft as Project;
      project.meta = new ProjectMetadata(project);
      const size = new Vector2(config.pixelWidth, config.pixelHeight);
      this.stage.configure({size, resolutionScale: this.resolutionScale, background: null} as any);
      const player = new Player(project, {size, fps: this.fps, resolutionScale: this.resolutionScale});
      this.player = player;
      player.onRender.subscribe(() => void this.render());
      player.onFrameChanged.subscribe(frame => this.emit('frame', frame));
      player.onDurationChanged.subscribe(duration => this.emit('duration', duration));
      player.onStateChanged.subscribe(state =>
        this.emit('state', {paused: state.paused, loop: state.loop, speed: state.speed}),
      );
      player.toggleLoop(true);
    } else {
      this.onReplaced!.current = this.toFullScene(description, name);
    }
  }

  private async render() {
    const player = this.player;
    if (!player) return;
    try {
      await this.stage.render(player.playback.currentScene, player.playback.previousScene);
      this.emit('rendered');
    } catch (e: any) {
      this.pushRuntimeError(e?.message ?? String(e), e?.stack);
    }
  }

  private handleReport(report: SceneReport) {
    this.emit('timeline', {
      sceneName: report.sceneName,
      duration: report.duration,
      sections: report.sections.map(s => ({...s, line: this.mapLine(s.line)})),
      segments: report.segments.map(s => ({...s, line: this.mapLine(s.line)})),
    });
  }

  // -------------------------------------------------------------- playback

  public togglePlayback(value?: boolean) {
    this.player?.togglePlayback(value);
  }
  public seek(frame: number) {
    this.player?.requestSeek(Math.max(0, Math.round(frame)));
  }
  public seekTime(seconds: number) {
    this.seek(seconds * this.fps);
  }
  public step(delta: number) {
    if (!this.player) return;
    this.player.togglePlayback(false);
    this.seek(this.player.playback.frame + delta);
  }
  public toggleLoop(value?: boolean) {
    this.player?.toggleLoop(value);
  }
  public setSpeed(speed: number) {
    this.player?.setSpeed(speed);
  }
  public async setQuality(fps: number, resolutionScale: number) {
    this.fps = fps;
    this.resolutionScale = resolutionScale;
    const size = new Vector2(config.pixelWidth, config.pixelHeight);
    this.stage.configure({size, resolutionScale} as any);
    await this.player?.configure({range: [0, Infinity], fps, size, audioOffset: 0, resolutionScale});
    this.player?.requestRender();
  }
  public get frame(): number {
    return this.player?.playback.frame ?? 0;
  }

  // ------------------------------------------------------------ inspection

  private get manimScene(): Scene | null {
    const scene: any = this.player?.playback.currentScene;
    return scene?.manim ?? null;
  }

  public outline(): OutlineNode[] {
    const scene = this.manimScene;
    if (!scene) return [];
    const walk = (m: Mobject): OutlineNode => ({
      id: m.id,
      name: m.name,
      kind: m._kind(),
      line: this.mapLine(m.sourceLine),
      color: m.hasPoints() || m.submobjects.length ? m.getColor() : undefined,
      visible: m.hasPoints() ? m.fillOpacity > 0.001 || (m.strokeOpacity > 0.001 && m.strokeWidth > 0) : true,
      children: m.submobjects.map(walk),
    });
    return scene.mobjects.filter(m => m.name !== 'CameraFrame').map(walk);
  }

  private findMobject(id: number): Mobject | null {
    const scene = this.manimScene;
    if (!scene) return null;
    for (const top of scene.mobjects) {
      for (const m of top.getFamily()) if (m.id === id) return m;
    }
    return null;
  }

  public inspect(id: number): MobjectInfo | null {
    const m = this.findMobject(id);
    if (!m) return null;
    const c = m.getCenter();
    const leaf = m.hasPoints() ? m : (m.familyMembersWithPoints()[0] ?? m);
    return {
      id: m.id,
      name: m.name,
      kind: m._kind(),
      line: this.mapLine(m.sourceLine),
      center: [c[0], c[1]],
      width: m.getWidth(),
      height: m.getHeight(),
      fillColor: leaf.fillColor,
      fillOpacity: leaf.fillOpacity,
      strokeColor: leaf.strokeColor,
      strokeOpacity: leaf.strokeOpacity,
      strokeWidth: leaf.strokeWidth,
      zIndex: m.zIndex,
      points: m instanceof VMobject ? m.points.length : undefined,
      submobjects: m.submobjects.length,
      updaters: m.updaters.length,
      text: (m as any).text ?? (m as any).texString ?? (m as any).char,
    };
  }

  /** Bounding box of a mobject in Manim units, for the selection overlay. */
  public bounds(id: number): [number, number, number, number] | null {
    const m = this.findMobject(id);
    return m ? m.getBounds() : null;
  }

  /** Topmost top-level mobject under a point given in Manim units. */
  public pick(x: number, y: number): number | null {
    const scene = this.manimScene;
    if (!scene) return null;
    const u = config.unit;
    const tops = [...scene.mobjects].reverse();
    for (const top of tops) {
      if (top.name === 'CameraFrame') continue;
      for (const m of top.getFamily().reverse()) {
        if (!m.hasPoints()) continue;
        let hit = false;
        if (m instanceof VMobject) hit = m._containsPoint(this.hitCanvas, x, y, u);
        else {
          const b = m._ownBounds();
          hit = !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
        }
        if (hit) return top.id === m.id ? m.id : top.id;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- export

  public async frameBlob(): Promise<Blob | null> {
    return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
  }

  /** Record the whole animation in real time to a WebM blob. */
  public async record(onProgress?: (p: number) => void): Promise<Blob | null> {
    const player = this.player;
    if (!player || typeof MediaRecorder === 'undefined') return null;
    const stream = this.canvas.captureStream(this.fps);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t =>
      MediaRecorder.isTypeSupported(t),
    );
    if (!mime) return null;
    const recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 12_000_000});
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    const duration = player.playback.duration;
    const done = new Promise<Blob>(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, {type: 'video/webm'}));
    });
    player.togglePlayback(false);
    player.toggleLoop(false);
    player.requestSeek(0);
    await new Promise(r => setTimeout(r, 150));
    recorder.start();
    player.togglePlayback(true);
    await new Promise<void>(resolve => {
      const off = player.onFrameChanged.subscribe(frame => {
        onProgress?.(duration ? frame / duration : 1);
        if (frame >= duration - 1) {
          off();
          resolve();
        }
      });
    });
    await new Promise(r => setTimeout(r, 120));
    recorder.stop();
    player.togglePlayback(false);
    player.toggleLoop(true);
    return done;
  }

  public dispose() {
    this.player?.deactivate();
    this.player = null;
  }
}

export {manim};
