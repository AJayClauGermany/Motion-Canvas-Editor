/**
 * Makes `player-template.html` available to the editor: the web embed player
 * (`player.html`) built as one self-contained file, which the "Web embed"
 * export fills with a scene.
 *
 * - `vite build`: builds the player (mode `player`) after the editor and copies
 *   it into the output directory.
 * - `vite` (dev): builds it on the first request and serves it.
 */
import {copyFileSync, existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build, type Plugin} from 'vite';

export const PLAYER_TEMPLATE = 'player-template.html';

export function playerTemplatePlugin(root: string): Plugin {
  const built = resolve(root, 'dist-player/player.html');
  let outDir = resolve(root, 'dist');
  let building: Promise<unknown> | null = null;
  const buildPlayer = () => (building ??= build({root, configFile: resolve(root, 'vite.config.ts'), mode: 'player', logLevel: 'warn'}));
  return {
    name: 'mce-player-template',
    configResolved(config) {
      outDir = resolve(root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== `/${PLAYER_TEMPLATE}`) return next();
        try {
          await buildPlayer();
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(readFileSync(built));
        } catch (e) {
          building = null;
          res.statusCode = 500;
          res.end(`The embed player could not be built: ${(e as Error).message}`);
        }
      });
    },
    async closeBundle() {
      if (this.meta.watchMode || !existsSync(outDir)) return;
      await buildPlayer();
      copyFileSync(built, resolve(outDir, PLAYER_TEMPLATE));
    },
  };
}
