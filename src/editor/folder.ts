/**
 * A folder on disk for the author's scenes, through the browser's File System
 * Access API (Chromium; not Safari, Firefox or the desktop webviews yet):
 *
 *   <folder>/My scene.civet     one file per scene, in the root
 *   <folder>/assets/click.mp3   sound clips the scenes use
 *   <folder>/exports/…          what Export writes
 *
 * This module is only the file access; `project.ts` keeps the editor and the
 * folder in step.
 */
import {idbDelete, idbGet, idbSet} from './idb';

export const folderSupported = () => typeof (globalThis as any).showDirectoryPicker === 'function';

export const SCENE_FILE = /\.(civet|tsx)$/i;
export const SOUND_FILE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|webm)$/i;

export interface DiskFile {
  name: string;
  /** Milliseconds since the epoch. */
  modified: number;
  size: number;
}

/** A scene name as a file name: only what a file system refuses is removed. */
export function safeFileName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return clean || 'Untitled';
}

const HANDLE_KEY = 'folder';

export class Folder {
  public constructor(public readonly handle: FileSystemDirectoryHandle) {}

  public get name(): string {
    return this.handle.name;
  }

  private async list(dir: FileSystemDirectoryHandle, pattern: RegExp): Promise<(DiskFile & {file: File})[]> {
    const out: (DiskFile & {file: File})[] = [];
    for await (const [name, entry] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (entry.kind !== 'file' || name.startsWith('.') || !pattern.test(name)) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      out.push({name, modified: file.lastModified, size: file.size, file});
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  private async sub(name: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.handle.getDirectoryHandle(name, {create});
    } catch (e) {
      if (!create && (e as Error).name === 'NotFoundError') return null;
      throw e;
    }
  }
  private async put(dir: FileSystemDirectoryHandle, name: string, data: string | Blob): Promise<number> {
    const handle = await dir.getFileHandle(name, {create: true});
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return (await handle.getFile()).lastModified;
  }
  private async del(dir: FileSystemDirectoryHandle | null, name: string) {
    try {
      await dir?.removeEntry(name);
    } catch (e) {
      if ((e as Error).name !== 'NotFoundError') throw e;
    }
  }

  /** The scene files in the folder's root. */
  public scenes(): Promise<DiskFile[]> {
    return this.list(this.handle, SCENE_FILE);
  }
  public async read(name: string): Promise<{text: string; modified: number}> {
    const file = await (await this.handle.getFileHandle(name)).getFile();
    return {text: await file.text(), modified: file.lastModified};
  }
  /** Returns the file's new modification time. */
  public write(name: string, text: string): Promise<number> {
    return this.put(this.handle, name, text);
  }
  public remove(name: string): Promise<void> {
    return this.del(this.handle, name);
  }

  public async assets(): Promise<(DiskFile & {file: File})[]> {
    const dir = await this.sub('assets', false);
    return dir ? this.list(dir, SOUND_FILE) : [];
  }
  public async writeAsset(name: string, data: Blob): Promise<void> {
    await this.put((await this.sub('assets', true))!, name, data);
  }
  public async removeAsset(name: string): Promise<void> {
    await this.del(await this.sub('assets', false), name);
  }

  /** Save an exported file; returns where, relative to the folder's parent. */
  public async writeExport(name: string, data: Blob): Promise<string> {
    await this.put((await this.sub('exports', true))!, name, data);
    return `${this.name}/exports/${name}`;
  }

  /** Whether the page may write here now (`ask`: with a prompt, which needs a click). */
  public async allowed(ask: boolean): Promise<boolean> {
    const handle = this.handle as any;
    const options = {mode: 'readwrite'};
    try {
      if ((await handle.queryPermission?.(options)) === 'granted') return true;
      return ask ? (await handle.requestPermission?.(options)) === 'granted' : false;
    } catch {
      return false;
    }
  }

  public async same(other: Folder | null): Promise<boolean> {
    return !!other && (await this.handle.isSameEntry(other.handle));
  }
}

/** Ask the author for a folder. Rejects with an `AbortError` when they cancel. */
export async function pickFolder(): Promise<Folder> {
  const handle: FileSystemDirectoryHandle = await (globalThis as any).showDirectoryPicker({id: 'mce-project', mode: 'readwrite'});
  return new Folder(handle);
}

/** The folder used last time, if the browser still has it. */
export async function rememberedFolder(): Promise<Folder | null> {
  try {
    const handle = await idbGet<FileSystemDirectoryHandle>('kv', HANDLE_KEY);
    return handle ? new Folder(handle) : null;
  } catch {
    return null;
  }
}

export async function rememberFolder(folder: Folder | null): Promise<void> {
  try {
    if (folder) await idbSet('kv', HANDLE_KEY, folder.handle);
    else await idbDelete('kv', HANDLE_KEY);
  } catch {
    // Without IndexedDB the folder has to be picked again after a reload.
  }
}
