/**
 * Exporting the open scene, for the Export dialog and for agents alike.
 *
 *   video, gif, image   rendered frame by frame in a hidden engine of their
 *                       own (`loadHarness`), at the size of the result, so the
 *                       preview is not disturbed and its quality setting does
 *                       not matter
 *   embed               the compiled scene inside the single-file player
 *   source              the scene's text
 *
 * Every kind has defaults (`exportDefaults`): a request with only `kind` works.
 */
import type {CompileOptions} from '../runtime/compile';
import {compileScene} from '../runtime/compile';
import {buildEmbedHtml, embedData, embedSnippet} from '../runtime/embed';
import type {Engine} from '../runtime/engine';
import type {RenderControl, RenderOutput} from '../runtime/export';
import {loadHarness} from './sandbox';

export type ExportKind = 'video' | 'gif' | 'embed' | 'image' | 'source';

export interface ExportRequest {
  kind: ExportKind;
  /** video, image: height of the result in pixels (720, 1080, 2160). */
  height?: number;
  /** video, gif: frames per second. */
  fps?: number;
  /** gif: width in pixels. */
  width?: number;
  /** image: seconds; the preview's current time when missing. */
  time?: number;
}

export interface ExportFile {
  kind: ExportKind;
  blob: Blob;
  fileName: string;
  extension: string;
  mime: string;
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  seconds?: number;
  codec?: string;
  /** embed: the tag to paste into a web page. */
  snippet?: string;
  /** Recorded while playing, because this browser cannot encode frame by frame. */
  realtime?: boolean;
}

export const exportDefaults = {
  video: {height: 1080, fps: 30},
  gif: {width: 640, fps: 20},
  image: {height: 1080},
} as const;

export const VIDEO_HEIGHTS = [720, 1080, 2160] as const;
export const VIDEO_FPS = [30, 60] as const;
export const GIF_WIDTHS = [480, 640, 960] as const;

/** The scene's own frame is 1920 × 1080; other sizes scale it. */
const BASE_HEIGHT = 1080;
const BASE_WIDTH = 1920;

/** A request with every option filled in. */
export function resolveRequest(request: ExportRequest): Required<Pick<ExportRequest, 'kind'>> & ExportRequest {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (request.kind === 'video') {
    return {kind: 'video', height: clamp(Math.round(request.height ?? exportDefaults.video.height), 180, 2160), fps: clamp(Math.round(request.fps ?? exportDefaults.video.fps), 1, 120)};
  }
  if (request.kind === 'gif') {
    return {kind: 'gif', width: clamp(Math.round(request.width ?? exportDefaults.gif.width), 120, 1920), fps: clamp(Math.round(request.fps ?? exportDefaults.gif.fps), 1, 50)};
  }
  if (request.kind === 'image') return {kind: 'image', height: clamp(Math.round(request.height ?? exportDefaults.image.height), 180, 4320), time: request.time};
  return {kind: request.kind};
}

/** One line saying what a request produces, e.g. "MP4 video · 1920 × 1080 · 30 fps". */
export function describeRequest(request: ExportRequest, language: string): string {
  const r = resolveRequest(request);
  const wide = (h: number) => `${Math.round((h * BASE_WIDTH) / BASE_HEIGHT)} × ${h}`;
  if (r.kind === 'video') return `MP4 video · ${wide(r.height!)} · ${r.fps} fps`;
  if (r.kind === 'gif') return `Animated GIF · ${r.width} × ${Math.round((r.width! * BASE_HEIGHT) / BASE_WIDTH)} · ${r.fps} fps`;
  if (r.kind === 'image') return `PNG image · ${wide(r.height!)}`;
  if (r.kind === 'embed') return 'One HTML file with a player · sharp at any size';
  return `The scene's code · .${language}`;
}

export interface ExportHost {
  engine: Engine;
  getSource(): string;
  compileOptions(): CompileOptions;
  /** File name without extension. */
  baseName(): string;
  title(): string;
  activeScene(): string | null;
  previewFps(): number;
  /** The preview's playhead, in seconds. */
  time(): number;
}

let template: Promise<string> | null = null;
/** The single-file player, shipped next to the editor as `player-template.html`. */
function playerTemplate(): Promise<string> {
  template ??= fetch(new URL('player-template.html', location.href))
    .then(async r => {
      if (!r.ok) throw new Error(`The embed player is not available here (${r.status}). Run the editor from a full build (\`bun run build\`) or the dev server.`);
      return r.text();
    })
    .catch(e => {
      template = null;
      throw e;
    });
  return template;
}

