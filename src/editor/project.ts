/**
 * Keeps the author's scenes and a folder on disk in step (`folder.ts`).
 *
 * The editor stays the place where scenes are edited, and keeps its own copy
 * in the browser; the folder mirrors it:
 *
 * - an edit is written to `<name>.<civet|tsx>` a moment later;
 * - a file changed, added or removed by something else (another editor, an AI
 *   agent working on the files) is picked up within a couple of seconds;
 * - when both sides changed while the folder was out of reach, the file wins
 *   and the editor's text is kept next to it as "… (unsaved copy)".
 *
 * The rules live in `sync`; the host applies them to the editor's state.
 */
import {revisionOf} from '../runtime/textdiff';
import type {Folder} from './folder';
import {safeFileName, SCENE_FILE} from './folder';

export interface SceneView {
  slug: string;
  name: string;
  language: 'civet' | 'tsx';
  text: string;
  /** The file this scene is saved in, once it has one. */
  file?: string;
  /** Edited in the editor since it was last written to the folder. */
  pending?: boolean;
  /** Fingerprint of the file's text when the editor last read or wrote it (survives a reload). */
  synced?: string;
}

export interface ProjectHost {
  /** The author's scenes as they are now. */
  scenes(): SceneView[];
  openSlug(): string;
  /** A file the editor does not know: add it as a scene. */
  adopt(file: string, text: string): void;
  /** A scene's file changed on disk: take its text. */
  reload(slug: string, text: string): void;
  /** A scene's file was renamed on disk: the scene takes the new name. */
  moved(slug: string, file: string): void;
  /** A scene's file is gone: remove the scene. */
  drop(slug: string): void;
  /**
   * Record where a scene is saved, whether it has edits waiting, and (when
   * given) the fingerprint of the file's text as the editor now knows it.
   */
  mark(slug: string, file: string | undefined, pending: boolean, synced?: string): void;
  /** The folder's state changed: connected, out of reach (`locked`), or none. */
  status(state: {name: string; locked: boolean} | null): void;
  /** Something the author should know. */
  notify(message: string): void;
}

const extension = (file: string) => (/\.tsx$/i.test(file) ? 'tsx' : 'civet');
const baseName = (file: string) => file.replace(SCENE_FILE, '');

/** The scene's name and language, from its file name. */
export const sceneOfFile = (file: string) => ({name: baseName(file), language: extension(file) as 'civet' | 'tsx'});

