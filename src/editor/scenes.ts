/**
 * "My scenes": the author's own documents, kept in this browser. The list
 * lives under one key; each scene's text is stored like an example's edits
 * (see `bufferKey` in state.ts), under the slug `my-<id>`.
 */
export interface SceneRecord {
  id: string;
  name: string;
  style: 'manim' | 'canvas-commons';
  created: number;
  updated: number;
}

const INDEX_KEY = 'mce.scenes.v1';
const LAST_KEY = 'mce.last.v1';

export const sceneSlug = (id: string) => `my-${id}`;
export const isSceneSlug = (slug: string) => slug.startsWith('my-');

export function loadScenes(): SceneRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(r => r && typeof r.id === 'string' && typeof r.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveScenes(list: SceneRecord[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable; scenes then live for the session only.
  }
}

/** The scene that was open last, so the editor opens on it again. */
export function lastScene(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
export function rememberScene(slug: string | null) {
  try {
    if (slug) localStorage.setItem(LAST_KEY, slug);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    // See saveScenes.
  }
}

export const newSceneId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

/** `base`, or `base 2`, `base 3`, … when the name is taken. */
export function uniqueName(base: string, taken: string[]): string {
  const clean = base.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Untitled';
  const used = new Set(taken.map(n => n.toLowerCase()));
  if (!used.has(clean.toLowerCase())) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean} ${i}`.toLowerCase())) return `${clean} ${i}`;
}

/** A scene name as a file name (without extension). */
export function fileBase(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .toLowerCase();
  return base || 'scene';
}

/** A name for a scene opened from a file: the file name without its extension. */
export const nameFromFile = (fileName: string) => fileName.replace(/\.(civet|tsx?|jsx?|py|txt)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
