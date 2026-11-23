# Reviewing a scene

How to review or debug a scene with the editor's tools, and what to look for.
Report findings with their line numbers, what the viewer would see, and the
fix. check_scene hints are heuristics: confirm one in the code or a rendered
frame before reporting it.

## 1. Does it run?

- `check_scene` (no arguments: the open document). Compile problems come with
  a stage: `civet` (syntax), `transform` (TypeScript/JSX), `runtime` (thrown
  while playing, with the line that threw).
- A runtime "X is not defined" for a Manim name usually means a missing
  `from manim import *`, or a Manim feature that does not exist here:
  `lookup_api` it.
- "No scene found": the file needs a class extending `Scene` or an
  `export default makeScene2D(...)`.

## 2. Does it do what the code says?

These compile but misbehave:

- Civet: `x => y` without parentheses (a call of `x`), `run_time=2` (an
  assignment), `#field` (a comment), `"${x}"` (no interpolation).
- TSX or explicit-yield Civet: `this.play(...)` without `yield*` (nothing
  happens); `yield` instead of `yield*` (waits one frame).
- Native: a tween with a duration that is not under `yield*`.
- `mob.points[i] = …` or `points.push(…)`: no visible effect.
- Mobjects created outside `construct`, or randomness without a seed: the
  scene changes when the user seeks.
- `Transform(a, b)` keeps `a` on screen (as `b`'s shape); later code must
  refer to `a`, or use `ReplacementTransform`.
- An updater that is never removed keeps running in later steps.

## 3. Does it look right?

- `render_preview` (default 8 frames). Look for: text or shapes cut off at the
  frame edge, overlaps, elements too small to read, low contrast on the dark
  background, objects left on screen after their moment, abrupt jumps between
  steps.
- `inspect_frame` at a suspicious time lists every item with bounds; the
  layout warnings flag off-frame items and overlapping text.
- Manim frame: x ±7.11, y ±4. Keep text inside about x ±6.5, y ±3.5.

## 4. Timing

- From the timeline in get_editor_state: steps that are too fast to read
  (text written in under ~0.5 s), long stretches with nothing moving, a final
  `wait` so the last state is visible.
- `run_time`, `lag_ratio` and `rate_func` (Manim style); durations and easing
  arguments (native style).

## 5. Idiom and maintainability

- Manim style: prefer `.animate`, `next_to`/`arrange` over hard-coded
  coordinates; group related mobjects in `VGroup`; one helper method per
  section of a long scene.
- Native style: refs instead of searching the tree; signals with functions
  for values that follow each other; `all`/`sequence` instead of manual timing.
- Match the document's dialect (get_editor_state: naming, yield style).

## Verifying a fix

Make the change with edit_scene (or propose it, if the user asked for a
review only), then read the returned run report and render again. A fix is
done when check_scene reports no problems and the frames show the intended
result.
