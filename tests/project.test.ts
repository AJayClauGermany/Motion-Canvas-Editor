import {describe, expect, test} from 'bun:test';
import {safeFileName} from '../src/editor/folder';
import type {Folder} from '../src/editor/folder';
import {createProject, ProjectHost, sceneOfFile, SceneView} from '../src/editor/project';
import {assetKey, resolveAsset, setAssetUrls, takeMissingAssets, usedAssets} from '../src/runtime/assets';

/** A folder in memory, with a clock that moves on every write. `insensitive`: names differing only in case are one file, as on macOS and Windows. */
function fakeFolder(files: Record<string, string> = {}, insensitive = false) {
  let clock = 1000;
  const key = (name: string) => (insensitive ? name.toLowerCase() : name);
  const disk = new Map(Object.entries(files).map(([name, text]) => [key(name), {name, text, modified: clock++}]));
  let denied: string | null = null;
  const check = () => {
    if (denied) throw Object.assign(new Error('no'), {name: denied});
  };
  const put = (name: string, text: string) => {
    // An existing file keeps the spelling it was created with.
    disk.set(key(name), {name: disk.get(key(name))?.name ?? name, text, modified: clock++});
  };
  const folder = {
    name: 'project',
    async scenes() {
      check();
      return [...disk.values()].filter(f => /\.(civet|tsx)$/i.test(f.name)).map(f => ({name: f.name, modified: f.modified, size: f.text.length}));
    },
    async read(name: string) {
      check();
      const f = disk.get(key(name))!;
      return {text: f.text, modified: f.modified};
    },
    async write(name: string, text: string) {
      check();
      put(name, text);
      return disk.get(key(name))!.modified;
    },
    async remove(name: string) {
      check();
      disk.delete(key(name));
    },
    async same(other: unknown) {
      return other === folder;
    },
  } as unknown as Folder;
  return {
    folder,
    /** Something other than the editor writes a file. */
    outside(name: string, text: string | null) {
      if (text === null) disk.delete(key(name));
      else put(name, text);
    },
    /** Make every file operation fail with an error of this name (`null`: work again). */
    fail(name: string | null) {
      denied = name;
    },
    deny(value: boolean) {
      denied = value ? 'NotAllowedError' : null;
    },
    files: () => Object.fromEntries([...disk.values()].map(f => [f.name, f.text])),
  };
}

/** The editor's side, as plain data. */
function fakeEditor(initial: SceneView[] = []) {
  let scenes = initial.map(s => ({...s}));
  let open = scenes[0]?.slug ?? '';
  let n = 0;
  const log: string[] = [];
  const state: {status: {name: string; locked: boolean} | null} = {status: null};
  const host: ProjectHost = {
    scenes: () => scenes.map(s => ({...s})),
    openSlug: () => open,
    adopt(file, text) {
      scenes.push({slug: `new${++n}`, ...sceneOfFile(file), text, file});
      log.push(`adopt ${file}`);
    },
    reload(slug, text) {
      scenes.find(s => s.slug === slug)!.text = text;
      log.push(`reload ${slug}`);
    },
    moved(slug, file) {
      Object.assign(scenes.find(s => s.slug === slug)!, {file, name: sceneOfFile(file).name});
      log.push(`moved ${slug} ${file}`);
    },
    drop(slug) {
      scenes = scenes.filter(s => s.slug !== slug);
      log.push(`drop ${slug}`);
    },
    mark(slug, file, pending, synced) {
      const s = scenes.find(s => s.slug === slug)!;
      Object.assign(s, {file, pending, synced: synced ?? s.synced});
    },
    status: s => (state.status = s),
    notify: m => log.push(`notify ${m}`),
  };
  return {
    host,
    log,
    state,
    get: (slug: string) => scenes.find(s => s.slug === slug),
    all: () => scenes,
    edit(slug: string, patch: Partial<SceneView>) {
      Object.assign(scenes.find(s => s.slug === slug)!, patch);
    },
    setOpen: (slug: string) => (open = slug),
  };
}

