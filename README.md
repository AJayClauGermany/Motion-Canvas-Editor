# Motion Canvas Editor

A prototype animation editor built on Canvas Commons. You write a scene in the
style you prefer, and the editor shows it running next to the code, with a
timeline of every step.

It supports two styles, and the author chooses per scene:

- **Manim style**: Manim's vocabulary (`Scene`, mobjects, `play`) in Civet.
- **Canvas Commons style**: the engine's own API (`makeScene2D`, JSX nodes,
  refs, signals), in Civet or in the TSX that Motion Canvas users already
  write.

Both get the same editor: timeline, outline, inspector, click-to-select and
error lines. They can also be mixed in one scene.

The path from an idea to something you can post is short on purpose: the
editor opens on a scene of your own, it runs as you type, and **Export** turns
it into a video, a GIF, a web embed or an image with defaults that need no
decisions.

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

The same idea in Canvas Commons style:

```civet
import { makeScene2D, Circle } from "@canvas-commons/2d"
import { createRef } from "@canvas-commons/core"

export default makeScene2D (view) ->
  circle := createRef<Circle>()
  view.add <Circle ref={circle} size={240} fill="#58c4dd" />
  yield* circle().scale 2, 1
  yield* circle().position.x 300, 1
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
| Timeline | One block per step, labelled with your own source line: each `play`/`wait` in Manim style, each `yield*` statement in Canvas Commons style. Click a block to seek there and jump to the line |
| Scene panel | Mobjects and native nodes on screen at the current frame, and an inspector for the selected one |
| Cheat sheet | Manim (Python) → Civet, or Motion Canvas (TSX) → Civet, depending on the open scene |
| Reference pane | The source an example was ported from (Manim Python, or Canvas Commons TSX), or the compiled output, next to your source |
| My scenes | The editor opens on your own scene (a new one the first time, the last one after that). **+ New** adds another; its menu starts from the other style, a file, Manim Python or a copy. Scenes are saved in the browser as you type and renamed in place |
| Import Python | Paste a Manim scene in Python; a converter rewrites it to Civet and opens it as a new scene |
| Project folder | New ▾ → "Save my scenes in a folder…": every scene becomes a file in a folder you pick, written as you type and reloaded when something else changes it. See below |
| Sounds | The Sounds tab holds the project's clips. **Use** adds the line that plays one; the preview plays it, and it is part of the video and the web embed |
| Export | One button (Ctrl/Cmd+Shift+E), then Enter: MP4 video, GIF, web embed, PNG of the current frame, or the code. See below |
| Agent | Connect an AI agent you already use (Claude Code, Cursor, …) over MCP: it can read, edit, check and render the scene. See below |

Edits re-run after 250 ms and keep the playhead where it was. If the code does
not compile, the preview keeps showing the last version that did.

## Project folder

Without one, your scenes live in the browser's storage. With one, they are
files:

```
my-project/
  Intro.civet          one file per scene, named after it
  Demo.tsx
  assets/click.mp3     sound clips
  exports/intro.mp4    what Export writes (instead of the downloads folder)
