# AI agents (MCP)

The editor has no chat built in. Instead it exposes an [MCP](https://modelcontextprotocol.io)
server, so an agent you already use (Claude Code, Cursor, VS Code, Codex, Claude
Desktop, …) can read the open scene, edit it, check it, render frames and look
up the API. The agent runs in your tools, with your model and your account; the
editor only answers its tool calls.

```
 agent ──MCP (stdio or HTTP)──▶ MCP server ──WebSocket, 127.0.0.1──▶ editor page
                                 (bun run mcp, or the desktop app)    ("Agent" on)
```

## Connect

1. In the editor, click **Agent** in the top bar and switch it **On**. The dot
   turns green when a server is there. The popover shows the commands below.
2. Add the server to your agent:

| Where the editor runs | Agent config |
|---|---|
| `bun run dev` (browser), agent starts the server (stdio) | `claude mcp add motion-canvas -- bun run --cwd /path/to/Motion-Canvas-Editor mcp`. Claude Code opened in this repository finds it on its own through `.mcp.json`. |
| Several agents, or an agent that only speaks HTTP | run `bun run mcp:http` once, then point agents at `http://127.0.0.1:5275/mcp` (`claude mcp add --transport http motion-canvas http://127.0.0.1:5275/mcp`) |
| Desktop app | switching Agent on starts the server inside the app at `http://127.0.0.1:5275/mcp` |

Generic JSON config (Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json` with
`servers` instead of `mcpServers`, Claude Desktop):

```json
{"mcpServers": {"motion-canvas": {"command": "bun", "args": ["run", "--cwd", "/path/to/Motion-Canvas-Editor", "mcp"]}}}
```

or, for a running HTTP server, `{"mcpServers": {"motion-canvas": {"url": "http://127.0.0.1:5275/mcp"}}}`.

Several MCP server processes can run at once: the first one owns port 5275 and
the editor connects to it; the others forward their editor calls to it, and
take the port over if it exits. `MCE_HUB_PORT` (server) and the port field in
the Agent popover (editor) change the port together.

## What the agent can do

| Tool | Needs the editor | What it does |
|---|---|---|
| `read_docs` | no | Bundled docs for agents ([docs/agents/](agents/)): quickstart, Civet for TypeScript authors, both scene styles, mixing, the Manim reference, a review checklist |
| `lookup_api` | no | Whether a Manim or Canvas Commons name exists here, its arguments, methods, signals and an example; `search` by word |
| `get_example` | no* | The bundled examples, with the Python or TSX they were ported from |
| `convert_code` | no | Civet ⇄ TSX, Manim Python → either, and repairs (see below) |
| `check_scene` | optional | Compile problems with lines, heuristic hints; with the editor, a run of the scene with runtime errors and the timeline |
| `get_editor_state` | yes | The open document (with line numbers), language, style, dialect, problems, timeline, playhead, selection, cursor |
| `edit_scene` | yes | Find-and-replace edits in the document's language |
| `write_scene` | yes | Replace the document; any language is converted |
| `open_scene` | yes | Open an example, one of the user's scenes, or new code as a new scene next to the others |
| `render_preview` | yes | Frames as one PNG contact sheet, labelled with time, step and line |
| `inspect_frame` | yes | Items on screen at a time with bounds, colours, text and lines; warnings for off-frame and overlapping text |
| `export_scene` | yes | Export the open scene to a file, like the Export button: MP4 video (default), GIF, web embed (one HTML file plus the `<iframe>` tag) or PNG. Returns the path |
| `add_sound_file` | yes | Add a sound clip from disk to the project; scenes play it by file name, and it ends up in the video and the web embed |
| `reveal_in_editor` | yes | Move the editor to a line, time or step, to show the user something |

\* The desktop app has no `examples/` directory, so there the examples come from the editor.

Prompts (slash commands in Claude Code: `/mcp__motion-canvas__review_scene`):
`review_scene`, `port_manim_scene`, `create_scene`. Resources: the docs
(`mce://docs/…`), the examples (`mce://examples/<slug>`) and the open scene
(`mce://editor/scene`).

The server also sends instructions that most agents put in their context: the
two styles, the workflow, and the Civet pitfalls.

## Languages: agents write TypeScript, the document stays Civet

Agents know TypeScript far better than Civet, and often write Manim's Python.
So the tools accept any of them and convert to the language the user edits in
(`src/runtime/normalize.ts`):

- **Detection**: Python (`def`, `class X(Scene):`), TSX (`function*`, braces,
  semicolons) or Civet (`:=`, `@`, indentation), including a mix of Civet and
  TSX.
- **Conversion**: Python goes through the Python converter; TSX into a Civet
  document through `tsxToCivet`; Civet or mixed code into a TSX document
  through the Civet compiler (exact). The result is adapted to the document's
  Lab dialect (snake/camel case, implicit or explicit `yield*`, `@` or `self.`).
- **Repairs** of things that compile but mean something else: `x => y` in
  Civet (a call of `x`), `run_time=2` (an assignment), `f(*xs)`, a first
  assignment without a declaration, `this.play(...)` without `yield*`.
  `edit_scene` applies them to each replacement text.
- **Hints** (`src/runtime/hints.ts`) flag the rest: Manim names that do not
  exist here (with "did you mean"), snake_case methods that are not ported,
  Python literals, Civet syntax in a TSX document, a non-generator `construct`,
  native tweens that are never `yield*`ed, mutated `points`, mobjects created at
  module level.

Every tool result says what was converted or repaired, so the agent learns the
dialect as it goes.

## One workflow, two operators

The agent follows the path the user follows in the editor, through tools
instead of buttons:

| Step | User | Agent |
|---|---|---|
| Start | **+ New**, or pick a scene | `open_scene` with `code` (a new scene), `scene` or `example` |
| Write | the code pane | `edit_scene`, `write_scene` |
| Check | problems list, timeline | the run report every edit returns, `check_scene` |
| Look | the preview | `render_preview`, `inspect_frame` |
| Sound | the **Sounds** tab: add a clip, **Use** | `add_sound_file`, then `add_sound "name"` in the scene |
| Deliver | **Export** | `export_scene` |

Both work on the same document, so the server keeps each side informed
(`catchUp` in `src/mcp/server.ts`):

- **User → agent.** The server remembers the text each agent last saw. Every
  tool that touches the open scene first compares it with the editor, and
  starts its answer with what changed: a diff of the user's edits, or the
  name of the scene they switched to. A change is reported once.
- **The user's text wins.** `edit_scene` is find-and-replace on the current
  text, so it merges with what the user typed; it refuses when the user
  opened another scene. `write_scene` refuses to replace a scene of the
  user's (or an example they edited) that the agent has not been shown, and
  returns the scene instead; a second call goes through. New code from
  `open_scene` becomes a new scene, so nothing is overwritten.
- **Agent → user.** Each change is announced above the code with the agent's
  summary, the lines it changed are marked until the user types again, and
  one Ctrl/Cmd+Z undoes it. Exports and renders are listed in the Agent
  popover.

**The project folder is a third way in.** When the user saves their scenes in
a folder (New ▾ → "Save my scenes in a folder…"), each scene is a `.civet` or
`.tsx` file there, and the editor picks up changes made to those files within
a couple of seconds (`src/editor/project.ts`). An agent with file access can
therefore also work on the files directly, and so can the user's own editor.
`get_editor_state` reports the folder's name; a browser does not reveal its
path, so the agent has to be told where it is. The MCP tools remain the better
route: they check and run what the agent writes and tell the user about it.

`export_scene` runs the same exporter as the Export dialog
(`src/editor/export.ts`). The file's bytes go from the page to the hub as
binary WebSocket frames, and the hub writes them where the agent asked
(`path`: a file or a directory; default `exports/` in the server's working
directory, `MCE_EXPORT_DIR`, or `~/Downloads` when that is not writable).

## What the user sees

- **Agent edits** (Lab, and the Agent popover): *Apply* lands each change at
  once, runs it, and says so above the code ("Agent: Add three dots. Undo with
  Ctrl/Cmd+Z"); one Ctrl/Cmd+Z undoes it. *Ask first* shows each change as a
  diff with the result of running it, to accept or reject; the agent is told
  which, and a rejection asks it to check with the user.
- Checks and renders run in a hidden copy of the engine (`harness.html` in an
  iframe), so the user's preview, playhead and selection never move. It keeps
  working when the editor tab is in the background, where the browser stops
  animation frames.
- The Agent popover lists the last actions.

## Security

- The server listens on 127.0.0.1 only, rejects requests whose `Host` is not
  localhost (DNS rebinding), and rejects browser requests from other origins.
- Only the editor's own origins may connect as the editor
  (`http://127.0.0.1:5273`, `:5274`, `localhost`, the desktop app's
  `views://`); add others with `MCE_EDITOR_ORIGINS`.
- Code the agent writes runs in the editor page like code the user types: it
  is the user's agent, acting with the user's permissions. Use *Ask first* to
  review every change before it runs in the main preview (checks and renders
  of proposed code still run in the hidden engine).
- The desktop app starts its server only while Agent is on.

## Development

```bash
bun run mcp                         # stdio server (what agents launch)
bun run mcp:http                    # HTTP server on 127.0.0.1:5275/mcp
bun tools/mcp-client.ts list        # list tools, prompts, resources (spawns the stdio server)
bun tools/mcp-client.ts call lookup_api '{"names":["Circle"]}'
MCE_MCP_URL=http://127.0.0.1:5275/mcp bun tools/mcp-client.ts call render_preview '{"count":4}'
node tools/agent-e2e.cjs            # client → server → editor in headless Chromium; artifacts/agent/
```

| File | Role |
|---|---|
| `src/mcp/main.ts` | CLI: stdio or HTTP |
| `src/mcp/server.ts` | Tools, resources, prompts, server instructions |
| `src/mcp/hub.ts` | HTTP server: `/mcp`, the editor's `/editor` socket, `/call` for sibling processes, `/health` |
| `src/mcp/protocol.ts` | Messages between server and page (types only; the page imports it) |
| `src/mcp/api.ts`, `src/mcp/docs.ts` | `lookup_api`, `read_docs` |
| `docs/agents/*.md` | The docs agents read (imported as text, so they ship in the desktop bundle) |
| `src/editor/agent.ts` | The page's side: connection, method handlers, hidden engine, review proposals |
| `src/editor/export.ts`, `src/runtime/export.ts` | The exporter shared with the Export dialog, and the frame-by-frame encoders |
| `src/runtime/textdiff.ts` | Revision fingerprint, find-and-replace edits, line diff (DOM-free, shared by page and server) |
| `src/editor/AgentPanel.tsx` | Agent popover and the proposal banner |
| `src/runtime/normalize.ts`, `src/runtime/hints.ts` | Language detection and conversion, repairs, hints (DOM-free) |
| `shell/main.ts` | Starts the server in the desktop app on request |

Adding a tool: a method in `EditorMethods` (`protocol.ts`) and its handler in
`src/editor/agent.ts` if it needs the page, then `registerTool` in
`server.ts`. Keep the set small and the descriptions precise: agents choose
tools by their descriptions.

## Limits

- One document is open at a time, like in the editor. `open_scene` switches
  to another one; every scene keeps its text.
- What the agent "last saw" is kept per MCP session, in memory. A new session
  starts by reading the document.
- `export_scene` exports the open scene only. Its file goes where the agent
  asks, not into the user's project folder.
- `add_sound_file` sends the clip through the editor (base64), so it is meant
  for clips, not long recordings: 40 MB at most.
- Hints are heuristics on the text, not a type checker. The run in the hidden
  engine is the ground truth.
- TSX → Civet keeps braces and parentheses where it cannot be sure; the result
  is valid Civet but not always idiomatic. Prefer `edit_scene` for small
  changes to a Civet document.
- The desktop app's main process bundle grows by several MB, because the
  server includes the compiler and the Manim layer (`lookup_api` reads them).
  Canvas Commons' type declarations are not in the bundle, so there
  `lookup_api` lists node methods without their documentation.
