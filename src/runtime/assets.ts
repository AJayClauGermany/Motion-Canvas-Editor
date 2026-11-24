/**
 * Files a scene refers to by name (sound clips). The editor keeps them in
 * the project folder's `assets/` directory or in the browser; a scene just
 * writes `add_sound "click.mp3"` or `sound("click.mp3")`. This table maps
 * each name to a URL the page can load. DOM-free.
 */
let table: Record<string, string> = {};
let missing = new Set<string>();

/** Replace the table: asset name → URL (blob:, data: or http). */
export function setAssetUrls(urls: Record<string, string>) {
  table = {...urls};
}
export const assetUrls = (): Record<string, string> => table;

/** `./assets/Click.mp3` and `click.mp3` name the same file. */
export const assetKey = (ref: string) =>
  ref
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/^assets\//i, '');

const isUrl = (ref: string) => /^(https?:|data:|blob:|\/)/i.test(ref);

/** The URL of an asset; a URL passes through. An unknown name is remembered (`takeMissingAssets`). */
export function resolveAsset(ref: string): string {
  const key = assetKey(ref);
  if (key in table) return table[key];
  const lower = key.toLowerCase();
  const found = Object.keys(table).find(k => k.toLowerCase() === lower);
  if (found) return table[found];
  if (isUrl(ref)) return ref;
  missing.add(key);
  return ref;
}

/** Names that were asked for and not found since the last call. */
export function takeMissingAssets(): string[] {
  const out = [...missing];
  missing = new Set();
  return out;
}

/** The names in `urls` that `code` mentions, for packing only what a scene uses. */
export function usedAssets(code: string, names: string[]): string[] {
  const text = code.toLowerCase();
  return names.filter(n => text.includes(n.toLowerCase()));
}
