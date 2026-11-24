/**
 * The web embed export: one self-contained HTML file that plays a scene
 * (`player.html` built as a single file, with the compiled scene in its data
 * block). DOM-free.
 */
import type {CompileResult} from './compile';

export interface EmbedData {
  title: string;
  /** The compiled module body (`CompileResult.js`). */
  js: string;
  prelude: boolean;
  /** Which scene of the module to play; the first when missing. */
  scene?: string | null;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  /** The sound clips the scene uses, by name, as `data:` URLs: the file stays self-contained. */
  assets?: Record<string, string>;
}

/** The data block of `player.html`, exactly as the build leaves it. */
export const EMBED_SLOT = '<script type="application/json" id="mce-scene">"__MCE_SCENE_DATA__"</script>';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON that is safe inside a `<script>` element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function embedData(compiled: CompileResult, options: Omit<EmbedData, 'js' | 'prelude'>): EmbedData {
  return {...options, js: compiled.js, prelude: compiled.prelude};
}

/** Put a scene into the player template. */
export function buildEmbedHtml(template: string, data: EmbedData): string {
  const at = template.lastIndexOf(EMBED_SLOT);
  if (at < 0) throw new Error('The player template has no slot for the scene (was it built from player.html?).');
  // Not `String.replace`: compiled code is full of `$` patterns.
  const html = template.slice(0, at) + `<script type="application/json" id="mce-scene">${scriptJson(data)}</script>` + template.slice(at + EMBED_SLOT.length);
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(data.title)}</title>`);
}

/** The tag to paste into a web page next to the exported file. */
export function embedSnippet(fileName: string, title: string): string {
  return `<iframe src="${escapeHtml(fileName)}" title="${escapeHtml(title)}" style="width: 100%; aspect-ratio: 16 / 9; border: 0;" loading="lazy" allowfullscreen></iframe>`;
}
