#!/usr/bin/env node
/**
 * End-to-end test of the agent bridge: an MCP client talks to the MCP server
 * (`src/mcp/main.ts --http`), which drives the editor in headless Chromium.
 * Screenshots go to artifacts/agent/.
 *
 *   node tools/agent-e2e.cjs
 *
 * Starts a Vite dev server unless one is listening on E2E_URL, and an MCP
 * server on port 5286 (MCE_TEST_PORT) so it never meets a real one.
 */
const {chromium} = require('playwright');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const base = process.env.E2E_URL || 'http://127.0.0.1:5273';
const port = Number(process.env.MCE_TEST_PORT || 5286);
const out = path.join(root, 'artifacts', 'agent');
fs.mkdirSync(out, {recursive: true});

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, ok ? 300 : 1500)}` : ''}`);
};
const up = async url => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
const textOf = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

(async () => {
  const children = [];
  if (!(await up(base + '/harness.html'))) {
    children.push(spawn('bunx', ['vite'], {cwd: root, stdio: 'ignore', detached: true}));
    for (let i = 0; i < 150 && !(await up(base + '/harness.html')); i++) await new Promise(r => setTimeout(r, 200));
  }
  const server = spawn('bun', [path.join(root, 'src/mcp/main.ts'), '--http', '--port', String(port)], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
  children.push(server);
  let serverLog = '';
  server.stderr.on('data', d => (serverLog += d));
  for (let i = 0; i < 100 && !(await up(`http://127.0.0.1:${port}/health`)); i++) await new Promise(r => setTimeout(r, 100));

  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const problems = [];
  page.on('console', m => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (/AudioContext was not allowed to start/.test(m.text())) return;
    problems.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message.slice(0, 300)}`));
  const shot = name => page.screenshot({path: path.join(out, `${name}.png`)});

  const client = new Client({name: 'agent-e2e', version: '0.0.1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const call = async (name, args = {}) => client.callTool({name, arguments: args});

    // Without an editor: static tools work, editor tools explain what to do.
    const tools = (await client.listTools()).tools.map(t => t.name);
    check('server lists the tools', ['get_editor_state', 'edit_scene', 'write_scene', 'check_scene', 'render_preview', 'read_docs', 'lookup_api'].every(t => tools.includes(t)), tools.join(', '));
    check('server sends instructions', /Civet pitfalls/.test(client.getInstructions() ?? ''));
    const noEditor = await call('get_editor_state');
    check('editor tools say how to connect when no editor is open', noEditor.isError && /switch on "Agent"/.test(textOf(noEditor)), textOf(noEditor));
    const docs = await call('read_docs', {topic: 'civet', section: 'TypeScript that means something else'});
    check('read_docs returns a section', /x\(=> x \* 2\)/.test(textOf(docs)));
    const api = await call('lookup_api', {names: ['Circle', 'ThreeDScene', 'waitFor']});
    check('lookup_api knows real and missing names', /mobject class/.test(textOf(api)) && /3D/.test(textOf(api)) && /waitFor\(/.test(textOf(api)), textOf(api));

    // The editor connects when the agent link is on.
    await page.goto(`${base}/#example=square-to-circle&agent=1&agentPort=${port}`);
    await page.waitForSelector('.block', {timeout: 60000});
    await page.waitForSelector('.agent-toggle[data-status="connected"]', {timeout: 15000}).catch(() => {});
    check('editor connects to the server', (await page.locator('.agent-toggle[data-status="connected"]').count()) === 1);

    const state = textOf(await call('get_editor_state'));
    check('get_editor_state describes the document', /Language: civet\. Style: Manim/.test(state) && /3\. .* FadeOut \(line 13\)/.test(state), state.slice(0, 400));
    const revision = /Revision: (\w+)/.exec(state)[1];

    // An edit in TypeScript habits is repaired and applied, and runs.
    const edit = await call('edit_scene', {
      edits: [{old: '    @play FadeOut square', new: '    dots = [1, 2, 3].map(i => Dot().shift(i * RIGHT))\n    @play LaggedStart(*dots.map(d => FadeIn(d)), lag_ratio=0.3)\n    @play FadeOut square'}],
      base_revision: revision,
      summary: 'Add three dots',
    });
    const editText = textOf(edit);
    check('edit_scene repairs `x => y` and `name=value`', /Wrapped single arrow-function/.test(editText) && /keyword argument/.test(editText), editText);
    check('edit_scene reports the run of the result', !edit.isError && /Run: ok, .*4 steps/.test(editText), editText.slice(-700));
    check('the editor shows the edit', /lag_ratio: 0\.3/.test(await page.locator('.cm-content').first().innerText()));
    await page.waitForFunction(() => document.querySelectorAll('.block').length === 4, null, {timeout: 10000}).catch(() => {});
    check('the editor timeline has the new step', (await page.locator('.block').count()) === 4);
    check('the code pane says what the agent did', /Agent: Add three dots/.test(await page.locator('.notice').innerText().catch(() => '')));
    await shot('01-edited');

    const stale = await call('edit_scene', {edits: [{old: 'Circle()', new: 'Circle(radius: 2)'}], base_revision: revision});
    check('a stale base_revision is refused', stale.isError && /conflict/.test(textOf(stale)));
    const missing = await call('edit_scene', {edits: [{old: 'no such text', new: 'x'}]});
    check('an edit whose text is missing is refused', missing.isError && /not found/.test(textOf(missing)));

    // Undo restores the user's version.
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('lag_ratio'), null, {timeout: 5000}).catch(() => {});
    check('Ctrl+Z undoes an agent edit', !/lag_ratio/.test(await page.locator('.cm-content').first().innerText()));

    // A whole scene in TSX goes into the Civet document.
    const tsx = `import {Scene, Circle, Square, Text, Create, Write, Transform, BLUE, UP} from 'manim';

export class Demo extends Scene {
  *construct() {
    const title = Text('Squares become circles', {font_size: 40}).to_edge(UP);
    const shapes = [0, 1, 2].map(i => Square({side_length: 1}).shift([i * 2 - 2, 0, 0]));
    yield* this.play(Write(title));
    for (const s of shapes) yield* this.play(Create(s), {run_time: 0.5});
    yield* this.play(...shapes.map(s => Transform(s, Circle({radius: 0.5, color: BLUE}).move_to(s))));
    this.wait(1);
  }
}
`;
    const write = textOf(await call('write_scene', {code: tsx, summary: 'Three squares become circles'}));
    check('write_scene converts TSX to the Civet document', /Converted from tsx to civet/.test(write) && /Run: ok, .*6 steps/.test(write), write);
    const doc = await page.locator('.cm-content').first().innerText();
    check('the document is Civet now', /from manim import \*/.test(doc) && /title := Text/.test(doc));

    // Python works too.
    const py = textOf(await call('check_scene', {code: 'from manim import *\n\nclass A(Scene):\n    def construct(self):\n        c = Circle(radius=2)\n        self.play(Create(c), run_time=2)\n', language: 'python'}));
    check('check_scene converts and runs Manim Python', /Run: ok, 2\.\d+s, 1 step/.test(py), py);
    const bad = textOf(await call('check_scene', {code: 'from manim import *\n\nclass Broken extends Scene\n  construct()\n    c := Cirlce radius: 1\n    @play Create c\n'}));
    check('check_scene reports runtime errors with lines and suggests names', /line 5 \[runtime\]/.test(bad) && /Did you mean `Circle`/.test(bad), bad);

    // Seeing the scene.
    const render = await call('render_preview', {count: 4});
    const image = render.content.find(c => c.type === 'image');
    check('render_preview returns a PNG', !!image && image.data.length > 10000, textOf(render));
    if (image) fs.writeFileSync(path.join(out, 'render_preview.png'), Buffer.from(image.data, 'base64'));
    const inspect = textOf(await call('inspect_frame', {time: 5}));
    check('inspect_frame lists items with bounds', /Text \(.*line 5\) \[/.test(inspect) && /Square/.test(inspect), inspect);
    const offscreen = textOf(await call('inspect_frame', {time: 1, code: 'from manim import *\nclass A extends Scene\n  construct()\n    t := Text "far away"\n    t.shift 9 * RIGHT\n    @add t\n    @wait 1\n'}));
    check('inspect_frame warns about things off-frame', /entirely outside the frame/.test(offscreen), offscreen);

    // Review mode: the change waits for the user.
    await page.locator('.agent-toggle').click();
    await page.getByRole('button', {name: 'Ask first'}).click();
    await shot('02-popover');
    await page.locator('.agent-toggle').click();
    const pending = call('edit_scene', {edits: [{old: "font_size: 40", new: "font_size: 56"}], summary: 'Bigger title'});
    await page.waitForSelector('.agent-proposal', {timeout: 15000}).catch(() => {});
    check('review mode shows the proposal', (await page.locator('.agent-proposal').count()) === 1);
    await shot('03-proposal');
    await page.getByRole('button', {name: 'Reject'}).click();
    const rejected = await pending;
    check('a rejected proposal is reported to the agent', rejected.isError && /rejected/.test(textOf(rejected)), textOf(rejected));
    const pending2 = call('edit_scene', {edits: [{old: "font_size: 40", new: "font_size: 56"}], summary: 'Bigger title'});
    await page.waitForSelector('.agent-proposal', {timeout: 15000}).catch(() => {});
    await page.getByRole('button', {name: 'Accept'}).click();
    const accepted = await pending2;
    check('an accepted proposal is applied', !accepted.isError && /font_size: 56/.test(await page.locator('.cm-content').first().innerText()), textOf(accepted));

    // The user types while a proposal waits: accepting applies the change to their version.
    const pending3 = call('edit_scene', {edits: [{old: 'font_size: 56', new: 'font_size: 60'}], summary: 'Even bigger title'});
    await page.waitForSelector('.agent-proposal', {timeout: 15000}).catch(() => {});
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# a note from the user');
    await page.getByRole('button', {name: 'Accept'}).click();
    const rebased = await pending3;
    const afterRebase = await page.locator('.cm-content').first().innerText();
    check('an accepted edit is re-applied to what the user typed meanwhile', !rebased.isError && /font_size: 60/.test(afterRebase) && /a note from the user/.test(afterRebase), textOf(rebased));
    await page.locator('.agent-toggle').click();
    await page.getByRole('button', {name: 'Apply', exact: true}).click();
    await page.locator('.agent-toggle').click();

    // Opening an example, and pointing the user at a step.
    const opened = textOf(await call('open_scene', {example: 'cc-quickstart'}));
    check('open_scene opens an example', /Opened Quickstart/.test(opened), opened);
    const reveal = await call('reveal_in_editor', {step: 1});
    check('reveal_in_editor works', !reveal.isError);
    await shot('04-final');
  } catch (e) {
    check('no exceptions', false, e.stack || e);
  } finally {
    check('no console errors or warnings in the editor', problems.length === 0, problems.join(' | '));
    await client.close().catch(() => {});
    await browser.close();
    for (const c of children) {
      try {
        process.kill(c.pid);
      } catch {}
    }
  }
  if (failures) console.log(`\nServer log:\n${serverLog}`);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