export function createProject(host: ProjectHost, options: {pollMs?: number; onPoll?: () => void} = {}) {
  let folder: Folder | null = null;
  let locked = false;
  /** What each file held when the editor last read or wrote it. */
  const known = new Map<string, {modified: number; text: string}>();
  const queued = new Set<string>();
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  /** One file operation at a time. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  const lock = (e: unknown) => {
    // The browser took the permission back (a reload, or the author revoked it).
    if (folder && !locked && /NotAllowed|Security|InvalidState/.test((e as Error)?.name ?? '')) {
      locked = true;
      host.status({name: folder.name, locked: true});
      return true;
    }
    return false;
  };

  /** A free file name for a scene. */
  const fileFor = (view: SceneView, taken: Set<string>) => {
    const base = safeFileName(view.name);
    const lower = new Set([...taken].map(n => n.toLowerCase()));
    for (let i = 1; ; i++) {
      const name = `${base}${i === 1 ? '' : ` ${i}`}.${view.language}`;
      if (name === view.file || !lower.has(name.toLowerCase())) return name;
    }
  };

  const write = async (view: SceneView, disk: Set<string>) => {
    if (!folder) return;
    const taken = new Set([...disk, ...host.scenes().filter(s => s.slug !== view.slug && s.file).map(s => s.file!)]);
    if (view.file) taken.delete(view.file);
    const file = fileFor(view, taken);
    const modified = await folder.write(file, view.text);
    known.set(file, {modified, text: view.text});
    disk.add(file);
    // Renamed, or switched between Civet and TSX: the old file goes.
    if (view.file && view.file !== file) {
      await folder.remove(view.file);
      known.delete(view.file);
      disk.delete(view.file);
    }
    host.mark(view.slug, file, false, revisionOf(view.text));
  };

  /** Bring the editor and the folder in step. */
  const sync = () =>
    serial(async () => {
      if (!folder || locked) return;
      try {
        const files = await folder.scenes();
        const disk = new Set(files.map(f => f.name));
        const byFile = new Map(host.scenes().filter(s => s.file).map(s => [s.file!, s]));
        for (const f of files) {
          const view = byFile.get(f.name);
          const before = known.get(f.name);
          if (view && before && before.modified === f.modified) continue;
          const {text, modified} = await folder.read(f.name);
          known.set(f.name, {modified, text});
          if (!view) {
            // The same text under a new name, and the old file gone: it was renamed.
            const renamed = host.scenes().find(s => s.file && !disk.has(s.file) && !s.pending && s.text === text);
            if (renamed) {
              known.delete(renamed.file!);
              host.moved(renamed.slug, f.name);
            } else host.adopt(f.name, text);
            continue;
          }
          if (text === view.text) {
            host.mark(view.slug, f.name, false, revisionOf(text));
          } else if (!view.pending) {
            host.reload(view.slug, text);
            host.mark(view.slug, f.name, false, revisionOf(text));
          } else if (before ? before.text === text : view.synced === revisionOf(text)) {
            // Only the editor changed: written below.
          } else {
            // Both changed while the folder was out of reach. The file wins; the editor's text is kept beside it.
            const copy = fileFor({...view, name: `${view.name} (unsaved copy)`, file: undefined}, disk);
            const m = await folder.write(copy, view.text);
            known.set(copy, {modified: m, text: view.text});
            disk.add(copy);
            host.adopt(copy, view.text);
            host.reload(view.slug, text);
            host.mark(view.slug, f.name, false, revisionOf(text));
            host.notify(`"${f.name}" changed on disk while you edited it here. The file was loaded; your version is kept as "${copy}".`);
          }
        }
        for (const view of host.scenes()) {
          if (view.file && !disk.has(view.file)) {
            known.delete(view.file);
            // Deleted on disk. The open scene and unsaved edits are not thrown away.
            if (view.pending || view.slug === host.openSlug()) await write({...view, file: undefined}, disk);
            else host.drop(view.slug);
          } else if (!view.file || view.pending) await write(view, disk);
        }
      } catch (e) {
        if (!lock(e)) throw e;
      }
    });

  const flush = () =>
    serial(async () => {
      const slugs = [...queued];
      queued.clear();
      if (!folder || locked) return;
      try {
        const disk = new Set((await folder.scenes()).map(f => f.name));
        for (const slug of slugs) {
          const view = host.scenes().find(s => s.slug === slug);
          if (view) await write(view, disk);
        }
      } catch (e) {
        if (!lock(e)) throw e;
      }
    });

  const startPolling = () => {
    clearInterval(pollTimer);
    const ms = options.pollMs ?? 2000;
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void sync().catch(() => {});
      options.onPoll?.();
    }, ms);
  };

  return {
    folder: () => (locked ? null : folder),
    /** The folder, even while it is out of reach. */
    remembered: () => folder,
    /**
     * Use `next` from now on. `fresh`: the author just picked it, so scenes
     * that belong to the folder used before are let go (they stay there).
     */
    async connect(next: Folder, fresh: boolean): Promise<void> {
      const switched = fresh && folder !== null && !(await next.same(folder));
      const firstTime = fresh && folder === null;
      const kept = folder !== null && !fresh;
      folder = next;
      locked = false;
      // What the editor knew about the files only holds for the folder it knew it about.
      if (!kept) known.clear();
      if (switched) {
        for (const view of host.scenes()) {
          if (!view.file) continue;
          if (view.pending) host.mark(view.slug, undefined, true);
          else host.drop(view.slug);
        }
      } else if (firstTime) {
        // Marks left from a folder that was disconnected mean nothing here.
        for (const view of host.scenes()) if (view.file) host.mark(view.slug, undefined, false);
      }
      host.status({name: next.name, locked: false});
      await sync();
      startPolling();
    },
    /** A folder is remembered but the browser wants a click before it may be used. */
    hold(next: Folder) {
      folder = next;
      locked = true;
      host.status({name: next.name, locked: true});
    },
    /** Stop using the folder. The scenes stay in the browser, and the files stay on disk. */
    disconnect() {
      clearInterval(pollTimer);
      clearTimeout(writeTimer);
      queued.clear();
      folder = null;
      locked = false;
      known.clear();
      for (const view of host.scenes()) if (view.file || view.pending) host.mark(view.slug, undefined, false);
      host.status(null);
    },
    /** A scene was edited, renamed or created: write it soon. */
    changed(slug: string) {
      if (!folder) return;
      if (locked) {
        const view = host.scenes().find(s => s.slug === slug);
        if (view && !view.pending) host.mark(slug, view.file, true);
        return;
      }
      queued.add(slug);
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => void flush().catch(() => {}), 300);
    },
    /** A scene was deleted in the editor: delete its file. */
    removed(file: string | undefined) {
      if (!folder || locked || !file) return Promise.resolve();
      known.delete(file);
      return serial(() => folder!.remove(file)).catch(e => void lock(e));
    },
    sync,
    flush,
  };
}

export type Project = ReturnType<typeof createProject>;