```

- Pick the folder once (New ▾ → "Save my scenes in a folder…"). The scenes you
  already have are written into it, and scene files already there are opened.
- The editor writes a scene a moment after each edit, renames its file when
  you rename the scene, and deletes it when you delete the scene.
- Changes made to the files by anything else (your own editor, an AI agent
  with file access, `git checkout`) are picked up within two seconds: changed
  files reload, new files appear in the scene list, deleted files leave it.
- After a reload the browser asks before it lets the page use the folder
  again: click **Reconnect**. Until then edits are kept in the browser and
  written afterwards.
- If a file changed on disk and in the editor since the two last agreed (while
  the folder was locked, or because something wrote the file while you were
  typing), the file wins and your version is saved next to it as
  "… (unsaved copy)". Nothing is merged.
- Two tabs of the editor share the list of scenes. Editing the same scene in
  both at once is not coordinated: the last one to type wins.
- The folder chip in the top bar switches to another folder or stops using
  one; the scenes then stay in the browser and the files stay on disk.

This uses the browser's File System Access API, which Chrome and Edge have.
Safari, Firefox and the desktop app's webview do not, so there the menu entry
is missing and scenes stay in browser storage.

## Sound

Add clips in the **Sounds** tab (or drop files on it): mp3, wav, ogg, m4a,
aac, flac, opus. A scene plays a clip by its file name:

```civet
@add_sound "click.mp3"                          # Manim style; from the current time
@add_sound "whoosh.wav", time_offset: 0.5, gain: -6
```

```tsx
import {sound} from '@canvas-commons/core';
sound('click.mp3').play();                       // Canvas Commons style
sound('music.mp3').trim(2, 10).gain(-12).play();
```

The preview plays it (the speaker button in the transport mutes it). The
video export mixes every clip into one track: AAC where the browser can encode
it, Opus otherwise; the dialog says so when that happens, because QuickTime
may not play it. The web embed carries the clips it uses inside the HTML file
and starts muted with a speaker button, as browsers require of anything that
plays on its own. A GIF has no sound.

## Export

| Format | What you get | Default | Options |
|---|---|---|---|
| Video | MP4 (H.264) with the scene's sound, every frame rendered exactly | 1080p, 30 fps | 720p · 1080p · 4K, 30 · 60 fps |
| GIF | A looping GIF | 640 px wide, 20 fps | 480 · 640 · 960 px |
| Web embed | One self-contained HTML file with a small player (click to pause, scrub bar), and the `<iframe>` line to paste into your page | plays and loops while on screen | in the URL hash: `#autoplay=0&loop=0&controls=0&t=1.5` |
| Image | PNG of the frame under the playhead | 1080p | 720p · 1080p · 4K |
| Code | The scene's `.civet` or `.tsx` | | |

Video, GIF and image are rendered in a hidden second engine at the size of
the result, so the preview keeps playing and its quality setting does not
matter. Video uses WebCodecs (Chrome, Edge, Safari); a 3-second scene takes
about a second. Where H.264 cannot be encoded the file is WebM, and a webview
without WebCodecs falls back to recording the preview while it plays.

The web embed is the Canvas Commons player with the compiled scene inside
(`player.html`, built into `player-template.html`): about 2.8 MB, 0.9 MB
gzipped, with no dependencies and no network requests.

## AI agents (MCP)

There is no chat inside the editor. It exposes an MCP server instead, so an
agent in your own tools can work on the open scene: read it, edit it, check
it, render frames, look up the API and read bundled docs.

```bash
claude mcp add motion-canvas -- bun run --cwd /path/to/Motion-Canvas-Editor mcp   # or: bun run mcp:http
```

Then switch **Agent** on in the editor's top bar. Agents may write TSX,
Civet, a mix, or Manim Python: the tools convert it to the document's language
and repair what would compile to something else. Edits can land at once
(undo with Ctrl/Cmd+Z) or wait for you to accept them.

The agent has the same workflow as you, through tools: start a scene, edit,
check, look at frames, and `export_scene` to a file. You can take over at any
point: the agent is told what you changed before its next step, its edits
merge with your text, and it cannot replace work it has not seen. Its own
changes are marked in the code. Details, tools and security:
[docs/agents.md](docs/agents.md).

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
| Source language | Civet · TSX (compiled without Civet). Applies to both styles, and switching converts the open scene | Civet |
| On launch | your own scene · a gallery example | your own scene |
| Layout | Studio · Split · Stage | Studio |
| When to re-run | as you type · on Ctrl/Cmd+Enter | as you type |
| Reference pane | hidden · Manim (Python) · compiled TS | hidden |
| Cursor ↔ time | independent · cursor on a `play` line seeks to it | independent |
| Highlight running line | on · off | on |
| Timeline style | blocks · numbered steps · scrubber only | blocks |
| Coordinate grid | off · on | off |
| Preview quality | draft · standard · high | standard |
| Theme | Midnight · Slate · Paper | Midnight |
| Agent edits | apply · ask first | apply |

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
- **`player.html`** and `src/player.ts` are the web embed: the engine without
  the editor or the compiler. `bun run build` also builds it as one file,
  `dist/player-template.html`, which the export fills with a scene.
- **`shell/`** is the Electrobun desktop shell around the web build.
- **`examples/`** holds the bundled scenes. Each has `scene.civet`, optionally
  the original `manim.py`, and `meta.json`.

### Two styles, one pipeline

