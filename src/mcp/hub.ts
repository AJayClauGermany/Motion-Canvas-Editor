/**
 * The hub: a small HTTP server on 127.0.0.1 that connects MCP clients to the
 * editor page.
 *
 *   GET  /health   who is listening (used to find an existing hub)
 *   *    /mcp      MCP over Streamable HTTP, one session per client
 *   GET  /editor   WebSocket the editor page connects to
 *   POST /call     editor calls forwarded by another MCP server process
 *
 * Only local clients can reach it: it binds to 127.0.0.1, checks the Host
 * header (DNS rebinding), refuses browser requests from other origins, and
 * accepts editor sockets only from the editor's own origins.
 */
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Server, ServerWebSocket} from 'bun';
import {
  CallMessage,
  DEFAULT_EDITOR_ORIGINS,
  EditorMethod,
  EditorMethods,
  HUB_HEADER,
  PageMessage,
  PROTOCOL_VERSION,
} from './protocol';
import {EditorLink, EditorUnavailable, NO_EDITOR, SERVER_NAME, SERVER_VERSION} from './server';

interface EditorConnection {
  ws: ServerWebSocket<SocketData>;
  title: string;
  /** Last connect or focus; the most recent editor answers calls. */
  active: number;
}

interface SocketData {
  id: number;
  origin: string;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: number;
}

export interface HubOptions {
  port: number;
  /** Builds the MCP server for each HTTP session. Without it, /mcp is not served. */
  createServer?: () => McpServer;
  /** Extra origins allowed to connect as an editor (e.g. a custom dev server). */
  editorOrigins?: string[];
  log?: (message: string) => void;
}

export interface Hub extends EditorLink {
  port: number;
  editors(): number;
  /** Resolves when an editor is connected (immediately if one is). */
  waitForEditor(timeoutMs: number): Promise<boolean>;
  stop(): void;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

/** Start the hub. Rejects if the port is taken. */
export function startHub(options: HubOptions): Hub {
  const log = options.log ?? (() => {});
  const editorOrigins = new Set([...DEFAULT_EDITOR_ORIGINS, ...(options.editorOrigins ?? [])]);
  const editors = new Map<number, EditorConnection>();
  const pending = new Map<number, Pending>();
  const waiters = new Set<() => void>();
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  let nextSocket = 1;
  let everConnected = false;
  const startedAt = Date.now();
  let nextCall = 1;

  const validHost = (req: Request, port: number) => {
    const host = req.headers.get('host') ?? '';
    return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
  };
  /** Browsers send Origin; agents do not. Only the editor's own origins may call. */
  const allowedOrigin = (origin: string | null) => origin === null || editorOrigins.has(origin) || origin.startsWith('views://');

  const activeEditor = (): EditorConnection | undefined => {
    let best: EditorConnection | undefined;
    for (const e of editors.values()) if (!best || e.active > best.active) best = e;
    return best;
  };

  const waitForEditor = (timeoutMs: number) =>
    new Promise<boolean>(resolve => {
      if (editors.size) return resolve(true);
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(editors.size > 0);
      };
      const timer = setTimeout(done, timeoutMs);
      waiters.add(done);
    });

