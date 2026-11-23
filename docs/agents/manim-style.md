# Writing Manim-style scenes

The Manim layer re-implements Manim Community's 2D object model on Canvas
Commons. Code ported from Manim mostly works with Civet spelling; the full
list of what exists is read_docs topic `manim-reference`, and lookup_api
answers for single names.

## Structure

```civet
from manim import *

class Demo extends Scene
  construct()
    title := Text "Hello", font_size: 64
    @play Write title
    @play title.animate.to_edge UP
    dots := VGroup ...(for i of [0...5]
      Dot().shift (i - 2) * RIGHT)
    @play LaggedStart ...dots.submobjects.map((d) => FadeIn d), lag_ratio: 0.2
    @wait 1
```

- Several scene classes per file are allowed; the editor shows a scene picker.
- Helper methods are fine: a method that calls `@play` becomes a generator,
  and calling it (`@intro()`) gets `yield*` like `@play` does. In TSX write it
  as `*intro() { … }` and call it with `yield* this.intro()`.
- `setup()` runs before `construct()`.

## Calls

- Classes are called without `new`: `Circle(radius: 2)`.
- Positional arguments first, keyword arguments as one trailing object, in
  snake_case or camelCase: `Circle 2, color: RED` = `Circle({radius: 2, color: RED})`.
- Methods exist in both spellings (`next_to` / `nextTo`) and return the
  mobject, so they chain.
- `play(*animations, {run_time, rate_func, lag_ratio})`; `wait(seconds)`.
  `play` also takes native Canvas Commons tweens and generators.
- `.animate` builds an animation from method calls:
  `@play sq.animate.shift(UP).set_color(RED), run_time: 2`.

## Space

- Manim units: the frame is 8 units tall and 14.22 wide (16:9), origin at the
  centre, y up. One unit is 135 px.
- Directions: `UP DOWN LEFT RIGHT UL UR DL DR ORIGIN`; z is ignored.
- `next_to(other, direction, buff: 0.25)`, `to_edge(UP)`, `to_corner(UL)`,
  `arrange(DOWN, buff: 0.5)`, `arrange_in_grid(rows: 2)`, `move_to(point)`,
  `align_to(other, LEFT)`.
- Things outside x ±7.1 / y ±4 are off-frame. inspect_frame reports them.

## Time

- `play` blocks until the animations finish; the default `run_time` is 1 s.
- Updaters: `mob.add_updater((m, dt) => …)`; `always_redraw(() => Dot point())`
  rebuilds every frame; `ValueTracker` holds a number you animate with
  `tracker.animate.set_value(5)`.
- The scene re-runs from the start whenever the user seeks, so keep it
  deterministic and create every mobject inside `construct`.

## Text and maths

- `Text` is canvas text, one submobject per character: it can be written,
  faded, coloured and moved per letter, but it does not morph into shapes.
- `MathTex` and `Tex` are MathJax outlines and morph (`TransformMatchingTex`).
  Use the `r` tag for backslashes: ``MathTex r`\frac{a}{b}` ``, or double them
  in a normal string.

## Not available

No 3D (`ThreeDScene`, surfaces, camera rotation), no `SVGMobject`,
`ImageMobject`, `MarkupText`, `Table`, `Matrix`, `Code`, boolean operations,
vector fields, graphs/networks, `ZoomedScene`, sound. The camera frame moves
and scales (`@camera.frame.animate.scale(0.5)`). For images or code blocks,
mix in a Canvas Commons node (`<Img>`, `<Code>`, read_docs topic `mixing`).

## Python → here

| Python | Civet | TSX |
|---|---|---|
| `class A(Scene):` / `def construct(self):` | `class A extends Scene` / `construct()` | `class A extends Scene {` / `*construct() {` |
| `self.play(Create(c), run_time=2)` | `@play Create(c), run_time: 2` | `yield* this.play(Create(c), {run_time: 2});` |
| `c = Circle(radius=2)` | `c := Circle radius: 2` | `const c = Circle({radius: 2});` |
| `True / False / None` | `true / false / undefined` | same |
| `lambda m: m.move_to(d)` | `(m) => m.move_to d` | `(m) => m.move_to(d)` |
| `[Dot() for _ in range(5)]` | `for _ of [0...5]` + `Dot()` | `range(5).map(() => Dot())` |
| `VGroup(*dots)` | `VGroup ...dots` | `VGroup(...dots)` |
| `np.array([1, 2, 0])` | `[1, 2, 0]` (`np.array` also works) | same |
| `r"\frac{a}{b}"` | ``r`\frac{a}{b}` `` | same |

`range`, `len` and a small `np` (`linspace`, `arange`, `sin`, `cos`, …) are
provided. write_scene and check_scene accept Manim Python directly
(language `python`) and convert it.