| | Manim style | Canvas Commons style |
|---|---|---|
| Starts with | `from manim import *` and a `Scene` class | imports from `@canvas-commons/*` and `export default makeScene2D ...` |
| Units | Manim units, y up, frame 8 tall | pixels, y down, 1920 × 1080 |
| Language | Civet or TSX | Civet or TSX |
| Timeline step | each `@play` / `@wait` | each `yield*` statement of the scene function |
| Outline and inspector | mobjects | nodes |
| The other world | native nodes are mobjects (`wrap`) | `useManim(view)` |
| Examples | `examples/*` with `manim.py` | `examples/cc-*` with `original.tsx` |

Nothing is translated between the two: a Manim `Scene` is itself a
`makeScene2D` scene, and each mobject is drawn by a Canvas Commons node. That
is why they mix, in both directions (`src/manim/interop.ts`, `examples/mix-*`):

- A native node works wherever a mobject does: `VGroup(circle, <Rect … />)`,
  `arrange`, `next_to`, `FadeIn(node)`, `wrap(node).animate.shift(UP)`. It
  stays a node, so `yield* node.opacity(1, 0.5)` still works, and `play` takes
  such tweens next to Manim animations.
- A mobject works wherever a node does: `<Rect><Circle radius={1} /></Rect>`
  or `view.add(mob)` draws it in the parent's coordinate system.
- A native scene gets `play`, `wait`, `add` and the camera from
  `m := useManim(view)`.
- `px`, `units`, `to_pixels` and `to_units` convert between units and pixels.

Mobjects can also be written as JSX (`<Circle radius={2} color={BLUE} />`);
see `examples/jsx-mobjects`. The rules and limits of mixing are in
[docs/manim-compatibility.md](docs/manim-compatibility.md#mixing-with-canvas-commons-nodes).
Either style can be written in either language. In TSX the compiler adds no
syntax sugar: `yield*` is always written out, Manim names are imported from
`'manim'`, and comments are `//`. Vector arithmetic (`2 * UP + LEFT`) still
works in a TSX scene that imports the Manim layer. Opening a `.tsx` or `.civet`
file selects its language.

## Tests

```bash
bun test                 # compiler, dialect, Python converter, Bézier and vector maths
bun run typecheck
node tools/e2e.cjs       # renders every example (and each TSX original) headless, contact sheets in artifacts/e2e/
node tools/ui-smoke.cjs  # drives the editor UI headless, screenshots in artifacts/ui/
node tools/agent-e2e.cjs # an MCP client drives the editor through the MCP server, screenshots in artifacts/agent/
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
- Decorators are the legacy TypeScript kind (`experimentalDecorators`), which
  is what Canvas Commons components use: `@signal()`, `@initial()`,
  `@computed()` and the like work on class members and on classes, in TSX and
  (written `@@signal()`) in Civet, while parameter decorators, decorators on
  `#private` members and standard (TC39) decorator semantics are not supported.
- Civet → TSX is exact (it is the Civet compiler's output plus an import
  list). TSX → Civet is best-effort: it keeps braces and parentheses, and it
  declines when the TSX uses something Civet cannot parse, such as a comment
  inside a JSX tag. Switching back to the language a scene came from is
  lossless as long as the converted text was not edited.
- The `yield*` and `self` switches only mean something in Civet; in TSX both
  are always explicit.
- Mixing has edges: a `Transform` between a native node and a shape travels
  but does not morph, a node positioned by flexbox cannot be moved from the
  Manim side, and a mobject hosted in a native tree is not a flex item. The
  full list is in [docs/manim-compatibility.md](docs/manim-compatibility.md)
  under "Mixing with Canvas Commons nodes".
- A GIF uses a separate palette per frame (fine for flat graphics, visible
  banding on gradients).
- Sound in a video is AAC only where the browser has an AAC encoder. The
  headless Linux Chromium the tests run in has none and writes Opus into the
  MP4; other browsers have not been checked. The real-time fallback records no
  sound.
- Frame-exact video needs WebCodecs. Whether the Linux desktop webview
  (WebKitGTK) has it has not been checked; without it the export records in
  real time, and without `MediaRecorder` too there is no video export.
- The project folder needs Chrome or Edge. The desktop app cannot use one yet:
  its webview lacks the API, and the shell has no file bridge of its own.
- Assets are sound clips only; images and SVG are not supported by the Manim
  layer.

## Licence

See [LICENSE](LICENSE). Dependencies keep their own licences; the one that is
not permissive is Mediabunny (MPL-2.0, used unmodified for video export). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
