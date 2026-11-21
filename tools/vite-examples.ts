/**
 * Vite plugin: exposes the `examples/` directory as `virtual:examples`.
 *
 * Example scenes are *data* for the editor (it compiles them in the browser),
 * so they must not go through the Civet Vite plugin, which claims every
 * `.civet` import regardless of `?raw`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

const ID = 'virtual:examples';
const RESOLVED = '\0' + ID;

export function examplesPlugin(dir: string): Plugin {
  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
  return {
    name: 'mce:examples',
    resolveId(source) {
      return source === ID ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return;
      const list = [];
      for (const slug of fs.readdirSync(dir).sort()) {
        const base = path.join(dir, slug);
        const code = read(path.join(base, 'scene.civet'));
        if (code === undefined) continue;
        for (const f of ['scene.civet', 'manim.py', 'original.tsx', 'meta.json']) {
          if (fs.existsSync(path.join(base, f))) this.addWatchFile(path.join(base, f));
        }
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(read(path.join(base, 'meta.json')) ?? '{}');
        } catch (e) {
          this.warn(`examples/${slug}/meta.json: ${(e as Error).message}`);
        }
        list.push({slug, code, python: read(path.join(base, 'manim.py')), tsx: read(path.join(base, 'original.tsx')), meta});
      }
      return `export default ${JSON.stringify(list)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const refresh = (file: string) => {
        if (!file.startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({type: 'full-reload'});
      };
      server.watcher.on('add', refresh);
      server.watcher.on('change', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}
