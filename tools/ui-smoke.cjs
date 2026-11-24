#!/usr/bin/env node
/**
 * UI smoke test: drives the editor in headless Chromium, checks the main
 * interactions and writes screenshots to artifacts/ui/.
 *
 *   node tools/ui-smoke.cjs            # needs a server on E2E_URL (default: the Vite dev server)
 */
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.E2E_URL || 'http://127.0.0.1:5273';
const out = path.resolve(__dirname, '..', 'artifacts', 'ui');
fs.mkdirSync(out, {recursive: true});

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({name, ok});
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: Number(process.env.DPR || 1)});
  const problems = [];
  page.on('console', m => {
    if (!['error', 'warning'].includes(m.type())) return;
    // Autoplay starts before any user gesture; the (muted) audio context warning is expected.
    if (/AudioContext was not allowed to start/.test(m.text())) return;
    problems.push(`[${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message.slice(0, 400)}`));
  const shot = name => page.screenshot({path: path.join(out, `${name}.png`)});
  const settle = (ms = 500) => page.waitForTimeout(ms);

  // A project folder is picked in a system dialog, which a headless browser does not have:
  // the browser's private file system stands in for it (same handle API).
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('my-project', {create: true});
    // A real folder needs the user's OK again after a reload; the test decides when.
    const query = FileSystemHandle.prototype.queryPermission;
    FileSystemHandle.prototype.queryPermission = function (options) {
      return sessionStorage.getItem('lockFolder') ? Promise.resolve('prompt') : query.call(this, options);
    };
    FileSystemHandle.prototype.requestPermission = function () {
      sessionStorage.removeItem('lockFolder');
      return Promise.resolve('granted');
    };
  });
  /** The folder's files: text, or a size for anything large or binary. */
  const disk = () =>
    page.evaluate(async () => {
      const files = {};
      const walk = async (dir, prefix) => {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind !== 'file') await walk(handle, `${prefix}${name}/`);
          else {
            const file = await handle.getFile();
            files[prefix + name] = /\.(civet|tsx)$/.test(name) ? await file.text() : file.size;
          }
        }
      };
      await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('my-project', {create: true}), '');
      return files;
    });
  /** Something other than the editor changes the folder (another editor, an agent). */
  const outside = (name, text) =>
    page.evaluate(
      async ([name, text]) => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('my-project', {create: true});
        if (text === null) return dir.removeEntry(name);
        const writable = await (await dir.getFileHandle(name, {create: true})).createWritable();
        await writable.write(text);
        await writable.close();
      },
      [name, text],
    );
  /** A short sine tone as a WAV file. */
  const tone = (seconds, hz) => {
    const rate = 22050;
    const n = Math.round(seconds * rate);
    const data = Buffer.alloc(44 + n * 2);
    data.write('RIFF', 0);
    data.writeUInt32LE(36 + n * 2, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(rate, 24);
    data.writeUInt32LE(rate * 2, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000), 44 + i * 2);
    return data;
  };

  // First launch: a scene of the author's own, ready to write in.
  await page.goto(base + '/');
  await page.waitForSelector('.block', {timeout: 60000});
  const sceneName = () => page.locator('.file-tab .scene-name').inputValue();
  const picked = () => page.locator('.scene-select').evaluate(el => el.selectedOptions[0]?.textContent.trim());
  check('first launch opens a new scene of your own', (await sceneName()) === 'Untitled' && (await page.locator('.block').count()) === 2 && /Ready/.test(await page.locator('.status').innerText()));
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n@play FadeOut title\n');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 10000}).catch(() => {});
  await page.locator('.file-tab .scene-name').fill('My first scene');
  await page.keyboard.press('Enter');
  await settle(200);
  check('a scene can be renamed in place', (await picked()) === 'My first scene', await picked());
  await shot('00-first-launch');

  // Export: one button, defaults that work, Enter.
  const exported = async kind => {
    await page.locator('.export-kinds button').filter({has: page.locator('b', {hasText: new RegExp(`^${kind}$`)})}).click();
    const [download] = await Promise.all([page.waitForEvent('download', {timeout: 120000}), page.keyboard.press('Enter')]);
    const file = path.join(out, `export-${download.suggestedFilename()}`);
    await download.saveAs(file);
    await page.waitForSelector('.export-done', {timeout: 10000}).catch(() => {});
    return {name: download.suggestedFilename(), bytes: fs.readFileSync(file)};
  };
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  await page.waitForSelector('.export-modal');
  check('the export dialog starts on video with its defaults', /MP4 video · 1920 × 1080 · 30 fps · 3\.0 s/.test(await page.locator('.export-summary').innerText()), await page.locator('.export-summary').innerText());
  await shot('00-export');
  const video = await exported('Video');
  // An MP4 starts with an `ftyp` box; frame-exact means 3 s at 30 fps is 90 frames however fast this machine is.
  check('video export downloads an MP4', video.name === 'my-first-scene.mp4' && video.bytes.subarray(4, 8).toString() === 'ftyp' && video.bytes.length > 5000, `${video.name} ${video.bytes.length} bytes`);
  const gif = await exported('GIF');
  check('GIF export downloads a GIF', gif.name === 'my-first-scene.gif' && gif.bytes.subarray(0, 6).toString() === 'GIF89a', `${gif.name} ${gif.bytes.length} bytes`);
  const image = await exported('Image');
  check('image export downloads a PNG', image.name === 'my-first-scene-frame.png' && image.bytes.subarray(1, 4).toString() === 'PNG', image.name);
  const embed = await exported('Web embed');
  const embedHtml = embed.bytes.toString();
  check('web embed export downloads one self-contained HTML file', embed.name === 'my-first-scene.html' && /<title>My first scene<\/title>/.test(embedHtml) && /"prelude":true/.test(embedHtml) && !/<script[^>]+src=/.test(embedHtml), `${embed.name} ${embed.bytes.length} bytes`);
  check('web embed shows the tag to paste', /<iframe src="my-first-scene\.html"/.test(await page.locator('.export-done .copy-line code').innerText().catch(() => '')));
  await shot('00-export-embed');
  const code = await exported('Code');
  check('code export downloads the source', code.name === 'my-first-scene.civet' && /@play FadeOut title/.test(code.bytes.toString()));
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  {
    // The exported embed plays on its own, from a file.
    const embedPage = await browser.newPage({viewport: {width: 640, height: 360}});
    const embedProblems = [];
    embedPage.on('pageerror', e => embedProblems.push(e.message));
    await embedPage.goto('file://' + path.join(out, 'export-my-first-scene.html'));
    await embedPage.waitForFunction(() => parseFloat(document.getElementById('fill').style.width) > 5, null, {timeout: 20000}).catch(() => {});
    check('the exported embed plays from a file', embedProblems.length === 0 && (await embedPage.locator('canvas').count()) === 1 && parseFloat(await embedPage.locator('#fill').evaluate(el => el.style.width)) > 5, embedProblems.join(' | '));
    await embedPage.screenshot({path: path.join(out, '00-embed-page.png')});
    await embedPage.close();
  }

  // Sound: add a clip, use it, and it is in the video and in the web embed.
  const text = () => page.locator('.cm-content').first().innerText();
  fs.writeFileSync(path.join(out, 'beep.wav'), tone(0.3, 880));
  await page.getByRole('button', {name: 'Sounds', exact: true}).click();
  await page.locator('.add-sound input').setInputFiles(path.join(out, 'beep.wav'));
  await page.waitForSelector('.asset-list li', {timeout: 10000}).catch(() => {});
  await page.locator('.cm-line', {hasText: '@play Write title'}).click();
  await page.getByRole('button', {name: 'Use', exact: true}).click();
  await page.waitForSelector('.transport [aria-label="Sound"]', {timeout: 10000}).catch(() => {});
  check('a clip added in the Sounds tab is used with one click', /@add_sound "beep\.wav"/.test(await text()) && (await page.locator('.transport [aria-label="Sound"]').count()) === 1 && (await page.locator('.problems li').count()) === 0);
  await shot('00-sounds');
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  const loud = await exported('Video');
  const doneText = (await page.locator('.export-done').innerText()).replace(/\s+/g, ' ');
  // The audio track's codec is named in the file: `mp4a` for AAC, `Opus` where the browser cannot encode AAC.
  check('the exported video has a sound track', /with sound/.test(doneText) && (loud.bytes.includes('mp4a') || loud.bytes.includes('Opus')), doneText);
  const loudEmbed = await exported('Web embed');
  check('the web embed carries the clip inside the file', /data:audio\/(wav|x-wav);base64/.test(loudEmbed.bytes.toString()));
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  {
    const embedPage = await browser.newPage({viewport: {width: 640, height: 360}});
    await embedPage.goto('file://' + path.join(out, 'export-my-first-scene.html'));
    await embedPage.waitForSelector('body.has-sound', {timeout: 20000}).catch(() => {});
    await embedPage.locator('#sound').click().catch(() => {});
    check('the embed offers a speaker button and starts muted', (await embedPage.locator('body.has-sound.sound-on').count()) === 1);
    await embedPage.close();
  }
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('@add_sound "nope.wav"');
  await page.waitForSelector('.problems li', {timeout: 10000}).catch(() => {});
  check('a sound that is not in the project is a problem with a way out', /no sound called "nope\.wav"/.test(await page.locator('.problems').innerText().catch(() => '')));
  for (let i = 0; i < 21; i++) await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelectorAll('.problems li').length === 0, null, {timeout: 10000}).catch(() => {});

  // Project folder: every scene is a file, in both directions.
  await page.getByRole('button', {name: 'More ways to start a scene'}).click();
  await page.getByRole('menuitem', {name: 'Save my scenes in a folder…'}).click();
  await page.waitForSelector('.folder-chip', {timeout: 10000}).catch(() => {});
  await settle(800);
  let files = await disk();
  check('connecting a folder writes the scenes and the sounds into it', /@add_sound "beep\.wav"/.test(files['My first scene.civet'] ?? '') && files['assets/beep.wav'] > 1000, Object.keys(files).join(', '));
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# typed in the editor');
  await settle(900);
  check('an edit reaches the file as you type', /# typed in the editor/.test((await disk())['My first scene.civet']));
  await outside('My first scene.civet', (await disk())['My first scene.civet'].replace('"Hello!"', '"Hello, disk!"'));
  await outside('From outside.tsx', "import {makeScene2D, Circle} from '@canvas-commons/2d';\nimport {waitFor} from '@canvas-commons/core';\n\nexport default makeScene2D(function* (view) {\n  view.add(<Circle size={200} fill=\"#58c4dd\" />);\n  yield* waitFor(1);\n});\n");
  await page.waitForFunction(() => /Hello, disk!/.test(document.querySelector('.cm-content')?.textContent ?? ''), null, {timeout: 10000}).catch(() => {});
  check('a file edited outside the editor is reloaded', /Hello, disk!/.test(await text()) && /changed on disk/.test(await page.locator('.notice').innerText().catch(() => '')) && (await page.locator('.problems li').count()) === 0);
  const mine = () => page.locator('.scene-select optgroup').first().locator('option').allInnerTexts();
  check('a file added outside the editor becomes a scene', (await mine()).includes('From outside'), (await mine()).join(', '));
  await shot('00-folder');
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  await page.locator('.export-kinds button').filter({has: page.locator('b', {hasText: /^GIF$/})}).click();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.export-done', {timeout: 60000}).catch(() => {});
  check('with a folder, exports are saved into it', /my-project\/exports\/my-first-scene\.gif/.test(await page.locator('.export-done').innerText().catch(() => '')) && (await disk())['exports/my-first-scene.gif'] > 1000);
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  // After a reload the browser asks again: edits wait in the browser and are written on reconnect.
  await page.evaluate(() => sessionStorage.setItem('lockFolder', '1'));
  await page.reload();
  await page.waitForSelector('.block', {timeout: 60000});
  await page.waitForSelector('.folder-chip.locked', {timeout: 10000}).catch(() => {});
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' (and while locked)');
  await settle(700);
  const lockedState = (await page.locator('.folder-chip.locked').count()) === 1 && !/while locked/.test((await disk())['My first scene.civet']);
  await page.locator('.folder-chip.locked').click();
  await page.waitForSelector('.folder-chip:not(.locked)', {timeout: 10000}).catch(() => {});
  await settle(800);
  check('a locked folder keeps edits in the browser and writes them on reconnect', lockedState && /while locked/.test((await disk())['My first scene.civet']));
  await outside('From outside.tsx', null);
  await page.waitForFunction(() => ![...document.querySelectorAll('.scene-select option')].some(o => o.textContent.trim() === 'From outside'), null, {timeout: 10000}).catch(() => {});
  check('a file deleted outside the editor leaves the list', !(await mine()).includes('From outside'));
  await page.locator('.folder-chip').click();
  await page.getByRole('menuitem', {name: 'Stop saving to this folder'}).click();
  await settle(400);
  check('leaving the folder keeps the scenes in the browser and the files on disk', (await page.locator('.folder-chip').count()) === 0 && (await mine()).includes('My first scene') && 'My first scene.civet' in (await disk()));

  // New scenes sit next to each other; nothing is overwritten, and a reload comes back to the last one.
  await page.getByRole('button', {name: '+ New', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 2, null, {timeout: 10000}).catch(() => {});
  check('New adds a second scene', (await sceneName()) === 'Untitled' && (await page.locator('.scene-select optgroup').first().locator('option').count()) === 2);
  await page.locator('.scene-select').selectOption({label: 'My first scene'});
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 10000}).catch(() => {});
  check('the first scene kept its edits', /@play FadeOut title/.test(await page.locator('.cm-content').first().innerText()));
  await page.reload();
  await page.waitForSelector('.block', {timeout: 60000});
  check('a reload reopens the scene you were on', (await sceneName()) === 'My first scene' && (await page.locator('.block').count()) === 3);
  await page.getByRole('button', {name: 'More ways to start a scene'}).click();
  await shot('00-new-menu');
  await page.getByRole('menuitem', {name: 'Delete this scene…'}).click();
  await page.getByRole('menuitem', {name: /for good/}).click();
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 2, null, {timeout: 10000}).catch(() => {});
  check('deleting a scene opens the next one', (await sceneName()) === 'Untitled' && (await page.locator('.scene-select optgroup').first().locator('option').count()) === 1);

  await page.goto(base + '/#example=square-to-circle');
  await page.reload();
  await page.waitForSelector('.block', {timeout: 60000});
  check('timeline has one block per play call', (await page.locator('.block').count()) === 3);
  check('status is ready', /Ready/.test(await page.locator('.status').innerText()));

  // Timeline click seeks and reveals the source line.
  await page.locator('.block').nth(1).click();
  await settle();
  const time = await page.locator('.transport .time b').innerText();
  check('clicking a block seeks to its start', /0:01\.0/.test(time), time);
  check('clicked block is current', await page.locator('.block').nth(1).evaluate(el => el.classList.contains('current')));
  check('running line is highlighted', (await page.locator('.cm-playing-line').count()) === 1);
  await shot('01-studio');

  // Outline + inspector + click-to-pick.
  check('outline lists on-screen mobjects', (await page.locator('.outline .row').count()) >= 1);
  await page.locator('.outline .row').first().click();
  await settle(300);
  check('inspector shows the selection', (await page.locator('.inspector dl').count()) === 1);
  check('selection box drawn over the preview', (await page.locator('.overlay .selection').count()) === 1);

  // Live editing: change the colour, expect a recompile without errors.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n@wait 1\n');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 4, null, {timeout: 10000}).catch(() => {});
  check('typing a new @wait adds a timeline step', (await page.locator('.block').count()) === 4);

  // A syntax error keeps the last good preview and reports the line.
  await page.keyboard.type('@play Create(]');
  await page.waitForSelector('.problems li', {timeout: 10000}).catch(() => {});
  check('compile error is reported', (await page.locator('.problems li').count()) >= 1);
  await shot('02-error');
  await page.getByRole('button', {name: 'Reset'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 10000}).catch(() => {});
  check('reset restores the example', (await page.locator('.block').count()) === 3 && (await page.locator('.problems li').count()) === 0);

  // Lab: dialect conversions rewrite the buffer in place.
  await page.getByRole('button', {name: /Lab/}).click();
  await settle(200);
  const source = () => page.locator('.code-pane .code-host').first().locator('.cm-content').innerText();
  await page.getByRole('button', {name: 'camelCase'}).click();
  await settle(700);
  check('camelCase converts method names', /setFill/.test(await source()) && !/set_fill/.test(await source()));
  await page.getByRole('button', {name: 'yield* @play …'}).click();
  await settle(700);
  check('explicit mode shows yield*', /yield\* @play Create/.test(await source()));
  await page.getByRole('button', {name: 'self.play'}).click();
  await settle(700);
  check('self style rewrites @', /yield\* self\.play Create/.test(await source()));
  check('converted buffer still runs', (await page.locator('.block').count()) === 3 && (await page.locator('.problems li').count()) === 0);
  await shot('03-lab-dialect');
  await page.getByRole('button', {name: 'Reset to defaults'}).click();
  await settle(700);
  check('reset to defaults restores the Manim dialect', /@play Create square/.test(await source()) && /set_fill/.test(await source()));

  // Reference pane.
  await page.getByRole('button', {name: '+ Python'}).click();
  await settle(500);
  check('Python original is shown side by side', /self\.play\(Create\(square\)\)/.test(await page.locator('.reference').innerText()));
  await shot('04-compare-python');
  await page.getByRole('button', {name: '+ Compiled'}).click();
  await settle(500);
  check('compiled TypeScript is shown', /yield\* this\.play\(Create\(square\)\)/.test(await page.locator('.reference').innerText()));
  await page.locator('.code-pane').getByRole('button', {name: 'Source'}).click();

  // Timeline variants and layouts.
  await page.getByRole('button', {name: 'Steps', exact: true}).click();
  await settle(300);
  check('steps timeline lists the steps', (await page.locator('.tl-steps li').count()) === 3);
  await page.getByRole('button', {name: 'On', exact: true}).last().click();
  await shot('05-steps-grid');
  await page.getByRole('button', {name: 'Scrubber', exact: true}).click();
  await settle(300);
  check('scrubber timeline shows a slider', (await page.locator('.tl-scrubber input').count()) === 1);
  await page.getByRole('button', {name: 'Blocks', exact: true}).click();
  for (const layout of ['Split', 'Stage', 'Studio']) {
    await page.locator('.lab').getByRole('button', {name: layout, exact: true}).click();
    await settle(500);
    await shot(`06-layout-${layout.toLowerCase()}`);
  }
  check('layout switch keeps the preview canvas', (await page.locator('.canvas-slot canvas').count()) === 1);
  await page.getByRole('button', {name: 'Close Lab'}).click();

  // Import a Manim (Python) scene.
  await page.getByRole('button', {name: 'More ways to start a scene'}).click();
  await page.getByRole('menuitem', {name: 'Import Manim Python…'}).click();
  await page.getByRole('button', {name: 'Try a gallery sample'}).click();
  await settle(300);
  check('Python import previews the Civet translation', /class MovingFrameBox extends Scene/.test(await page.locator('.modal pre').innerText()));
  await shot('07-import-python');
  await page.getByRole('button', {name: 'Convert and open'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 5, null, {timeout: 15000}).catch(() => {});
  check('imported Python scene runs', (await page.locator('.block').count()) === 5 && (await page.locator('.problems li').count()) === 0);
  check('an imported scene becomes a scene of your own', (await page.locator('.file-tab .scene-name').count()) === 1);
  await page.locator('.block').nth(3).click();
  await settle(600);
  await shot('08-imported-scene');
  await page.locator('.topbar select').first().selectOption('square-to-circle');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 15000}).catch(() => {});
  await page.locator('.transport .play').click();

  // Native Canvas Commons scenes are first-class: steps, outline, inspector, TSX.
  await page.locator('.topbar select').first().selectOption('cc-positioning');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 5, null, {timeout: 15000}).catch(() => {});
  check('native scene gets one step per yield*', (await page.locator('.block').count()) === 5);
  await page.locator('.block').nth(1).click();
  await settle(600);
  check('native step highlights its source line', /yield\*/.test(await page.locator('.cm-playing-line').innerText().catch(() => '')));
  check('outline lists native nodes', (await page.locator('.outline .row .tag').count()) >= 1);
  await page.locator('.outline .row').first().click();
  await settle(300);
  check('inspector shows native node properties', /Position/.test(await page.locator('.inspector dl').innerText()));
  check('native selection is outlined in the preview', (await page.locator('.overlay .selection').count()) === 1);
  await page.locator('.code-pane').getByRole('button', {name: '+ TSX'}).click();
  await settle(500);
  check('TSX original is shown side by side', /makeScene2D\(function\* \(view\)/.test(await page.locator('.reference').innerText()));
  await shot('09-native-civet');
  await page.locator('.code-pane').getByRole('button', {name: 'Source'}).click();
  await page.getByRole('button', {name: /Lab/}).click();
  await page.getByRole('button', {name: 'TSX', exact: true}).click();
  await page.waitForFunction(() => /function\* \(view\)/.test(document.querySelector('.code-pane .cm-content')?.textContent ?? ''), null, {timeout: 10000}).catch(() => {});
  await settle(600);
  check('TSX mode opens the TSX source', /function\* \(view\)/.test(await source()) && /cc-positioning\.tsx/.test(await page.locator('.file-tab').innerText()));
  check('TSX source runs with the same steps', (await page.locator('.block').count()) === 5 && (await page.locator('.problems li').count()) === 0);
  await shot('10-native-tsx');
  await page.getByRole('button', {name: 'Civet', exact: true}).click();
  await settle(600);
  check('switching back restores the Civet source', /makeScene2D \(view\) ->/.test(await source()));

  // Mixed scenes: native nodes take part in a Manim scene as mobjects.
  await page.getByRole('button', {name: 'Close Lab'}).click();
  await page.locator('.topbar select').first().selectOption('mix-nodes-in-manim');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 7, null, {timeout: 20000}).catch(() => {});
  await page.locator('.block').nth(2).click();
  await settle(700);
  const mixed = await page.locator('.outline .row').evaluateAll(rows => rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('a mixed scene lists mobjects and wrapped nodes together', mixed.some(r => /Circle/.test(r)) && mixed.some(r => /Rect/.test(r)) && mixed.some(r => /Latex/.test(r)), mixed.join(' | '));
  await page.locator('.outline .row', {hasText: 'Latex'}).first().click();
  await settle(300);
  check('a wrapped node can be inspected and is outlined', (await page.locator('.inspector dl').count()) === 1 && (await page.locator('.overlay .selection').count()) === 1);
  await shot('12-mixed-scene');
  await page.getByRole('button', {name: /Lab/}).click();

  // The language switch converts a Manim-style scene too, and an edited one round-trips.
  await page.locator('.topbar select').first().selectOption('square-to-circle');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 15000}).catch(() => {});
  await page.getByRole('button', {name: 'TSX', exact: true}).click();
  await settle(900);
  check('Manim scene converts to TSX with an import list', /import \{[^}]*Scene[^}]*\} from 'manim'/.test(await source()) && /yield\* this\.play\(Create\(square\)\)/.test(await source()));
  check('TSX Manim scene runs with the same steps', (await page.locator('.block').count()) === 3 && (await page.locator('.problems li').count()) === 0);
  await shot('11-manim-tsx');
  await page.locator('.code-pane .cm-line', {hasText: 'FadeOut(square)'}).click();
  await page.keyboard.press('End');
  await page.keyboard.type('\nyield* this.wait(1)');
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 4, null, {timeout: 10000}).catch(() => {});
  check('editing the TSX scene adds a step', (await page.locator('.block').count()) === 4);
  await page.getByRole('button', {name: 'Civet', exact: true}).click();
  await settle(900);
  check('an edited TSX scene converts back to Civet and still runs', /from manim import \*/.test(await source()) && /@wait\(1\)/.test(await source()) && (await page.locator('.block').count()) === 4 && (await page.locator('.problems li').count()) === 0);
  check('the conversion says what it did', (await page.locator('.notice li').count()) >= 1);
  await page.getByRole('button', {name: 'Reset', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.block').length === 3, null, {timeout: 15000}).catch(() => {});
  await page.getByRole('button', {name: 'Close Lab'}).click();
  await page.locator('.transport .play').click();

  // Playback.
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await settle(900);
  const frameText = await page.locator('.frame-no').innerText();
  check('playback advances frames', !/frame 0 /.test(frameText), frameText);
  await page.getByRole('button', {name: 'Pause', exact: true}).click();

  // Every bundled example loads without diagnostics.
  const slugs = await page.locator('.topbar select').first().locator('option').evaluateAll(os => os.map(o => o.value));
  const failures = [];
  for (const slug of slugs) {
    await page.locator('.topbar select').first().selectOption(slug);
    await page.waitForFunction(() => /Ready|problem/.test(document.querySelector('.status')?.textContent ?? ''), null, {timeout: 20000}).catch(() => {});
    await settle(400);
    if ((await page.locator('.problems li').count()) > 0) failures.push(`${slug}: ${(await page.locator('.problems li').first().innerText()).slice(0, 160)}`);
  }
  check(`all ${slugs.length} examples load in the editor`, failures.length === 0, failures.join(' | '));

  check('no console errors or Solid diagnostics', problems.length === 0, problems.slice(0, 5).join(' | '));
  await browser.close();
  const failed = checks.filter(c => !c.ok).length;
  console.log(failed ? `${failed} of ${checks.length} checks failed` : `all ${checks.length} checks passed`, '→ artifacts/ui/');
  process.exit(failed ? 1 : 0);
})();
