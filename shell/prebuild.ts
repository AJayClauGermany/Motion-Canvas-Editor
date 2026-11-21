// Electrobun `preBuild` hook (see electrobun.config.ts). Hutch copies dist/
// into the app bundle as-is and does not complain when it is empty, which
// yields an app that only shows "File not found". Fail the build instead.
import {existsSync} from 'node:fs';

if (!existsSync('dist/index.html')) {
  console.error('shell: dist/index.html is missing. Build the web editor first: bun run build');
  process.exit(1);
}
