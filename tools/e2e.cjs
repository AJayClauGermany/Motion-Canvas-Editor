#!/usr/bin/env node
/**
 * Render every example in headless Chromium and write a contact sheet per
 * example to artifacts/e2e/. Fails if any example reports a diagnostic.
 *
 *   node tools/e2e.cjs                 # all examples
 *   node tools/e2e.cjs square moving   # only slugs containing these words
 *   node tools/e2e.cjs path/to/file.civet
 *
 * A native example's `original.tsx` is rendered too, in TSX mode. Every scene is
 * also converted to the other language (Civet → TSX, TSX → Civet) and must run
 * with the same steps and duration.
 *
 * Starts a Vite dev server unless one is already listening on E2E_URL.
 */
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const base = process.env.E2E_URL || 'http://127.0.0.1:5273';
const outDir = path.join(root, 'artifacts', 'e2e');

async function up() {
  try {
    return (await fetch(base + '/harness.html')).ok;
  } catch {
    return false;
  }
}

(async () => {
  let server = null;
  if (!(await up())) {
    server = spawn('bunx', ['vite'], {cwd: root, stdio: 'ignore', detached: true});
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise(r => setTimeout(r, 200));
  }
  const filters = process.argv.slice(2);
  const files = [];
  for (const f of filters.filter(f => f.endsWith('.civet'))) files.push({slug: path.basename(f, '.civet'), file: path.resolve(f)});
  const words = filters.filter(f => !f.endsWith('.civet'));
  if (files.length === 0) {
    const dir = path.join(root, 'examples');
    for (const slug of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, slug, 'scene.civet');
      if (!fs.existsSync(file)) continue;
      if (words.length && !words.some(w => slug.includes(w))) continue;
      files.push({slug, file});
      // Native examples also ship the TSX they were ported from; it must run as is.
      const tsx = path.join(dir, slug, 'original.tsx');
      if (fs.existsSync(tsx)) files.push({slug: `${slug}.tsx`, file: tsx, options: {language: 'tsx'}});
    }
  }
  fs.mkdirSync(outDir, {recursive: true});
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 980, height: 560}});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => m.type() === 'error' && pageErrors.push(m.text()));
  await page.goto(base + '/harness.html');
  await page.waitForFunction(() => window.harness, null, {timeout: 120000});
  let failed = 0;
  for (const {slug, file, options} of files) {
    pageErrors.length = 0;
    const source = fs.readFileSync(file, 'utf8');
    const result = await page.evaluate(([s, o]) => window.harness.run(s, o), [source, options ?? {}]);
    const info = await page.evaluate(() => window.harness.info());
    const problems = [...(result.diagnostics || []), ...(info.diagnostics || [])];
    const seen = new Set();
    const unique = problems.filter(d => !seen.has(JSON.stringify(d)) && seen.add(JSON.stringify(d)));
    if (result.ok) {
      const dataUrl = await page.evaluate(() => window.harness.sheet(8, 4));
      fs.writeFileSync(path.join(outDir, `${slug}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    const after = await page.evaluate(() => window.harness.info());
    for (const d of after.diagnostics || []) {
      if (!seen.has(JSON.stringify(d))) unique.push(d), seen.add(JSON.stringify(d));
    }
    // Parity: the same scene converted to the other language must run the same.
    // A Civet scene is converted to TSX; a shipped TSX original back to Civet.
    if (result.ok && unique.length === 0 && !file.endsWith('original.tsx') === !options) {
      const toTsx = !options;
      const converted = await page.evaluate(([s, t]) => (t ? window.harness.toTsx(s) : window.harness.toCivet(s)), [source, toTsx]);
      if (!converted.ok) {
        // TSX → Civet is best-effort and may decline; Civet → TSX may not.
        if (toTsx) unique.push({stage: 'convert', message: `Civet → TSX failed: ${converted.notes.join(' ')}`});
      } else {
        const again = await page.evaluate(([s, o]) => window.harness.run(s, o), [converted.code, toTsx ? {language: 'tsx'} : {implicitYield: false}]);
        const info2 = await page.evaluate(() => window.harness.info());
        const first = [...(again.diagnostics || []), ...(info2.diagnostics || [])][0];
        const label = toTsx ? 'as TSX' : 'as Civet';
        if (!again.ok || first) unique.push({stage: 'convert', message: `${label}: ${first ? first.message : 'did not run'}`, line: first && first.line});
        else if (info.timeline && info2.timeline) {
          const a = `${info.timeline.segments.length} steps, ${info.timeline.duration.toFixed(2)}s`;
          const b = `${info2.timeline.segments.length} steps, ${info2.timeline.duration.toFixed(2)}s`;
          if (a !== b) unique.push({stage: 'convert', message: `${label} it runs differently: ${b} instead of ${a}`});
        }
      }
    }
    const ok = result.ok && unique.length === 0;
    if (!ok) failed++;
    const secs = info.timeline ? info.timeline.duration.toFixed(1) + 's' : '-';
    const steps = info.timeline ? info.timeline.segments.length : 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${slug.padEnd(34)} ${secs.padStart(6)} ${String(steps).padStart(3)} steps`);
    for (const d of unique) console.log(`       ${d.stage}${d.line ? ` line ${d.line}` : ''}: ${d.message}`);
    for (const e of pageErrors) console.log(`       page: ${e.slice(0, 300)}`);
  }
  await browser.close();
  if (server) process.kill(-server.pid);
  console.log(failed ? `${failed} failed` : `all ${files.length} passed`, `→ ${path.relative(root, outDir)}/`);
  process.exit(failed ? 1 : 0);
})();
