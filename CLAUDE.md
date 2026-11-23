# Motion-Canvas-Editor

A portable, Manim-like animation editor built with web tech:

| Layer | Tech | Package / version checked 2026-11-21 |
|---|---|---|
| Desktop shell | **Electrobun 2** (Bun main process, system webview or GPU-native UI). **Not Electron.** | `electrobun@2.0.7` (Hutch 0.30.0, Bun 1.4.4) |
| Editor UI (main) | **Solid 2**, rendered in an Electrobun webview. **Not Solid 1.x and not React**: read the `solid-2.0` skill (`.claude/skills/solid-2.0/SKILL.md`) before writing Solid code | `solid-js@2.0.3`, `@solidjs/web@2.0.3`, `@solidjs/vite-plugin@3.0.1` (needs `@babel/core`) |
| Native GPU UI (selective) | **Electrobun UI**: Zig HTML/CSS engine on WebGPU (Dawn), no webview. Part of the `electrobun` package. Uses Electrobun's own JSX library, Warren, **not Solid**. Only for specific surfaces (see Architecture) | `import { createUIWindow } from "electrobun/main/ui"`, `jsxImportSource: "electrobun/main/ui"` |
| Animation engine | **Canvas Commons**, the community fork of Motion Canvas. Use `@canvas-commons/*`, **not** `@motion-canvas/*` | `@canvas-commons/{core,2d,editor,player,vite-plugin,ffmpeg}@0.4.0` (`next` tag exists) |
| Scene language | **Civet** (CoffeeScript-flavoured TS superset → TS/TSX) | `@danielx/civet@0.11.17`, Vite plugin `@danielx/civet/vite` |
| Bundler | Vite (Canvas Commons' plugin is Vite-only) | `vite` |

Manim (Community + 3b1b ManimGL) and the original Motion Canvas are **cross-reference material only**: prior art for API and feature design, not dependencies.

All of these move fast. **Don't trust memory for APIs. Check the docs below first.**

## Where the docs are

### Local (offline, greppable): run `tools/refs.sh` first
Shallow clones live in `.refs/` (gitignored). Re-run `tools/refs.sh` to update them.

| What | Path |
|---|---|
| Electrobun docs (MDX) | `.refs/electrobun/docs/src/content/docs/electrobun/{apis,guides}` |
| Electrobun UI docs | `.refs/electrobun/docs/src/content/docs/electrobun/apis/ui/*.mdx`, engine notes at `.refs/electrobun/package/src/ui-core/README.md` |
| Electrobun templates | `.refs/electrobun/templates/` (`bun-ui`, `ui-launcher`, `vanilla-vite`, `react-tailwind-vite`, `wgpu`, …) |
| Electrobun SDK source | `.refs/electrobun/package/src/sdks/` and `.refs/electrobun/CLAUDE.md` |
| Hutch (build CLI) source | `.refs/hutch/src/` |
| Canvas Commons docs | `.refs/canvas-commons/packages/docs/docs/` (see `migration/from-motion-canvas.mdx`) |
| Canvas Commons source | `.refs/canvas-commons/packages/{core,2d,editor,player,vite-plugin}/src` |
| Civet docs | `.refs/civet/civet.dev/*.md` (`reference.md` is the full syntax reference), `.refs/civet/CLAUDE.md` |
| Solid 2 API (authoritative) | `.refs/solid/packages/solid/CHEATSHEET.md`, `.refs/solid/documentation/solid-2.0/MIGRATION.md` (1.x → 2.0), `.refs/solid/packages/solid/skills/solid-2.0/SKILL.md`, `.refs/solid/AGENTS.md` (says which docs are current). `documentation/solid-2.0/01-12` are frozen RFCs, history only |
| Solid docs site source | `.refs/solid-docs/src/routes/`. **`main` is still mostly Solid 1.x** (`solid-js/web` instead of `@solidjs/web`); v2 pages are on `docs/solid-2-*` branches. Prefer the cheatsheet |
| *Cross-ref:* Motion Canvas (original) | `.refs/motion-canvas/packages/docs/docs/`, `.refs/motion-canvas/packages/*/src`. Diff against Canvas Commons to see what the fork changed |
| *Cross-ref:* Manim Community | `.refs/manim/docs/source/` (guides/tutorials, rst), `.refs/manim/manim/` (API reference = docstrings: `mobject/`, `animation/`, `scene/`, `camera/`) |
| *Cross-ref:* ManimGL (3b1b) | `.refs/manimgl/docs/source/`, `.refs/manimgl/manimlib/` |

### Online (allowed in the cloud environment)
- Electrobun: https://docs.electrobun.dev/electrobun/ (also https://electrobun.dev, https://framework.blackboard.sh)
- Canvas Commons: https://canvascommons.io/docs/ (mirror https://canvas-commons.github.io)
- Civet: https://civet.dev (`/reference`, `/integrations`)
- Motion Canvas (original): https://motioncanvas.io/docs/
- Manim Community: https://docs.manim.community/en/stable/ (reference: `/en/stable/reference.html`)
- ManimGL (3b1b): https://3b1b.github.io/manim/
- Solid: https://docs.solidjs.com (`/llms.txt`, `/llms-full.txt`; may still describe 1.x), https://playground.solidjs.com
- Bun: https://bun.com/docs, https://bun.com/llms.txt
- Vite: https://vite.dev, https://vite.dev/llms.txt
- Raw GitHub files: `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` works. `github.com` HTML pages are blocked, but `git clone` and release downloads work.
- npm metadata: `curl -s https://registry.npmjs.org/<pkg> | jq '."dist-tags"'`

## Cloud sandbox quirks (Claude Code on the web)

Run **`tools/sandbox/setup.sh`** once per fresh container. It's idempotent: apt runtime libs, Hutch Bun toolchain, `.refs/`, `bun install`. The environment setup script may already have run it.

**Hutch can't reach the network through the sandbox proxy.** Hutch is Electrobun 2's Zig build CLI. Zig `std.http` opens the proxy CONNECT tunnel, then sends plaintext, and the proxy resets the connection (`ReadFailed`). Workarounds:
1. `source tools/sandbox/hutch-env.sh` before any `hutch`/`electrobun` command. It starts `tools/sandbox/hutch-relay.ts`, a Bun relay on `127.0.0.1:47800` that forwards through the normal proxy, and points `DASH_ARTIFACTS_BASE_URL`, `ELECTROBUN_TEMPLATES_BASE_URL`, `ELECTROBUN_RELEASES_BASE_URL` and `NPM_CONFIG_REGISTRY` at it.
2. Hutch's Bun toolchain URL is hardcoded to github.com, so `tools/sandbox/seed-hutch-toolchains.sh <ver>` downloads it with curl into `~/.hutch/toolchains/bun/<ver>/<platform>/`. If Hutch says `could not resolve the bun X toolchain`, run it with that `X`.
3. Use **`bun install`**, not `hutch install`. Lockfile tarball URLs bypass the relay.
4. `electrobun init` needs a global Hutch. Don't use it; copy a template from `.refs/electrobun/templates/<name>` instead.
5. The `electrobun` npm bin downloads its paired Hutch to `~/.hutch/npm/electrobun/<ver>/linux-x64/bin/hutch` (this works). Call that binary directly, or `bunx electrobun …`.
6. Run `bunx electrobun --version` once **before** sourcing `hutch-env.sh` in a fresh container. With the relay env already set, the first call fails with `could not acquire paired Hutch: Protocol "http:" not supported`; once the paired Hutch is cached it works.

Verified working in the sandbox: build and run the `bun-ui` template headless:
```bash
source tools/sandbox/hutch-env.sh
bunx electrobun build --env=dev
xvfb-run -a -s "-screen 0 1280x800x24" bunx electrobun run --env=dev   # WebGPU via Mesa llvmpipe; screenshot with `import -window root shot.png`
```
Canvas Commons scenes can be previewed or rendered in headless Chromium. Playwright is preinstalled; don't reinstall it. It is a global CommonJS install: `require('playwright')` works from a `.cjs` script run with `node`, but an ESM `import` or a Bun script does not find it. That is why `tools/e2e.cjs` and `tools/ui-smoke.cjs` are `.cjs`.

None of this sandbox tooling is needed on a normal dev machine: use `hutch` / `bunx electrobun` directly.

## Repo layout and commands

| Path | What |
|---|---|
| `src/manim/` | The Manim-style layer on Canvas Commons (TypeScript): `mobject.ts` (Mobject/VMobject on Manim-style Bézier points, units, y up), `geometry.ts`, `text.ts`, `tex.ts`, `animation.ts`, `graphing.ts`, `scene.ts`, `interop.ts` (native nodes as mobjects and the reverse). `index.ts` builds `api`, the flat namespace a scene gets from `from manim import *` |
| `src/runtime/` | `compile.ts` (Civet or TSX → JS in the browser, timeline step instrumentation), `decorators.ts` (legacy decorators lowered before sucrase), `engine.ts` (Canvas Commons `Player` + `Stage` wrapper, timeline, outline, picking), `dialect.ts` (Manim dialect variants), `convert.ts` (Civet ⇄ TSX), `python.ts` (Manim Python → Civet) |
| `src/editor/` | The editor UI, Solid 2. `state.ts` is the single state object; `settings.ts` defines the Lab flags |
| `src/mcp/` | MCP server for outside AI agents (`docs/agents.md`): `server.ts` tools/prompts/resources, `hub.ts` the 127.0.0.1 HTTP server the editor page connects to, `protocol.ts` shared message types. `src/editor/agent.ts` is the page's side |
| `docs/agents/` | Docs the MCP server serves to agents (`read_docs`), imported as text. Every complete scene in them must compile with no hints (`tests/agent.test.ts`) |
| `shell/`, `electrobun.config.ts` | Electrobun desktop shell around the Vite build (`docs/desktop-shell.md`) |
| `examples/<slug>/` | Bundled scenes: `scene.civet`, `meta.json` (`style`: `manim` or `canvas-commons`), and the source it was ported from: `manim.py` for Manim examples, `original.tsx` for native ones (`cc-*`) |
| `harness.html`, `src/harness.ts` | Editor-less page exposing `window.harness` for headless rendering |
| `tests/` | `bun test` unit tests for the DOM-free modules |

```bash
bun run dev              # editor on http://127.0.0.1:5273
bun run build            # dist/  (also the input of the desktop shell)
bun run typecheck
bun test
node tools/e2e.cjs [slug…]   # render examples headless → artifacts/e2e/<slug>.png contact sheets; LOOK at them
node tools/ui-smoke.cjs      # drive the editor UI headless → artifacts/ui/*.png
node tools/agent-e2e.cjs     # MCP client → MCP server → editor in headless Chromium → artifacts/agent/*.png
bun run mcp / bun run mcp:http   # MCP server (stdio / http://127.0.0.1:5275/mcp); bun tools/mcp-client.ts to call it by hand
bun run shell:dev        # desktop app (sandbox: see quirks above)
```

## Architecture

- **Scenes are compiled and run in the browser**, not by a dev server: Civet → TypeScript → sucrase (types, JSX, CommonJS) → optional operator-overloading rewrite → `new Function`. The engine then drives a Canvas Commons `Player` and `Stage` directly. This is what lets one web build run both as a page and inside the Electrobun webview, so **`@canvas-commons/vite-plugin` is not used**. Every stage preserves line numbers; runtime lines map back to source through Civet's source map only.
- **The Manim layer wraps, it does not fork.** A Manim `Scene` subclass becomes an ordinary `makeScene2D` generator scene; each leaf mobject owns one Canvas Commons node (`MobNode`) that paints it. Seeking re-runs the scene from the start, as Canvas Commons always does, so mobjects must be created inside `construct`.
- **Never mutate a mobject's `points` array in place.** Replace it. The `Path2D` cache keys on array identity.
- **Dialect sugar lives in `compile.ts`'s pre-pass**: `from manim import *` (enables the prelude), implicit `yield*` before `@play`/`@wait` and before helper methods that animate, `self.` → `@`, `# comments` (Civet `coffeeComment`, which disables `#` length shorthand and `#private` in scenes).
- **Decorators are lowered before sucrase, which cannot compile them**: `lowerDecorators` (`src/runtime/decorators.ts`) is a line-preserving scanner, not a parser, that blanks legacy (`experimentalDecorators`) decorators and appends TypeScript's `__decorate([...], X.prototype, "name", void 0 | null)` calls on the line of the class's closing brace. `__decorate` is exported from the same file and reaches scenes through `Engine.runtimeScope`. In Civet a decorator is written `@@name(...)`, because `@` alone is `this`.
- **Two authoring styles are first-class and must stay at parity**: Manim style (`from manim import *`, a `Scene` class) and Canvas Commons style (`export default makeScene2D ...`, in Civet or TSX). When adding an editor feature, make it work for both or say why not. The mechanisms that give native scenes parity:
  - `instrumentSteps` in `compile.ts` wraps each `yield*` statement of the `makeScene2D` callback (and non-`this` `yield*` statements in Manim scene methods) in `__step(line, kind, name, …)`, which records timeline steps. `__step`, `__stepsBegin`, `__stepsDone` come from `Engine.runtimeScope`.
  - `engine.ts` outline/inspect/bounds/pick handle both mobjects (numeric ids) and native nodes (string keys, read inside `startScene`/`endScene`). World space for nodes has its origin at the top-left of the frame.
  - `language: 'tsx'` in `CompileOptions` skips Civet and all dialect sugar (operator overloading stays on for a TSX scene that imports `'manim'`). The Lab's "Source language" flag applies to both styles and converts the open document with `src/runtime/convert.ts`: `civetToTsx` is exact (Civet's own output plus an import list for `from manim import *`), `tsxToCivet` is best-effort and must keep producing Civet that compiles (`civetCompat` parenthesises single-parameter arrows, which Civet would otherwise read as calls). `tools/e2e.cjs` converts every scene to the other language and fails if steps or duration differ.
  - Mobject classes accept JSX calls (`fromJsx` in `src/manim/util.ts`).
  - **The two styles mix in both directions** through `src/manim/interop.ts` (`docs/manim-compatibility.md`, "Mixing with Canvas Commons nodes"; `examples/mix-*`):
    - `NodeMobject` wraps a native node as a leaf mobject. `toMobject` (scenes: `wrap`) is called wherever the Manim layer is handed a node: through `hooks.toMobject` in `util.ts` for the modules below `interop.ts` (`callable` converts constructor arguments, `Mobject.add`, `next_to`, animations) and directly in `scene.ts`. State is two-way: `NodeMobject._sync` pulls what the native side changed and pushes what Manim changed (`reconcile` in `interop_math.ts`, the DOM-free part with the unit helpers). `Scene.sync()` gets a leaf's node from `Mobject._makeNode`, so a wrapped node sits in the mobjects' z-order, and it also runs before every render (`_renderSync`).
    - `MobjectHost` is a node that draws a mobject in its own local space. `Node.prototype.parseChildren` and `insert` are patched once to create it for a mobject child. `Scene.sync()` skips leaves that a host draws (`hostOf`).
    - `useManim(view)` (`scene.ts`) attaches a `Scene` without a class to a native scene. Such a scene is not `selfReporting`: `Engine.recordStep` keeps the native steps as the timeline and the scene's `play` annotates the open step instead of recording its own.
    - `Scene.play` runs generator arguments (native tweens) as child threads next to the animations.
