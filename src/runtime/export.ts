/**
 * Frame-exact export of a loaded scene: every frame is seeked, rendered and
 * handed to an encoder, so the result does not depend on how fast the machine
 * plays the animation. Runs next to an `Engine` (in the harness page).
 *
 *   video  H.264 in MP4 where the browser can encode it (WebCodecs), otherwise
 *          VP9/VP8/AV1 in WebM
 *   gif    quantised per frame (gifenc)
 *   image  one frame as PNG
 *
 * The encoders are imported on demand: a page that never exports never loads
 * them.
 */
import type {Engine} from './engine';

export type RenderKind = 'video' | 'gif' | 'image';

export interface RenderOptions {
  kind: RenderKind;
  /** `image`: the time of the frame, in seconds. */
  time?: number;
  /** `gif`: output width in pixels (the height follows the frame's shape). */
  width?: number;
}

export interface RenderOutput {
  blob: Blob;
  extension: string;
  mime: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Length of the result in seconds (0 for an image). */
  seconds: number;
  /** Video codec, when there is one. */
  codec?: string;
}

/** Set `cancelled` to stop a render at the next frame. */
export interface RenderControl {
  cancelled: boolean;
}

// The errors cross from the harness iframe into the editor page, where
// `instanceof` does not hold: tell them apart by `name`.
export class ExportCancelled extends Error {
  public override name = 'ExportCancelled';
  public constructor() {
    super('The export was cancelled.');
  }
}

/** This browser has no encoder for the format. */
export class ExportUnsupported extends Error {
  public override name = 'ExportUnsupported';
}

export interface RenderHost {
  engine: Engine;
  /** Length of the scene in frames. */
  frames: number;
  /** Seek and wait until that frame is on the canvas. */
  seek(frame: number): Promise<void>;
}

/** What the preview shows behind a scene that paints no background. */
const BACKDROP = '#000000';

/** Whether this browser can encode video frame by frame. */
export const canEncodeFrames = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/**
 * An opaque copy of the stage canvas. Encoders ignore alpha in different
 * ways, and WebKit defers `drawImage(canvas)` until its next rendering update,
 * so each frame is snapshotted and painted over the backdrop first.
 */
function frameCopier(source: HTMLCanvasElement, width: number, height: number, readback: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: readback})!;
  ctx.imageSmoothingQuality = 'high';
  return {
    canvas,
    ctx,
    async copy() {
      const bitmap = await createImageBitmap(source);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
    },
  };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function renderVideo(host: RenderHost, onProgress: (p: number) => void, control: RenderControl): Promise<RenderOutput> {
  if (!canEncodeFrames()) throw new ExportUnsupported('This browser cannot encode video frame by frame (no WebCodecs).');
  const mb = await import('mediabunny');
  const {engine, frames} = host;
  const fps = engine.fps;
  // H.264 needs even dimensions.
  const width = even(engine.canvas.width);
  const height = even(engine.canvas.height);
  const frame = frameCopier(engine.canvas, width, height, false);

  let format: InstanceType<typeof mb.Mp4OutputFormat> | InstanceType<typeof mb.WebMOutputFormat>;
  let codec: import('mediabunny').VideoCodec | null;
  if (await mb.canEncodeVideo('avc', {width, height, frameRate: fps})) {
    // The index goes first, so the file starts playing before it has fully loaded.
    format = new mb.Mp4OutputFormat({fastStart: 'in-memory'});
    codec = 'avc';
  } else {
    format = new mb.WebMOutputFormat();
    codec = await mb.getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), {width, height});
  }
  if (!codec) throw new ExportUnsupported('This browser has no video encoder for MP4 or WebM.');

  const target = new mb.BufferTarget();
  const output = new mb.Output({format, target});
  // Flat colour and sharp edges are what compression artefacts show on first.
  const source = new mb.CanvasSource(frame.canvas, {codec, quality: mb.QUALITY_VERY_HIGH, keyFrameInterval: 2});
  output.addVideoTrack(source, {frameRate: fps});
  await output.start();
  try {
    for (let f = 0; f < frames; f++) {
      if (control.cancelled) throw new ExportCancelled();
      await host.seek(f);
      await frame.copy();
      await source.add(f / fps, 1 / fps);
      onProgress((f + 1) / frames);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return {
    blob: new Blob([target.buffer!], {type: format.mimeType}),
    extension: format.fileExtension.replace(/^\./, ''),
    mime: format.mimeType,
    width,
    height,
    fps,
    frames,
    seconds: frames / fps,
    codec,
  };
}

async function renderGif(host: RenderHost, opts: RenderOptions, onProgress: (p: number) => void, control: RenderControl): Promise<RenderOutput> {
  const {GIFEncoder, quantize, applyPalette} = await import('gifenc');
  const {engine, frames} = host;
  const fps = engine.fps;
  const width = Math.min(opts.width ?? 640, engine.canvas.width);
  const height = Math.round((width * engine.canvas.height) / engine.canvas.width);
  const frame = frameCopier(engine.canvas, width, height, true);
  const gif = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    if (control.cancelled) throw new ExportCancelled();
    await host.seek(f);
    await frame.copy();
    const {data} = frame.ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, {palette, delay: 1000 / fps});
    onProgress((f + 1) / frames);
  }
  gif.finish();
  return {blob: new Blob([gif.bytes()], {type: 'image/gif'}), extension: 'gif', mime: 'image/gif', width, height, fps, frames, seconds: frames / fps};
}

async function renderImage(host: RenderHost, opts: RenderOptions): Promise<RenderOutput> {
  const {engine, frames} = host;
  const index = Math.min(Math.max(0, Math.round((opts.time ?? 0) * engine.fps)), Math.max(0, frames - 1));
  await host.seek(index);
  // The frame as drawn, with its transparency: a scene without a background stays see-through.
  const bitmap = await createImageBitmap(engine.canvas);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The frame could not be read back from the canvas.');
  return {blob, extension: 'png', mime: 'image/png', width: canvas.width, height: canvas.height, fps: engine.fps, frames: 1, seconds: 0};
}

export function renderScene(host: RenderHost, opts: RenderOptions, onProgress: (p: number) => void, control: RenderControl): Promise<RenderOutput> {
  if (opts.kind !== 'image' && host.frames < 1) throw new Error('The scene has no frames to export: it ends at 0 seconds.');
  if (opts.kind === 'video') return renderVideo(host, onProgress, control);
  if (opts.kind === 'gif') return renderGif(host, opts, onProgress, control);
  return renderImage(host, opts);
}