export function createExporter(host: ExportHost) {
  const named = (kind: ExportKind, out: Pick<ExportFile, 'blob' | 'extension' | 'mime'> & Partial<ExportFile>): ExportFile => ({
    ...out,
    kind,
    fileName: `${host.baseName()}${kind === 'image' ? '-frame' : ''}.${out.extension}`,
  });

  /** Frame-exact render in a hidden engine sized for the result. */
  const render = async (request: ExportRequest, onProgress: (p: number, realtime: boolean) => void, control: RenderControl): Promise<ExportFile> => {
    const r = resolveRequest(request);
    // A GIF is rendered larger than it is saved, then scaled down: smoother edges.
    const scale = r.kind === 'gif' ? Math.min(1, (r.width! * 2) / BASE_WIDTH) : r.height! / BASE_HEIGHT;
    const fps = r.kind === 'image' ? host.previewFps() : r.fps!;
    const time = r.kind === 'image' ? (r.time ?? host.time()) : undefined;
    const harness = await loadHarness({fps, scale});
    try {
      const result: {run: {diagnostics: {message: string; line?: number}[]; timedOut?: boolean}; output?: RenderOutput} = await harness.agent.export(
        host.getSource(),
        host.compileOptions(),
        {kind: r.kind, width: r.width, time, scene: host.activeScene() ?? undefined},
        (p: number) => onProgress(p, false),
        control,
      );
      if (!result.output) {
        const problems = result.run.diagnostics.map(d => `${d.line ? `line ${d.line}: ` : ''}${d.message}`).join(' ');
        throw new Error(result.run.timedOut ? 'The scene never finished: it may loop forever.' : `The scene has problems, so there is nothing to export. ${problems}`);
      }
      const o = result.output;
      // The blob belongs to the iframe's realm; copy it out before the frame goes away.
      const blob = new Blob([await o.blob.arrayBuffer()], {type: o.mime});
      return named(r.kind, {blob, extension: o.extension, mime: o.mime, width: o.width, height: o.height, fps: o.fps, frames: o.frames, seconds: o.seconds, codec: o.codec});
    } finally {
      harness.dispose();
    }
  };

  /** Last resort for video: record the preview while it plays. */
  const recordRealtime = async (onProgress: (p: number, realtime: boolean) => void): Promise<ExportFile> => {
    const blob = await host.engine.record(p => onProgress(p, true));
    if (!blob) throw new Error('This browser cannot encode video. Open the editor in Chrome, Edge or Safari, or export a GIF or a web embed instead.');
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    return named('video', {blob, extension, mime: blob.type, realtime: true});
  };

  const run = async (request: ExportRequest, onProgress: (p: number, realtime: boolean) => void = () => {}, control: RenderControl = {cancelled: false}): Promise<ExportFile> => {
    if (request.kind === 'source') {
      const extension = host.compileOptions().language === 'tsx' ? 'tsx' : 'civet';
      return named('source', {blob: new Blob([host.getSource()], {type: 'text/plain'}), extension, mime: 'text/plain'});
    }
    if (request.kind === 'embed') {
      const compiled = compileScene(host.getSource(), host.compileOptions());
      if (!compiled.ok) throw new Error(`The scene does not compile, so there is nothing to export. ${compiled.diagnostics.map(d => `${d.line ? `line ${d.line}: ` : ''}${d.message}`).join(' ')}`);
      const title = host.title();
      const html = buildEmbedHtml(await playerTemplate(), embedData(compiled, {title, scene: host.activeScene(), fps: host.previewFps()}));
      const file = named('embed', {blob: new Blob([html], {type: 'text/html'}), extension: 'html', mime: 'text/html', width: BASE_WIDTH, height: BASE_HEIGHT});
      return {...file, snippet: embedSnippet(file.fileName, title)};
    }
    try {
      return await render(request, onProgress, control);
    } catch (e) {
      if (request.kind === 'video' && (e as Error).name === 'ExportUnsupported') return recordRealtime(onProgress);
      throw e;
    }
  };

  return {run};
}

export type Exporter = ReturnType<typeof createExporter>;

export const formatBytes = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(1)} MB`);