- **AI agents connect from outside, over MCP; there is no chat in the app.** The editor page connects to the MCP server's hub (`ws://127.0.0.1:5275/editor`) when "Agent" is on; the desktop shell runs the hub in its main process on request. Code from agents goes through `src/runtime/normalize.ts` (detects Civet/TSX/Python, converts to the document's language and dialect, repairs `x => y`, `name=value`, missing `yield*`) and `src/runtime/hints.ts` (heuristic mistakes). Runs and renders for agents use `harness.html?agent` in a hidden iframe: a separate engine with a message-channel clock, because a background tab gets no `requestAnimationFrame`. A new editor feature that agents should reach needs a method in `src/mcp/protocol.ts`, a handler in `src/editor/agent.ts` and a tool in `src/mcp/server.ts`.
- **Every user-facing design choice still under evaluation is a Lab flag** in `src/editor/settings.ts`. Add a flag rather than hard-coding a new variant.

- **Main editor UI** (timeline, inspector, scene tree, code panes, preview) is **Solid 2 in an Electrobun webview** (`BrowserWindow` / `BrowserView`).
- **The Canvas Commons preview has to live in a webview.** Electrobun UI has no 2D `<canvas>`.
- **Electrobun UI** (GPU, no webview) is used selectively, for surfaces where it's worth trying: e.g. a launcher, palettes and HUD-style panels, or native-feel windows. Code for these is Warren JSX (`electrobun/main/ui`). Warren's API resembles Solid's (`signal`, `Show`, `For`), but it's a different library, so don't mix the imports.
- **Mixing them:** `ui.anchor(element, browserView)` positions a webview over a GPU-UI element. Anchored native views always draw **on top of** the GPU UI and aren't clipped, so GPU-UI popups can't overlap them. Keep overlays on the same layer as what they cover.

