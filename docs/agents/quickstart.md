# Motion Canvas Editor: start here

An animation editor built on Canvas Commons (the community fork of Motion
Canvas). A scene is code; the editor compiles it in its own page, plays it, and
shows a timeline with one step per animation, each tied to a source line.

## Two styles

| | Manim style | Canvas Commons style ("native") |
|---|---|---|
| Looks like | Manim Community: `Scene`, mobjects, `play`, `wait` | Motion Canvas: `makeScene2D`, JSX nodes, refs, signals |
| Starts with | `from manim import *` (Civet) or `import {...} from 'manim'` (TSX), then `class X extends Scene` | imports from `@canvas-commons/2d` and `/core`, then `export default makeScene2D(...)` |
| Units | Manim units: frame 14.22 × 8, origin at the centre, y up | pixels: 1920 × 1080, origin at the centre, y down |
| Timeline step | each `play` / `wait` | each `yield*` statement of the scene function |

They mix: mobjects can sit inside native scenes (`useManim(view)`) and native
nodes inside Manim scenes (read_docs topic `mixing`).

## Two languages

Each document is edited in **Civet** or **TSX**; get_editor_state tells you
which. Civet is indentation-based TypeScript with less punctuation and a few
Manim conveniences (`@play` without `yield*`, `# comments`). TSX is plain
TypeScript + JSX, exactly what Motion Canvas users write.

**If you are unsure of Civet, write TSX.** write_scene, open_scene,
check_scene and convert_code accept TSX, Civet, a mix of both, or Manim
Python, and convert to the document's language. They also repair the
spellings that compile to something else. The few Civet rules that matter
when you edit Civet text directly (read_docs topic `civet` for the rest):

1. `x => y` is the call `x(=> y)`. Write `(x) => y`.
2. Keyword arguments are `run_time: 2` (a trailing object), never `run_time=2`.
3. `#` starts a comment. `@x` is `this.x`; `@name()` on its own line in a class body is a *static* method.
4. `:=` declares a constant, `.=` a variable. Plain `const x = …` also works.
5. Indentation is the block structure; TypeScript braces also work.

## The same scene in each form

Manim style, Civet:

```civet
from manim import *

class SquareToCircle extends Scene
  construct()
    circle := Circle radius: 1.5
    circle.set_fill PINK, opacity: 0.5
    square := Square()
    square.rotate PI / 4
    @play Create square
    @play Transform square, circle
    @play FadeOut square
```

Manim style, TSX:

```tsx
import {Scene, Circle, Square, Create, Transform, FadeOut, PINK, PI} from 'manim';

export class SquareToCircle extends Scene {
  *construct() {
    const circle = Circle({radius: 1.5});
    circle.set_fill(PINK, {opacity: 0.5});
    const square = Square();
    square.rotate(PI / 4);
    yield* this.play(Create(square));
    yield* this.play(Transform(square, circle));
    yield* this.play(FadeOut(square));
  }
}
```

Canvas Commons style, TSX (in Civet: `makeScene2D (view) ->`, no braces):

```tsx
import {makeScene2D, Circle} from '@canvas-commons/2d';
import {all, createRef} from '@canvas-commons/core';

export default makeScene2D(function* (view) {
  const circle = createRef<Circle>();
  view.add(<Circle ref={circle} size={240} fill="#58c4dd" />);
  yield* circle().scale(2, 1);
  yield* all(circle().position.x(300, 1), circle().fill('#e6a700', 1));
});
```

## Tool workflow

1. **Look**: `get_editor_state` returns the open document with line numbers,
   its language and style, problems, and the timeline (step → line).
2. **Change**: `edit_scene` for targeted edits (exact `old` text, in the
   document's language); `write_scene` to replace everything (any language).
   Pass `summary` so the user knows what you did. If the user reviews agent
   edits, these calls wait for their decision.
3. **Verify**: every edit returns compile problems, heuristic hints and a run
   of the new code in an isolated engine: runtime errors and the timeline.
   Fix until there are no problems.
4. **See**: `render_preview` returns frames as an image; `inspect_frame` lists
   what is on screen with bounds, and warns about off-frame or overlapping
   items.
5. **Explain**: `reveal_in_editor` moves the editor to a line, time or step.

Before relying on a name from Manim or Motion Canvas, `lookup_api` it: only
Manim's 2D core is implemented (no 3D, SVG or images, `MarkupText`, tables,
boolean operations). `get_example` has working scenes of every kind; read one
that resembles your task.

## Rules of the engine

- Seeking re-runs the scene from the start, so it must be deterministic: no
  `Math.random()` without a seed, no state kept outside `construct` / the scene
  function. Create mobjects inside `construct`.
- Mobject `points` arrays are immutable: assign a new array, never edit one in place.
- In Manim style, `play` takes animations (`Create(c)`, `c.animate.shift(UP)`)
  and native tweens; keyword arguments go last: `play(anim, {run_time: 2})`.
- In native style, a signal call with a duration (`node().x(300, 1)`) is a
  tween that runs only under `yield*`.
