import civet from '@danielx/civet/vite';
import solid from '@solidjs/vite-plugin';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {examplesPlugin} from './tools/vite-examples.ts';
import {playerTemplatePlugin} from './tools/vite-player.ts';

// The editor compiles scenes in the browser (src/runtime/compile.ts), so the
// Canvas Commons Vite plugin is not needed here. Civet stays first so `.civet`
// modules can be imported by app code; Solid's compiler is scoped to the
// editor UI and never sees scene files.
export default defineConfig(({mode}) => ({
  base: './',
  plugins: [
    examplesPlugin(resolve(import.meta.dirname, 'examples')),
    civet({ts: 'preserve'}),
    solid({include: ['src/editor/**']}),
    // `player`: the web embed (player.html) as one self-contained file. The
    // editor build makes it too and ships it as player-template.html.
    ...(mode === 'single' || mode === 'player' ? [viteSingleFile()] : [playerTemplatePlugin(import.meta.dirname)]),
  ],
  resolve: {
    alias: {manim: resolve(import.meta.dirname, 'src/manim/index.ts')},
  },
  // Imported on demand by an export; discovering them then would reload the page mid-render.
  optimizeDeps: {include: ['mediabunny', 'gifenc']},
  build: {
    target: 'es2022',
    outDir: mode === 'single' ? 'dist-single' : mode === 'player' ? 'dist-player' : 'dist',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: (mode === 'player'
        ? {player: resolve(import.meta.dirname, 'player.html')}
        : {
            index: resolve(import.meta.dirname, 'index.html'),
            ...(mode === 'single' ? {} : {harness: resolve(import.meta.dirname, 'harness.html')}),
          }) as Record<string, string>,
    },
  },
  server: {port: 5273, host: '127.0.0.1'},
  preview: {port: 5274, host: '127.0.0.1'},
}));
