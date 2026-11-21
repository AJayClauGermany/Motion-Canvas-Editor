import civet from '@danielx/civet/vite';
import solid from '@solidjs/vite-plugin';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {examplesPlugin} from './tools/vite-examples.ts';

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
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  resolve: {
    alias: {manim: resolve(import.meta.dirname, 'src/manim/index.ts')},
  },
  build: {
    target: 'es2022',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input:
        mode === 'single'
          ? {index: resolve(import.meta.dirname, 'index.html')}
          : {index: resolve(import.meta.dirname, 'index.html'), harness: resolve(import.meta.dirname, 'harness.html')},
    },
  },
  server: {port: 5273, host: '127.0.0.1'},
  preview: {port: 5274, host: '127.0.0.1'},
}));