const scene = (slug: string, name: string, text: string, extra: Partial<SceneView> = {}): SceneView => ({slug, name, language: 'civet', text, ...extra});

describe('project folder', () => {
  test('connecting writes the scenes that only lived in the browser', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one'), scene('b', 'Demo: part 2', 'two', {language: 'tsx'})]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    expect(f.files()).toEqual({'Intro.civet': 'one', 'Demo part 2.tsx': 'two'});
    expect(ed.get('a')!.file).toBe('Intro.civet');
    expect(ed.state.status).toEqual({name: 'project', locked: false});
    project.disconnect();
    expect(ed.state.status).toBeNull();
    expect(ed.get('a')!.file).toBeUndefined();
    expect(f.files()['Intro.civet']).toBe('one');
  });

  test('files already in the folder become scenes, and names do not collide', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'mine')]);
    const f = fakeFolder({'intro.civet': 'theirs', 'Other.tsx': 'x', 'notes.txt': 'ignored'});
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    expect(ed.log).toContain('adopt intro.civet');
    expect(ed.log).toContain('adopt Other.tsx');
    // The browser scene keeps its text under a free file name.
    expect(ed.get('a')!.file).toBe('Intro 2.civet');
    expect(f.files()['intro.civet']).toBe('theirs');
    expect(f.files()['Intro 2.civet']).toBe('mine');
    project.disconnect();
  });

  test('an edit is written, a rename moves the file, a language switch changes the extension', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    ed.edit('a', {text: 'two'});
    project.changed('a');
    await project.flush();
    expect(f.files()).toEqual({'Intro.civet': 'two'});
    ed.edit('a', {name: 'Opening'});
    project.changed('a');
    await project.flush();
    expect(f.files()).toEqual({'Opening.civet': 'two'});
    ed.edit('a', {language: 'tsx', text: 'three'});
    project.changed('a');
    await project.flush();
    expect(f.files()).toEqual({'Opening.tsx': 'three'});
    await project.removed(ed.get('a')!.file);
    expect(f.files()).toEqual({});
    project.disconnect();
  });

  test('changes made outside the editor are picked up', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one'), scene('b', 'Second', 'two')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    ed.log.length = 0;
    await project.sync();
    expect(ed.log).toEqual([]);

    f.outside('Intro.civet', 'edited by an agent');
    f.outside('Fresh.civet', 'new file');
    await project.sync();
    expect(ed.get('a')!.text).toBe('edited by an agent');
    expect(ed.all().some(s => s.file === 'Fresh.civet')).toBe(true);

    // A scene that is not open goes when its file goes; the open one is written back.
    f.outside('Second.civet', null);
    f.outside('Intro.civet', null);
    await project.sync();
    expect(ed.get('b')).toBeUndefined();
    expect(ed.get('a')).toBeDefined();
    expect(f.files()['Intro.civet']).toBe('edited by an agent');

    // A rename on disk is a rename, not a delete and a new scene.
    ed.setOpen('a');
    const fresh = ed.all().find(s => s.file === 'Fresh.civet')!;
    f.outside('Fresh.civet', null);
    f.outside('Renamed.civet', 'new file');
    await project.sync();
    expect(ed.get(fresh.slug)).toMatchObject({name: 'Renamed', file: 'Renamed.civet'});
    project.disconnect();
  });

  test('while the folder is out of reach edits wait, and a conflict keeps both versions', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one'), scene('b', 'Second', 'two')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);

    // After a reload the browser wants a click first.
    project.hold(f.folder);
    expect(ed.state.status).toEqual({name: 'project', locked: true});
    expect(project.folder()).toBeNull();
    ed.edit('a', {text: 'one, edited here'});
    project.changed('a');
    ed.edit('b', {text: 'two, edited here'});
    project.changed('b');
    expect(ed.get('a')!.pending).toBe(true);
    f.outside('Second.civet', 'two, edited on disk');

    // A reload: a new project object, which knows only what the scenes recorded.
    project.disconnect = () => {};
    const reloaded = createProject(ed.host, {pollMs: 1e9});
    reloaded.hold(f.folder);
    await reloaded.connect(f.folder, false);
    // Only the editor changed: the edit is written.
    expect(f.files()['Intro.civet']).toBe('one, edited here');
    // Both changed: the file wins, the editor's text is kept beside it.
    expect(ed.get('b')!.text).toBe('two, edited on disk');
    expect(f.files()['Second (unsaved copy).civet']).toBe('two, edited here');
    expect(ed.log.some(l => l.startsWith('notify'))).toBe(true);
    expect(ed.all().every(s => !s.pending)).toBe(true);
    reloaded.disconnect();
  });

  test('a permission taken back locks the folder instead of losing edits', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    f.deny(true);
    ed.edit('a', {text: 'two'});
    project.changed('a');
    await project.flush();
    expect(ed.state.status).toEqual({name: 'project', locked: true});
    project.changed('a');
    expect(ed.get('a')!.pending).toBe(true);
    f.deny(false);
    await project.connect(f.folder, false);
    expect(f.files()['Intro.civet']).toBe('two');
    project.disconnect();
  });

  test('picking another folder leaves the first one alone', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one')]);
    const first = fakeFolder();
    const second = fakeFolder({'Other.civet': 'other'});
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(first.folder, true);
    await project.connect(second.folder, true);
    expect(first.files()).toEqual({'Intro.civet': 'one'});
    expect(second.files()).toEqual({'Other.civet': 'other'});
    expect(ed.all().map(s => s.file)).toEqual(['Other.civet']);
    project.disconnect();
  });

  test('an edit that never reached the disk is written at the next chance, not replaced by the old file', async () => {
    // The tab is closed before the write runs.
    const ed = fakeEditor([scene('a', 'Intro', 'one')]);
    const f = fakeFolder();
    const first = createProject(ed.host, {pollMs: 1e9});
    await first.connect(f.folder, true);
    ed.edit('a', {text: 'two, typed just before closing'});
    first.changed('a');
    expect(ed.get('a')!.pending).toBe(true);
    const second = createProject(ed.host, {pollMs: 1e9});
    await second.connect(f.folder, false);
    expect(ed.get('a')!.text).toBe('two, typed just before closing');
    expect(f.files()).toEqual({'Intro.civet': 'two, typed just before closing'});

    // A write fails for a reason that is not a permission (the drive went away).
    f.fail('NotFoundError');
    ed.edit('a', {text: 'three'});
    second.changed('a');
    await second.flush().catch(() => {});
    expect(ed.get('a')!.pending).toBe(true);
    f.fail(null);
    const third = createProject(ed.host, {pollMs: 1e9});
    await third.connect(f.folder, false);
    expect(ed.get('a')!.text).toBe('three');
    expect(f.files()).toEqual({'Intro.civet': 'three'});
    first.disconnect = second.disconnect = () => {};
    third.disconnect();
  });

  test('a file changed outside while the author types is not overwritten', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    f.outside('Intro.civet', 'rewritten by an agent');
    ed.edit('a', {text: 'one, and typed'});
    project.changed('a');
    await project.flush();
    expect(f.files()['Intro.civet']).toBe('rewritten by an agent');
    expect(f.files()['Intro (unsaved copy).civet']).toBe('one, and typed');
    expect(ed.get('a')!.text).toBe('rewritten by an agent');
    project.disconnect();
  });

  test('a rename that only changes the case keeps the file where names are case-insensitive', async () => {
    for (const insensitive of [true, false]) {
      const ed = fakeEditor([scene('a', 'intro', 'one')]);
      const f = fakeFolder({'Other.TSX': 'x'}, insensitive);
      const project = createProject(ed.host, {pollMs: 1e9});
      await project.connect(f.folder, true);
      ed.edit('a', {name: 'Intro'});
      project.changed('a');
      await project.flush();
      expect(f.files()['Intro.civet']).toBe('one');
      expect(Object.keys(f.files()).filter(n => /intro/i.test(n))).toEqual(['Intro.civet']);
      // An adopted file whose extension is spelled in capitals survives its first edit.
      const other = ed.all().find(s => s.file === 'Other.TSX')!;
      ed.edit(other.slug, {text: 'y'});
      project.changed(other.slug);
      await project.flush();
      expect(Object.entries(f.files()).filter(([n]) => /^other\./i.test(n))).toEqual([['Other.tsx', 'y']]);
      await project.sync();
      expect(ed.get('a')).toBeDefined();
      expect(ed.get(other.slug)).toBeDefined();
      project.disconnect();
    }
  });

  test('a scene that came from the folder is not a conflict when it is edited while the folder is locked', async () => {
    const ed = fakeEditor();
    const f = fakeFolder({'Intro.civet': 'one'});
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    const adopted = ed.all()[0];
    ed.setOpen(adopted.slug);
    const reloaded = createProject(ed.host, {pollMs: 1e9});
    reloaded.hold(f.folder);
    ed.edit(adopted.slug, {text: 'one, edited while locked'});
    reloaded.changed(adopted.slug);
    await reloaded.connect(f.folder, false);
    expect(f.files()).toEqual({'Intro.civet': 'one, edited while locked'});
    expect(ed.log.some(l => l.startsWith('notify'))).toBe(false);
    project.disconnect = () => {};
    reloaded.disconnect();
  });

  test('leaving a folder and picking it again does not duplicate the scenes', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one'), scene('b', 'Second', 'two')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    project.disconnect();
    await project.connect(f.folder, true);
    expect(f.files()).toEqual({'Intro.civet': 'one', 'Second.civet': 'two'});
    expect(ed.all().map(s => s.file).sort()).toEqual(['Intro.civet', 'Second.civet']);
    project.disconnect();
  });

  test('a scene deleted while the folder is locked loses its file on reconnect', async () => {
    const ed = fakeEditor([scene('a', 'Intro', 'one'), scene('b', 'Second', 'two')]);
    const f = fakeFolder();
    const project = createProject(ed.host, {pollMs: 1e9});
    await project.connect(f.folder, true);
    project.hold(f.folder);
    const file = ed.get('b')!.file;
    ed.host.drop('b');
    await project.removed(file);
    await project.connect(f.folder, false);
    expect(f.files()).toEqual({'Intro.civet': 'one'});
    expect(ed.all().map(s => s.slug)).toEqual(['a']);
    project.disconnect();
  });

  test('scene names become file names without what a file system refuses', () => {
    expect(safeFileName('My first scene')).toBe('My first scene');
    expect(safeFileName('a/b: c?')).toBe('ab c');
    expect(safeFileName('..hidden.')).toBe('hidden');
    expect(safeFileName('///')).toBe('Untitled');
    expect(sceneOfFile('Intro.tsx')).toEqual({name: 'Intro', language: 'tsx'});
  });
});

describe('assets by name', () => {
  test('a name resolves to its URL, however the scene spells the path', () => {
    setAssetUrls({'click.mp3': 'blob:1', 'Tone.wav': 'blob:2'});
    expect(resolveAsset('click.mp3')).toBe('blob:1');
    expect(resolveAsset('./assets/click.mp3')).toBe('blob:1');
    expect(resolveAsset('tone.WAV')).toBe('blob:2');
    expect(assetKey('/assets/a.mp3')).toBe('a.mp3');
    expect(takeMissingAssets()).toEqual([]);
  });
  test('URLs pass through and unknown names are reported once', () => {
    setAssetUrls({});
    expect(resolveAsset('https://example.com/a.mp3')).toBe('https://example.com/a.mp3');
    expect(resolveAsset('data:audio/wav;base64,AAAA')).toContain('data:');
    expect(resolveAsset('nope.wav')).toBe('nope.wav');
    expect(takeMissingAssets()).toEqual(['nope.wav']);
    expect(takeMissingAssets()).toEqual([]);
  });
  test('only the clips a scene names are packed with it', () => {
    expect(usedAssets('@add_sound "Click.mp3"', ['click.mp3', 'tone.wav'])).toEqual(['click.mp3']);
  });
});