## Conventions
- Scenes are written in Civet (`*.civet`) and compiled **in the browser** by `src/runtime/compile.ts`. Example scenes reach the editor as text through the `virtual:examples` module (`tools/vite-examples.ts`); do not import them with `?raw`, because `@danielx/civet/vite` claims every `.civet` import. The Vite Civet plugin is only for app modules written in Civet.
- **Three JSX worlds**, kept in separate directories and tsconfig scopes:
  - Canvas Commons scenes: `"jsx": "react-jsx"`, `"jsxImportSource": "@canvas-commons/2d"` (0.4.0 exports `@canvas-commons/2d/jsx-runtime`; the older `/lib` path is not exported). The in-browser compiler sets this itself.
  - Solid editor UI: compiled by `@solidjs/vite-plugin`, scoped with `solid({include: [<editor dir>/**]})`, with `"jsx": "preserve"`, `"jsxImportSource": "@solidjs/web"` (**not** `solid-js` as in 1.x). If Solid's compiler sees scene files, it will break them.
  - Electrobun UI: `"jsxImportSource": "electrobun/main/ui"` (main process, bundled by Hutch, not Vite).
- Vite plugin order: `examplesPlugin()`, `civet({ts: 'preserve'})`, then `solid({include: ['src/editor/**']})`. If a project ever needs `canvasCommons()` again (file-based scenes with HMR), it goes last. Verified 2026-11-21: Civet `.civet` files work for both Solid components and scenes.
- Solid 2 dev builds print diagnostics (`STRICT_READ_UNTRACKED`, `REACTIVE_WRITE_IN_OWNED_SCOPE`, …) to the console; `tools/ui-smoke.cjs` fails on any of them. Fix the cause, don't silence it.
- Manim-layer methods are written in camelCase; `aliasSnake` adds the snake_case spelling. Python-style signatures use `kw(args, [positional names], {defaults})` from `src/manim/util.ts`, so a trailing object literal is the keyword arguments.
- Package manager: Bun.
