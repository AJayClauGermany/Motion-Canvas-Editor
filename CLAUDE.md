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

Verified working in the sandbox: build and run the `bun-ui` template headless:
```bash
source tools/sandbox/hutch-env.sh
bunx electrobun build --env=dev
xvfb-run -a -s "-screen 0 1280x800x24" bunx electrobun run --env=dev   # WebGPU via Mesa llvmpipe; screenshot with `import -window root shot.png`
```
Canvas Commons scenes can be previewed or rendered in headless Chromium. Playwright is preinstalled; don't reinstall it.

None of this sandbox tooling is needed on a normal dev machine: use `hutch` / `bunx electrobun` directly.

## Architecture

- **Main editor UI** (timeline, inspector, scene tree, code panes, preview) is **Solid 2 in an Electrobun webview** (`BrowserWindow` / `BrowserView`).
- **The Canvas Commons preview has to live in a webview.** Electrobun UI has no 2D `<canvas>`.
- **Electrobun UI** (GPU, no webview) is used selectively, for surfaces where it's worth trying: e.g. a launcher, palettes and HUD-style panels, or native-feel windows. Code for these is Warren JSX (`electrobun/main/ui`). Warren's API resembles Solid's (`signal`, `Show`, `For`), but it's a different library, so don't mix the imports.
- **Mixing them:** `ui.anchor(element, browserView)` positions a webview over a GPU-UI element. Anchored native views always draw **on top of** the GPU UI and aren't clipped, so GPU-UI popups can't overlap them. Keep overlays on the same layer as what they cover.

## Conventions
- Scenes are written in Civet (`*.civet`) and compiled by `@danielx/civet/vite` (`civet({ts: 'preserve'})`) **before** `@canvas-commons/vite-plugin`.
- **Three JSX worlds**, kept in separate directories and tsconfig scopes:
  - Canvas Commons scenes: `"jsx": "react-jsx"`, `"jsxImportSource": "@canvas-commons/2d/lib"`.
  - Solid editor UI: compiled by `@solidjs/vite-plugin`, scoped with `solid({include: [<editor dir>/**]})`, with `"jsx": "preserve"`, `"jsxImportSource": "@solidjs/web"` (**not** `solid-js` as in 1.x). If Solid's compiler sees scene files, it will break them.
  - Electrobun UI: `"jsxImportSource": "electrobun/main/ui"` (main process, bundled by Hutch, not Vite).
- Vite plugin order: `civet({ts: 'preserve'})`, then `solid({include: [...]})`, then `canvasCommons()`. Verified 2026-11-21: Civet `.civet` files work for both Solid components and scenes. A Solid 2 component written in Civet renders and updates in Chromium.
- Package manager: Bun.
