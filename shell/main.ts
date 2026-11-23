// Electrobun 2 main process (Bun) for the desktop shell.
//
// The shell is deliberately thin: it opens one window on the Vite build of
// the web editor, which `electrobun.config.ts` copies from `dist/` into the app
// bundle as `views://editor/`. It knows nothing about the editor's contents.
import Electrobun, {ApplicationMenu, BrowserWindow} from 'electrobun/main';
import {readFileSync} from 'node:fs';
import {startHub, type Hub} from '../src/mcp/hub';
import {DEFAULT_HUB_PORT} from '../src/mcp/protocol';
import {createMcpServer} from '../src/mcp/server';
import {capabilityProbe, pageErrorReporter} from './page-scripts';

const EDITOR_URL = 'views://editor/index.html';

// MCE_SHELL_URL overrides the start page, e.g. `views://editor/harness.html`
// or a running Vite dev server (`http://127.0.0.1:5273/`) for HMR.
const url = process.env.MCE_SHELL_URL || EDITOR_URL;

const win = new BrowserWindow({
  title: 'Motion Canvas Editor',
  url,
  frame: {width: 1440, height: 900},
  // Runs before the page's own scripts. Reports uncaught errors, rejected
  // promises and failed asset loads to this process (see `host-message`).
  preload: pageErrorReporter,
});

// The MCP server for AI agents (src/mcp/, docs/agents.md). It runs in this
// process, on 127.0.0.1 only, while "Agent" is switched on in the editor; the
// page asks for it with an `mce:agent-hub` message and then connects to it.
let hub: Hub | null = null;
function setAgentHub(enable: boolean, port: number) {
  if (hub && (!enable || hub.port !== port)) {
    hub.stop();
    hub = null;
    console.log('[shell] MCP server stopped');
  }
  if (!enable || hub) return;
  try {
    const started: Hub = startHub({port, log: m => console.log(`[shell] mcp: ${m}`), createServer: () => createMcpServer(started)});
    hub = started;
    console.log(`[shell] MCP server at http://127.0.0.1:${port}/mcp`);
  } catch (e) {
    // Most likely `bun run mcp` already serves this port; the page connects to that one.
    console.error(`[shell] could not start the MCP server on port ${port}: ${(e as Error).message}`);
  }
}

// Messages posted by the page scripts through `__electrobunSendToHost`.
Electrobun.events.on('host-message', (event: {data?: {detail?: unknown}}) => {
  const msg = event.data?.detail as {type?: string; enable?: boolean; port?: number} | undefined;
  if (msg?.type === 'shell:page-error') console.error('[shell] page error', JSON.stringify(msg));
  else if (msg?.type === 'shell:probe') console.log('[shell] probe', JSON.stringify(msg));
  else if (msg?.type === 'mce:agent-hub') setAgentHub(!!msg.enable, Number(msg.port) || DEFAULT_HUB_PORT);
});

// Diagnostics: MCE_SHELL_PROBE=1 logs which web platform features the webview
// offers; MCE_SHELL_PROBE=<file.js> runs that file in the page instead (it can
// answer with `__electrobunSendToHost({type: 'shell:probe', ...})`).
const probe = process.env.MCE_SHELL_PROBE;
win.webview.on('dom-ready', () => {
  console.log(`[shell] dom-ready ${win.webview.url ?? url}`);
  if (probe) win.webview.executeJavascript(probe === '1' ? capabilityProbe : readFileSync(probe, 'utf8'));
});

// Roles map to native behaviour; actions come back as events below.
// Electrobun 2.0.7 has no application menu on Linux (it only logs a warning).
if (process.platform !== 'linux') ApplicationMenu.setApplicationMenu([
  // On macOS the first entry is the application menu.
  {
    label: 'Motion Canvas Editor',
    submenu: [
      {role: 'about'},
      {type: 'separator'},
      {role: 'hide'},
      {role: 'hideOthers'},
      {role: 'showAll'},
      {type: 'separator'},
      {role: 'quit'},
    ],
  },
  {
    label: 'File',
    submenu: [{role: 'close'}],
  },
  {
    label: 'Edit',
    submenu: [
      {role: 'undo'},
      {role: 'redo'},
      {type: 'separator'},
      {role: 'cut'},
      {role: 'copy'},
      {role: 'paste'},
      {role: 'selectAll'},
    ],
  },
  {
    label: 'View',
    submenu: [
      {label: 'Reload', action: 'view:reload'},
      {label: 'Toggle Developer Tools', action: 'view:devtools'},
      {type: 'separator'},
      {role: 'toggleFullScreen'},
    ],
  },
]);

ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
  const action = (event as {data?: {action?: string}}).data?.action;
  if (action === 'view:reload') win.webview.loadURL(win.webview.url ?? url);
  else if (action === 'view:devtools') win.webview.toggleDevTools();
});

console.log(`[shell] window ${win.id} loading ${url}`);
