/**
 * Sound clips of the project. They live in the project folder's `assets/`
 * directory when a folder is connected, and in the browser (IndexedDB)
 * otherwise. Scenes refer to them by file name; `urls()` is the table the
 * engines resolve those names with (`runtime/assets.ts`).
 */
import {createSignal} from 'solid-js';
import type {Folder} from './folder';
import {SOUND_FILE} from './folder';
import {idbDelete, idbGet, idbKeys, idbSet} from './idb';

export interface Asset {
  name: string;
  size: number;
  type: string;
  /** A blob: URL, valid while this page lives. */
  url: string;
  modified: number;
}

/** A file name that is safe in a folder and easy to type in a scene. */
export function assetName(name: string): string {
  const clean = name
    .replace(/^.*[\\/]/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '');
  return clean || 'sound.wav';
}

export const isSound = (name: string, type = '') => type.startsWith('audio/') || SOUND_FILE.test(name);

const TYPES: Record<string, string> = {mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm', webm: 'audio/webm'};
export const soundType = (name: string) => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export function createAssetStore(onChange: (urls: Record<string, string>) => void) {
  const [list, setList] = createSignal<Asset[]>([]);
  let current: Asset[] = [];
  const blobs = new Map<string, Blob>();
  let folder: Folder | null = null;

  const urls = () => Object.fromEntries(current.map(a => [a.name, a.url]));

  /** Read the clips from where they live; keep the URL of a file that did not change. */
  const refresh = async (): Promise<void> => {
    let found: {name: string; modified: number; blob: Blob}[] = [];
    try {
      if (folder) found = (await folder.assets()).map(f => ({name: f.name, modified: f.modified, blob: f.file}));
      else {
        for (const name of await idbKeys('assets')) {
          const blob = await idbGet<Blob>('assets', name);
          if (blob) found.push({name, modified: 0, blob});
        }
      }
    } catch {
      return;
    }
    const next: Asset[] = [];
    let changed = found.length !== current.length;
    for (const f of found.sort((a, b) => a.name.localeCompare(b.name))) {
      const old = current.find(a => a.name === f.name);
      if (old && old.modified === f.modified && old.size === f.blob.size) {
        next.push(old);
        continue;
      }
      changed = true;
      blobs.set(f.name, f.blob);
      next.push({name: f.name, size: f.blob.size, type: f.blob.type || soundType(f.name), url: URL.createObjectURL(f.blob), modified: f.modified});
    }
    if (!changed) return;
    const gone: string[] = [];
    for (const old of current) {
      if (next.includes(old)) continue;
      URL.revokeObjectURL(old.url);
      if (!next.some(a => a.name === old.name)) {
        blobs.delete(old.name);
        gone.push(old.name);
      }
    }
    const fresh = next.filter(a => !current.includes(a));
    current = next;
    setList(next);
    onChange(urls());
    // The browser keeps a copy of the folder's clips, so scenes still sound
    // while the folder waits to be reconnected after a reload.
    if (folder) {
      try {
        for (const name of gone) await idbDelete('assets', name);
        for (const a of fresh) {
          const blob = blobs.get(a.name);
          if (blob) await idbSet('assets', a.name, new Blob([await blob.arrayBuffer()], {type: a.type}));
        }
      } catch {
        // Only the copy is missing.
      }
    }
  };

  return {
    list,
    urls,
    refresh,
    /** Add (or replace) a clip. Returns the name scenes use for it. */
    async add(data: Blob, name: string): Promise<string> {
      const clean = assetName(name);
      if (!isSound(clean, data.type)) throw new Error(`"${name}" is not a sound file. Supported: mp3, wav, ogg, m4a, aac, flac, opus, webm.`);
      const blob = data.type ? data : new Blob([data], {type: soundType(clean)});
      if (folder) await folder.writeAsset(clean, blob);
      else await idbSet('assets', clean, blob);
      // A replaced file can keep its size; make sure it is read again.
      current = current.filter(a => a.name !== clean || (URL.revokeObjectURL(a.url), false));
      await refresh();
      return clean;
    },
    async remove(name: string): Promise<void> {
      if (folder) await folder.removeAsset(name);
      else await idbDelete('assets', name);
      await refresh();
    },
    /**
     * Follow the project folder (null: back to the browser). Connecting
     * copies the browser's clips into the folder; from then on the folder is
     * what counts, and the browser keeps a copy (see `refresh`).
     */
    async setFolder(next: Folder | null, bringClips = false): Promise<void> {
      if (next === folder) return refresh();
      try {
        // Only when the author just picked the folder: on a reconnect the
        // browser's clips are a copy, and a clip deleted on disk must stay deleted.
        if (next && bringClips) {
          const there = new Set((await next.assets()).map(a => a.name));
          for (const name of await idbKeys('assets')) {
            const blob = await idbGet<Blob>('assets', name);
            if (blob && !there.has(name)) await next.writeAsset(name, blob);
          }
        }
      } catch {
        // The clips stay where they were.
      }
      folder = next;
      await refresh();
    },
    blob: (name: string) => blobs.get(name),
    /** The clip as a `data:` URL, for packing into a web embed. */
    dataUrl(name: string): Promise<string | null> {
      const blob = blobs.get(name);
      if (!blob) return Promise.resolve(null);
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    },
  };
}

export type AssetStore = ReturnType<typeof createAssetStore>;
