# Motion Canvas Editor

A prototype editor for Manim-style animations, written in Civet and rendered by
Canvas Commons. You write a scene the way you would in Manim, and the editor
shows it running next to the code, with a timeline of every `play` call.

```civet
from manim import *

class SquareToCircle extends Scene
  construct()
    circle := Circle()
    circle.set_fill PINK, opacity: 0.5

    square := Square()
    square.rotate PI / 4

    @play Create square
    @play Transform square, circle
    @play FadeOut square
```

This is a prototype built to get feedback. Several design choices are still
open, and the editor has a **Lab** panel that switches between the variants so
they can be compared side by side.

## Run it

```bash
bun install
bun run dev          # http://127.0.0.1:5273
```

Desktop app (Electrobun 2): `bun run shell:dev`. See
[docs/desktop-shell.md](docs/desktop-shell.md).

In the Claude Code cloud sandbox, run `tools/sandbox/setup.sh` first (see
[CLAUDE.md](CLAUDE.md)).

## What is in the editor

| Area | What it does |
|---|---|
| Code pane | Civet source with highlighting, completion for the Manim vocabulary, inline errors mapped to the right source line, and a marker on the line that is currently playing |
| Preview | Live Canvas Commons render. Click a mobject to select it. Optional unit grid |
| Timeline | One block per `play`/`wait`, labelled with your own source line. Click a block to seek there and jump to the line |
| Scene panel | Mobjects on screen at the current frame (with their submobjects), and an inspector for the selected one |
| Manim → Civet | A cheat sheet of the syntax differences |
| Reference pane | The original Manim Python for an example, or the TypeScript that Civet produces, next to your source |
| Import Python | Paste a Manim scene in Python; a converter rewrites it to Civet and opens it |
| Export | Current frame as PNG, or a real-time video recording (Chromium only) |

Edits re-run after 250 ms and keep the playhead where it was. If the code does
not compile, the preview keeps showing the last version that did.

## Choices to review (the Lab)

Open **⚗ Lab** in the top bar. Each choice changes the editor immediately; the
language choices also rewrite the current buffer, so the same scene can be read
in each variant. "Copy feedback summary" puts the selected variants and your
notes on the clipboard as Markdown.

| Choice | Variants | Default |
|---|---|---|
| Animation calls | `@play …` (compiler inserts `yield*`) · `yield* @play …` | `@play …` |
| Method names | `snake_case` · `camelCase` (both always work) | `snake_case` |
| Scene reference | `@play` · `self.play` | `@play` |
| Vector math | `2 * UP + LEFT` via operator overloading · plain JS | overloading |
| Layout | Studio · Split · Stage | Studio |
| When to re-run | as you type · on Ctrl/Cmd+Enter | as you type |
| Reference pane | hidden · Manim (Python) · compiled TS | hidden |
| Cursor ↔ time | independent · cursor on a `play` line seeks to it | independent |
| Highlight running line | on · off | on |
| Timeline style | blocks · numbered steps · scrubber only | blocks |
| Coordinate grid | off · on | off |
| Preview quality | draft · standard · high | standard |
| Theme | Midnight · Slate · Paper | Midnight |

The definitions live in [`src/editor/settings.ts`](src/editor/settings.ts);
adding a variant is one entry there plus the code that reads it.

## How it works

```
 scene.civet
     │  dialect pre-pass   from manim import *, implicit yield*, self → @
     ▼
   Civet ──▶ TypeScript ──(sucrase)──▶ JS ──(acorn)──▶ operator overloading
     │
     ▼  evaluated in the page
 Scene subclass ──▶ Canvas Commons generator scene ──▶ Player + Stage ──▶ <canvas>
     │
     └── records each play(): label, start, end, source line ──▶ timeline
```

- **`src/manim/`** is the Manim vocabulary on top of Canvas Commons: mobjects
  with Manim-style Bézier points and units (frame 8 units tall, y up),
  geometry, text, LaTeX (MathJax outlines, so formulas morph and can be
  coloured per glyph), animations, `.animate`, updaters, value trackers,
  coordinate systems, and `Scene`. Each leaf mobject is drawn by a Canvas
  Commons node, so native nodes and Manim mobjects can share a scene. See
  [docs/manim-compatibility.md](docs/manim-compatibility.md) for coverage.
- **`src/runtime/`** compiles and runs scenes in the browser. There is no
  server round trip, which is what lets the same build run as a web page and
  inside the desktop shell. `python.ts` is the Python → Civet converter.
- **`src/editor/`** is the UI in Solid 2.
- **`shell/`** is the Electrobun desktop shell around the web build.
- **`examples/`** holds the bundled scenes. Each has `scene.civet`, optionally
  the original `manim.py`, and `meta.json`.

Scenes written in Canvas Commons' own style (`makeScene2D`, JSX, signals) run
through the same pipeline; see `examples/canvas-commons-basics`.

## Tests

```bash
bun test                 # compiler, dialect, Python converter, Bézier and vector maths
bun run typecheck
node tools/e2e.cjs       # renders every example headless, writes contact sheets to artifacts/e2e/
node tools/ui-smoke.cjs  # drives the editor UI headless, screenshots in artifacts/ui/
```

The last two need Playwright with Chromium. They use the dev server on port
5273 and start one if it is not running (`E2E_URL` points them elsewhere, for
example at `vite preview`).

## Known limits

- The Manim layer covers the 2D core, not all of Manim: no 3D scenes, images,
  SVG import, boolean path operations or `MarkupText`.
- `Text` is drawn with the canvas text API, one leaf per character. It can be
  written, faded, coloured and moved per letter, but it cannot morph into a
  shape the way outlines do. `MathTex` and `Tex` are real outlines.
- The Python converter translates syntax. It does not know numpy or Python's
  standard library beyond a small `np` shim.
- The timeline has steps only for Manim-style scenes. Native Canvas Commons
  scenes get the scrubber.
- Video export records in real time with `MediaRecorder`, which the Linux
  desktop webview (WebKitGTK) does not support. Frame-exact rendering through
  Canvas Commons' renderer is not wired up yet.
- One scene file at a time. Open and Save use the browser's file picker and
  downloads; there is no project folder yet.

## Licence

See [LICENSE](LICENSE).