  const call = async (method: EditorMethod, params: unknown, timeoutMs = 30_000): Promise<any> => {
    // A page that is reloading or reconnecting gets a moment to come back; so
    // does an open editor finding a hub that just started (it retries every few seconds).
    const grace = everConnected ? 6000 : Math.max(1500, 8000 - (Date.now() - startedAt));
    if (!editors.size && !(await waitForEditor(grace))) throw new EditorUnavailable(NO_EDITOR);
    const editor = activeEditor()!;
    const id = nextCall++;
    const message: CallMessage = {type: 'call', id, method, params};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The editor did not answer "${method}" within ${Math.round(timeoutMs / 1000)} s. If its window is minimised or the tab is in the background, bring it to the front.`));
      }, timeoutMs);
      pending.set(id, {resolve, reject, timer, socket: editor.ws.data.id});
      editor.ws.send(JSON.stringify(message));
    });
  };

  const handleMcp = async (req: Request): Promise<Response> => {
    if (!options.createServer) return json({error: 'This hub does not serve MCP.'}, 404);
    const sid = req.headers.get('mcp-session-id');
    if (sid) {
      const transport = sessions.get(sid);
      if (transport) return transport.handleRequest(req);
      return json({jsonrpc: '2.0', error: {code: -32001, message: 'Session not found'}, id: null}, 404);
    }
    if (req.method !== 'POST') return json({jsonrpc: '2.0', error: {code: -32000, message: 'Bad Request: No valid session ID provided'}, id: null}, 400);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: id => {
        sessions.set(id, transport);
        log(`MCP session ${id.slice(0, 8)} opened`);
      },
      onsessionclosed: id => {
        sessions.delete(id);
        log(`MCP session ${id.slice(0, 8)} closed`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await options.createServer().connect(transport);
    return transport.handleRequest(req);
  };

  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: options.port,
    // Rendering a long scene can take a while.
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (!validHost(req, srv.port!)) return json({error: 'Invalid Host header'}, 403);
      const origin = req.headers.get('origin');
      if (url.pathname === '/editor') {
        if (!origin || !allowedOrigin(origin)) {
          log(`refused an editor connection from origin ${origin ?? '(none)'}`);
          return json({error: `Origin ${origin} may not connect as an editor. Set MCE_EDITOR_ORIGINS to allow it.`}, 403);
        }
        if (srv.upgrade(req, {data: {id: nextSocket++, origin}})) return undefined as unknown as Response;
        return json({error: 'Expected a WebSocket upgrade'}, 426);
      }
      if (!allowedOrigin(origin)) return json({error: `Origin ${origin} is not allowed`}, 403);
      if (url.pathname === '/health') {
        return json({app: SERVER_NAME, version: SERVER_VERSION, protocol: PROTOCOL_VERSION, editors: editors.size, mcp: options.createServer ? '/mcp' : null});
      }
      if (url.pathname === '/mcp') return handleMcp(req);
      if (url.pathname === '/call' && req.method === 'POST') {
        // A custom header keeps browsers out: it needs a CORS preflight, which this server never grants.
        if (req.headers.get(HUB_HEADER) !== String(PROTOCOL_VERSION)) return json({error: 'Missing hub header'}, 400);
        let body: {method: EditorMethod; params: unknown; timeoutMs?: number};
        try {
          body = await req.json();
        } catch {
          return json({error: 'Invalid JSON'}, 400);
        }
        try {
          return json({result: await call(body.method, body.params, body.timeoutMs)});
        } catch (e) {
          return json({error: (e as Error).message, unavailable: e instanceof EditorUnavailable}, 200);
        }
      }
      return json({error: 'Not found'}, 404);
    },
    websocket: {
      // Contact sheets are large.
      maxPayloadLength: 64 * 1024 * 1024,
      open(ws) {
        editors.set(ws.data.id, {ws, title: 'editor', active: Date.now()});
        everConnected = true;
        log(`editor connected (${ws.data.origin})`);
        for (const w of [...waiters]) w();
      },
      message(ws, raw) {
        let msg: PageMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        const editor = editors.get(ws.data.id);
        if (msg.type === 'hello' && editor) {
          editor.title = msg.title;
          editor.active = Date.now();
        } else if (msg.type === 'focus' && editor) {
          editor.active = Date.now();
        } else if (msg.type === 'result' || msg.type === 'error') {
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.type === 'result') p.resolve(msg.result);
          else p.reject(new Error(msg.error));
        }
      },
      close(ws) {
        editors.delete(ws.data.id);
        log('editor disconnected');
        for (const [id, p] of pending) {
          if (p.socket !== ws.data.id) continue;
          pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new EditorUnavailable('The editor disconnected before answering (it was closed or reloaded).'));
        }
      },
    },
  });

  return {
    port: server.port!,
    editors: () => editors.size,
    waitForEditor,
    call: (method, params, timeoutMs) => call(method, params, timeoutMs),
    stop() {
      for (const t of sessions.values()) void t.close();
      server.stop(true);
    },
  };
}

/** What is listening on `port`: our hub, something else, or nothing. */
export async function probeHub(port: number): Promise<'hub' | 'other' | 'none'> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(1500)});
    const body = (await res.json().catch(() => null)) as {app?: string} | null;
    return body?.app === SERVER_NAME ? 'hub' : 'other';
  } catch {
    return 'none';
  }
}

/** An editor link through a hub that another process owns. */
export function remoteLink(port: number): EditorLink {
  return {
    async call(method, params, timeoutMs = 30_000) {
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${port}/call`, {
          method: 'POST',
          headers: {'content-type': 'application/json', [HUB_HEADER]: String(PROTOCOL_VERSION)},
          body: JSON.stringify({method, params, timeoutMs}),
          signal: AbortSignal.timeout(timeoutMs + 5000),
        });
      } catch (e) {
        throw new HubGone((e as Error).message);
      }
      const body = (await res.json()) as {result?: any; error?: string; unavailable?: boolean};
      if (body.error) throw body.unavailable ? new EditorUnavailable(body.error) : new Error(body.error);
      return body.result;
    },
  };
}

/** The hub this process used went away (its owner exited). */
export class HubGone extends Error {}

/**
 * The link an MCP server process uses: its own hub when it could start one,
 * otherwise the existing hub on the port. If that hub disappears (its owner
 * exited), this process takes the port over and the editor reconnects to it.
 */
export function autoLink(options: Omit<HubOptions, 'createServer'> & {createServer?: () => McpServer}): EditorLink & {ready: Promise<string>; stop(): void} {
  const log = options.log ?? (() => {});
  let hub: Hub | null = null;
  let remote: EditorLink | null = null;

  const claim = async (): Promise<string> => {
    try {
      hub = startHub(options);
      remote = null;
      return `hub listening on http://127.0.0.1:${hub.port}`;
    } catch (e) {
      const what = await probeHub(options.port);
      if (what === 'hub') {
        remote = remoteLink(options.port);
        return `using the hub already running on port ${options.port}`;
      }
      throw new Error(`Port ${options.port} is in use by another program (${(e as Error).message}). Set MCE_HUB_PORT to another port, in the editor too (#agentPort=…).`);
    }
  };
  let ready = claim();
  ready.then(log, e => log(String(e.message ?? e)));

  return {
    ready,
    async call(method, params, timeoutMs) {
      for (let attempt = 0; ; attempt++) {
        const status = await ready.catch((e: Error) => e.message);
        if (hub) return hub.call(method, params, timeoutMs);
        if (!remote) throw new EditorUnavailable(`${NO_EDITOR} (The editor bridge could not start: ${status})`);
        try {
          return await remote.call(method, params, timeoutMs);
        } catch (e) {
          if (!(e instanceof HubGone) || attempt > 0) throw e;
          // Its owner exited: take the port over; the editor reconnects within seconds.
          log('the hub went away; taking over');
          ready = claim();
          await ready.catch(() => {});
          if (hub) await (hub as Hub).waitForEditor(8000);
        }
      }
    },
    stop() {
      hub?.stop();
    },
  };
}
