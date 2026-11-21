/**
 * Turn the single-file build (`bun run build:single`) into a page body that
 * can be published as a claude.ai Artifact: the host wraps the file in its own
 * <html>/<head>/<body>, so only the title, style, mount point and script remain.
 *
 *   bun run build:single && bun tools/make-artifact.ts [out.html]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist-single/index.html'), 'utf8');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist-single/artifact.html'));

const script = /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1];
if (!script || !style) throw new Error('dist-single/index.html does not look like a single-file build');
const guard = /<script data-boot-guard>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

fs.writeFileSync(
  out,
  `<title>Motion Canvas Editor</title>
<style>
html, body { height: 100%; }
body { background: #0b0e14; }
${style}
</style>
<div id="app"></div>
<script>${guard}</script>
<script type="module">${script}</script>
`,
);
console.log(`${path.relative(root, out)}  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
