# Manim compatibility

Scenes in this editor are written in Civet against `src/manim/`, a
re-implementation of Manim Community's object model on top of Canvas Commons.
This page says what is there, where it behaves differently from Manim, and how
a Python scene maps to Civet.

It was checked against Manim Community 0.22.1 (`.refs/manim`). Every claim
about a default below was read from that source.

- [What is implemented](#what-is-implemented)
- [Known differences](#known-differences)
- [Translating Python to Civet](#translating-python-to-civet)
- [Mixing with Canvas Commons nodes](#mixing-with-canvas-commons-nodes)
- [Ported gallery examples](#ported-gallery-examples)

## What is implemented

Every class is callable without `new`. Every camelCase method also has a
snake_case spelling, and keyword arguments are a trailing object whose keys can
be written either way (`fill_opacity: 0.5` or `fillOpacity: 0.5`).

### Mobjects

| Area | Available | Notes |
|---|---|---|
| Base | `Mobject`, `VMobject`, `VGroup`, `Group`, `VDict` | Points are Manim-style cubic Béziers in Manim units (y up, frame 8 units tall). `group[0]`, `group[-1]`, slices and `for x of group` work. |
| Arcs | `Arc`, `ArcBetweenPoints`, `Circle`, `Dot`, `SmallDot`, `AnnotationDot`, `LabeledDot`, `Ellipse`, `Annulus`, `Sector` | `Circle.surround`, `Circle.point_at_angle`, `Circle.from_three_points`, `Arc.get_arc_center`, `Arc.add_tip`. |
| Lines | `Line`, `DashedLine`, `TangentLine`, `Elbow`, `Arrow`, `Vector`, `DoubleArrow`, `CurvedArrow`, `CurvedDoubleArrow` | `get_angle`, `get_slope`, `get_length`, `get_vector`, `get_unit_vector`, `get_projection`, `set_angle`, `set_length`, `put_start_and_end_on`, `set_points_by_ends`, `add_tip`. Arrow tips shrink with short arrows as in Manim. |
| Angles | `Angle`, `RightAngle` | `radius`, `quadrant`, `other_angle`, `dot`, `elbow`; `get_value`, `get_lines`, `Angle.from_three_points`. Parallel lines give an empty angle. |
| Polygons | `Polygon`, `Polyline`, `RegularPolygon`, `Triangle`, `Star`, `Rectangle`, `Square`, `RoundedRectangle`, `SurroundingRectangle`, `BackgroundRectangle`, `Underline`, `Cross` | |
| Braces | `Brace`, `BraceBetweenPoints`, `BraceLabel`, `BraceText` | Same outline as Manim's brace. `get_tip`, `get_direction`, `put_at_tip`, `get_text` (a `Tex`), `get_tex` (a `MathTex`), `change_label`. |
| Text | `Text`, `Paragraph` | One submobject per visible character. `font_size`, `font`, `weight`, `slant`, `line_spacing`, `t2c`, `t2w`. |
| TeX | `MathTex`, `Tex`, `SingleStringMathTex`, `Title` | Typeset by MathJax into outlines. Several string arguments become parts (`eq[1]`); `substrings_to_isolate`, `tex_to_color_map` and `{{ double braces }}` split further. `get_part_by_tex`, `get_parts_by_tex`, `set_color_by_tex`, `set_color_by_tex_to_color_map`, `set_opacity_by_tex`, `index_of_part`. `Tex` accepts `$math$` and `\\` line breaks. |
| Numbers | `DecimalNumber`, `Integer`, `Variable`, `ValueTracker` | Digits are TeX outlines. `num_decimal_places`, `include_sign`, `group_with_commas`, `unit`, `edge_to_fix`; `set_value`, `get_value`, `increment_value`. |
| Coordinate systems | `NumberLine`, `Axes`, `NumberPlane` | See [Graphing](#graphing). |
| Graphs of functions | `ParametricFunction`, `FunctionGraph`, `TracedPath` | Sampled and smoothed like Manim (`use_smoothing: false` gives straight segments). `TracedPath(dot.get_center, dissipating_time: 1)`. |

### Sound

`self.add_sound("click.mp3", time_offset=0.5, gain=-6)` plays a clip of the
project from the current time (`gain` in decibels), as in Manim. The file is
named, not given by path: clips are added in the editor's Sounds tab and live
in the project folder's `assets/` directory, or in the browser. The engine's
own builder does more: `sound("click.mp3").trim(0.2, 1).playbackRate(1.5).play()`
with `sound` imported from `@canvas-commons/core`. Sounds are part of exported
videos and web embeds.

### Mobject methods

| Kind | Methods |
|---|---|
| Family | `add`, `add_to_back`, `remove`, `get_family`, `family_members_with_points`, `copy`, `invert`, `sort`, `become`, `save_state`, `restore`, `generate_target` |
| Position | `shift`, `move_to`, `next_to`, `align_to`, `to_edge`, `to_corner`, `center`, `set_x`, `set_y`, `match_x`, `match_y`, `shift_onto_screen`, `arrange`, `arrange_in_grid` (rows, cols, buff) |
| Size and shape | `scale`, `stretch`, `rotate`, `rotate_about_origin`, `flip`, `scale_to_fit_width/height`, `stretch_to_fit_width/height`, `set_width/height`, `match_width/height`, `replace`, `surround`, `apply_function`, `apply_matrix`, `put_start_and_end_on`, the `width` / `height` properties, `set(width: 3)` |
| Bounding box | `get_center`, `get_top/bottom/left/right`, `get_corner`, `get_edge_center`, `get_critical_point`, `get_x`, `get_y`, `get_width`, `get_height` |
| Style | `set_color`, `set_fill`, `set_stroke`, `set_opacity`, `set_style`, `set_color_by_gradient`, `match_style`, `match_color`, `fade`, `set_z_index`, `get_color`, `get_fill_color`, `get_stroke_color`, and the `color`, `fill_opacity`, `stroke_width`, … attributes |
| Outline (`VMobject`) | `set_points`, `set_points_as_corners`, `set_points_smoothly`, `add_points_as_corners`, `add_line_to`, `add_cubic_bezier_curve_to`, `start_new_path`, `close_path`, `append_points`, `make_smooth`, `make_jagged`, `insert_n_curves`, `match_points`, `reverse_points`, `get_start`, `get_end`, `get_anchors`, `get_subpaths`, `get_num_curves`, `get_arc_length`, `point_from_proportion`, `pointwise_become_partial` |
| Updaters | `add_updater`, `remove_updater`, `clear_updaters`, `suspend_updating`, `resume_updating`, `update`; `always_redraw(fn)` |

snake_case methods come back bound to their object, like Python's bound
methods, so `TracedPath(dot.get_center)` and `mob.add_updater(self.update)`
work as written.

### Graphing

| Class | Supported |
|---|---|
| `NumberLine` | `x_range`, `length`, `unit_size`, `include_ticks`, `tick_size`, `numbers_with_elongated_ticks`, `longer_tick_multiple`, `include_tip`, `include_numbers`, `numbers_to_include`, `numbers_to_exclude`, `font_size`, `label_direction`, `line_to_number_buff`, `rotation`, `decimal_number_config`. `n2p` / `number_to_point`, `p2n`, `get_unit_size`, `get_unit_vector`, `get_tick_range`, `add_numbers`, `add_labels`, `get_number_mobject`. |
| `Axes` | `x_range`, `y_range`, `x_length`, `y_length`, `tips`, `axis_config`, `x_axis_config`, `y_axis_config`. `c2p`, `p2c`, `i2gp` / `input_to_graph_point`, `plot`, `plot_parametric_curve`, `plot_derivative_graph`, `plot_line_graph`, `get_axis_labels`, `get_x_axis_label`, `get_y_axis_label`, `get_graph_label`, `get_vertical_line`, `get_horizontal_line`, `get_lines_to_point`, `get_vertical_line_to_graph`, `get_vertical_lines_to_graph`, `get_area` (with `bounded_graph`), `get_riemann_rectangles`, `angle_of_tangent`, `slope_of_tangent`, `add_coordinates`. |
| `NumberPlane` | `background_line_style`, `faded_line_style`, `faded_line_ratio`, `prepare_for_nonlinear_transform`, `get_vector`. |

Tick positions, the origin shift, the centring of the axes, label placement
and the sampling step of `plot` follow Manim's code.

### Animations

| Group | Available |
|---|---|
| Creation | `Create`, `Uncreate`, `DrawBorderThenFill`, `Write`, `Unwrite`, `ShowPassingFlash`, `ShowIncreasingSubsets`, `AddTextLetterByLetter` |
| Transform | `Transform`, `ReplacementTransform`, `TransformFromCopy`, `ClockwiseTransform`, `CounterclockwiseTransform`, `MoveToTarget`, `Restore`, `ApplyFunction`, `ApplyPointwiseFunction`, `ApplyMatrix`, `ScaleInPlace`, `FadeToColor`, `FadeTransform`, `CyclicReplace`, `Swap`, `TransformMatchingShapes`, `TransformMatchingTex` |
| Fading and growing | `FadeIn`, `FadeOut` (`shift`, `scale`, `target_position`), `GrowFromPoint`, `GrowFromCenter`, `GrowFromEdge`, `GrowArrow`, `SpinInFromNothing`, `ShrinkToCenter` |
| Movement | `Rotate`, `Rotating`, `MoveAlongPath`, `Homotopy`, `UpdateFromFunc`, `UpdateFromAlphaFunc`, `ChangingDecimal`, `ChangeDecimalToValue` |
| Indication | `Indicate`, `Wiggle`, `Flash`, `Circumscribe`, `FocusOn`, `ApplyWave` |
| Composition | `AnimationGroup`, `LaggedStart`, `LaggedStartMap`, `Succession`, `Wait` |
| `.animate` | `mob.animate.shift(UP).set_color(RED)`, `mob.animate(run_time: 2).scale(2)`; works on `ValueTracker` and on `self.camera.frame` |

All animations take `run_time`, `rate_func`, `lag_ratio`, `remover`,
`introducer` and `reverse_rate_function`. As in Manim, animating a mobject
that is already on screen does not change its place in the drawing order, and
`ReplacementTransform` puts the target where the source was.

Rate functions: `linear`, `smooth`, `smoothstep`, `smootherstep`, `rush_into`,
`rush_from`, `slow_into`, `double_smooth`, `there_and_back`,
`there_and_back_with_pause`, `running_start`, `wiggle`, `lingering`,
`exponential_decay`, `squish_rate_func`, `not_quite_there`, and the `ease_*`
family (sine, quad, cubic, quart, quint, expo, circ, back, elastic, bounce).

### Scene

| Feature | Notes |
|---|---|
| `Scene`, `MovingCameraScene` | `construct`, `setup`, `tear_down`. Every scene has a movable `self.camera.frame`, so `MovingCameraScene` is an alias. |
| Timeline | `play(*animations, run_time, rate_func, …)`, `wait(duration)`, `pause`, `next_section(name)` |
| Contents | `add`, `remove`, `replace`, `clear`, `bring_to_front`, `bring_to_back`, `add_foreground_mobject(s)`, `mobjects` |
| Updaters | Mobject updaters `(mob)` or `(mob, dt)`; scene updaters `add_updater((dt) => …)` |
| Camera | `camera.background_color`, `camera.frame` (scale, move, `save_state`, `Restore`, updaters), `camera.frame_width/height/center`, `camera.auto_zoom(mobjects, margin: 1)` |
| Helper methods | A method of the scene class that plays animations can be called like any other method: `@intro()` |

### Helpers and constants

- Directions and sizes: `ORIGIN`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `UL`, `UR`,
  `DL`, `DR`, `IN`, `OUT`, `PI`, `TAU`, `DEGREES`, the `*_BUFF` constants,
  `DEFAULT_*`, `config.frame_width` and friends.
- Colours: Manim's palette (`BLUE_A` … `BLUE_E`, `PURE_RED`, `LOGO_*`, grey and
  gray spellings), `interpolate_color`, `color_gradient`, `invert_color`,
  `average_color`, `color_to_rgb`, `rgb_to_color`, `ManimColor(...)`, and
  `BLUE.lighter()`, `.darker()`, `.interpolate(other, alpha)`, `.invert()`.
- Vectors: `+ - * /` and unary `-` work element-wise on `[x, y, z]` arrays.
  `normalize`, `rotate_vector`, `angle_of_vector`, `angle_between_vectors`,
  `get_norm`, `midpoint`, `interpolate`, `line_intersection`.
- `np`: `array`, `linspace`, `arange`, `sin`, `cos`, `tan`, `arctan`,
  `arctan2`, `sqrt`, `exp`, `log`, `abs`, `floor`, `ceil`, `round`, `sign`,
  `dot`, `cross`, `linalg.norm`, `argmin`, `argmax`, `min`, `max`, `sum`,
  `mean`, `zeros`, `ones`, `pi`, `e`.
- Python built-ins that keep ports readable: `range`, `len`, and the tag
  ``r`\frac{a}{b}` `` for raw strings.

## Known differences

**Text is canvas text, not outlines.** `Text` glyphs are painted with the
canvas text API in the editor's sans-serif font (Manim uses Pango and the
system font, so widths differ slightly). Consequences: `Write` strokes an
outline approximation before the fill appears, a `Transform` between
different characters cross-fades instead of morphing, and `apply_function`
moves each character as a whole. `MarkupText`, `t2g`, `t2s` and `t2f` are not
implemented. TeX mobjects are real outlines and have none of these limits.

**TeX is typeset by MathJax, not LaTeX.** The fonts match Computer Modern and
sizes match Manim (`font_size` 48 is one em of 0.5 units), but there is no
`tex_template`, no preamble, and only the packages MathJax ships.
Sub-mobject order follows MathJax's output, so indexing single glyphs
(`eq[0][3]`) can pick a different symbol than Manim does around fractions and
roots; indexing parts (`eq[1]`) is reliable. `Tex` wraps its content in
`\text{…}`, stacks `\\`-separated lines itself, and emulates `\LaTeX`.

**No third dimension.** z coordinates are ignored, `rotate` only turns in the
plane (`axis: OUT` or `IN`), and `ThreeDScene`, `ThreeDAxes`, surfaces and
camera rotation do not exist. `ThreeDScene` and `ZoomedScene` are defined only
so that scenes fail on the feature they use rather than on the class name.

**Not implemented:** boolean operations (`Union`, `Intersection`,
`Difference`, `Exclusion`), `SVGMobject`, `ImageMobject`, `Table`, `Matrix`,
`Code`, graphs and networks, vector fields, `ZoomedScene`, `PolarPlane`,
`ComplexPlane`, logarithmic axis scaling, other arrow tip shapes, sound.

**Colours are hex strings.** `BLUE == "#58C4DD"`. The `ManimColor` methods
that scenes commonly use are available on strings. A list of colours is not a
per-vertex gradient: `set_color_by_gradient` spreads colours over
submobjects, and `get_area(color: [BLUE, GREEN])` fills with the middle
colour.

**Smaller differences**

- `NumberLine` is a group that contains its line (`.line`), ticks, tip and
  numbers, not a `Line` subclass. The `Line`-style getters (`get_start`,
  `get_end`, `get_angle`, `get_unit_vector`, `get_projection`) are provided.
- `DashedLine` is one outline drawn with a dash pattern, so its dashes are not
  submobjects.
- `point_from_proportion` and `MoveAlongPath` measure arc length with eight
  samples per curve.
- `Axes.plot` ignores `use_vectorized` and `colorscale`, and breaks the graph
  where the function is not finite instead of taking `discontinuities`.
- `wait` has no `stop_condition`; `Scene.play` has no `subcaption`.
- `arrange_in_grid` supports `rows`, `cols` and `buff`, not alignments or
  flow order.
- The scene is re-run from the start when you seek, so a scene must be
  deterministic: seed any randomness yourself.
- Mobject points are immutable arrays. Library code replaces `mob.points`
  instead of editing it; scene code that writes `mob.points[0] = …` has no
  effect on the picture.

## Translating Python to Civet

The first line `from manim import *` switches the dialect on. After that a
scene reads almost like the original.

| Python | Civet | Why |
|---|---|---|
| `class A(Scene):` | `class A extends Scene` | |
| `def construct(self):` | `construct()` | Methods take no `self`. |
| `self.play(...)`, `self.x` | `@play ...`, `@x` | `@` is `this.`. `yield*` is inserted for `@play` / `@wait`, and for calls to your own methods that animate. |
| `c = Circle()` | `c := Circle()` | `:=` declares a constant. Use `.=` for a variable you reassign, plain `=` for attributes (`@t = 0`). |
| `Circle(radius=2, color=RED)` | `Circle radius: 2, color: RED` | Keyword arguments become `key: value`. Parentheses are optional at the end of a statement. |
| `{"color": GREEN}` | `{color: GREEN}` | Config dicts are object literals. |
| `True`, `False`, `None` | `true`, `false`, `undefined` | |
| `lambda x: x ** 2` | `(x) => x ** 2` | |
| nested `def f(m, dt):` | `f := (m, dt) =>` | Always the fat arrow, so `@attr` still means the scene. The last expression is returned. |
| `[f(x) for x in xs]` | `[f(x) for x of xs]` | |
| `*[...]` | `...[...]` | |
| `for i in range(len(xs)):` | `for i of range len xs` | `range` and `len` are provided. |
| `a, b = x, y` | `[a, b] := [x, y]` | |
| `xs[0:5]`, `xs[-5:]`, `xs[:2]` | `xs[0...5]`, `xs[-5..]`, `xs[...2]` | On mobjects and arrays alike. |
| `group[-1]` | `group[-1]` | Works on mobjects; use `xs.at(-1)` for a plain array. |
| `r"\frac{a}{b}"` | ``r`\frac{a}{b}` `` | The `r` tag keeps backslashes. A string the Python source wrote with doubled backslashes stays as it is: `"\\frac{a}{b}"`. |
| `# comment` | `# comment` | So Civet's `#` length shorthand and `#private` fields are not available in scenes. |
| `2 * UP + LEFT` | `2 * UP + LEFT` | `+ - * /` are overloaded for arrays. |
| `f(-x)` | `f(-x)` | Keep the parentheses: `f -x` is a subtraction. |
| `func(xs).argmin()` | `np.argmin xs.map(func)` | `**`, comparisons and user functions do not broadcast over arrays. |
| `always_redraw(lambda: Dot(p))` | `always_redraw(() => Dot p)` | |

Two rules of thumb. Keep the statement order and the variable names of the
original, so the two files can be read side by side. And prefer the
parenthesis-free call style only where a line stays unambiguous: at the end
of a statement, not in the middle of a method chain.

### Before and after

A static scene with keyword arguments and vector arithmetic (`ManimCELogo`):

```python
ds_m = MathTex(r"\mathbb{M}", fill_color=logo_black).scale(7)
ds_m.shift(2.25 * LEFT + 1.5 * UP)
circle = Circle(color=logo_green, fill_opacity=1).shift(LEFT)
logo = VGroup(triangle, square, circle, ds_m)  # order matters
self.add(logo)
```

```civet
ds_m := MathTex(r`\mathbb{M}`, fill_color: logo_black).scale(7)
ds_m.shift 2.25 * LEFT + 1.5 * UP
circle := Circle(color: logo_green, fill_opacity: 1).shift(LEFT)
logo := VGroup triangle, square, circle, ds_m  # order matters
@add logo
```

Updaters written as lambdas (`MovingDots`):

```python
d1.add_updater(lambda z: z.set_x(x.get_value()))
l1.add_updater(lambda z: z.match_points(Line(d1.get_center(),d2.get_center())))
self.play(x.animate.set_value(5))
```

```civet
d1.add_updater (z) => z.set_x x.get_value()
l1.add_updater (z) => z.match_points Line(d1.get_center(), d2.get_center())
@play x.animate.set_value 5
```

A nested function and a config dict (`PointWithTrace`, `SinAndCosFunctionPlot`):

```python
def update_path(path):
    previous_path = path.copy()
    previous_path.add_points_as_corners([dot.get_center()])
    path.become(previous_path)
path.add_updater(update_path)

axes = Axes(
    x_range=[-10, 10.3, 1],
    axis_config={"color": GREEN},
    tips=False,
)
```

```civet
update_path := (path) =>
  previous_path := path.copy()
  previous_path.add_points_as_corners [dot.get_center()]
  path.become previous_path
path.add_updater update_path

axes := Axes(
  x_range: [-10, 10.3, 1]
  axis_config: {color: GREEN}
  tips: false
)
```

Several animations in one `play`, a comprehension and a point function
(`OpeningManim`):

```python
self.play(
    Transform(title, transform_title),
    LaggedStart(*[FadeOut(obj, shift=DOWN) for obj in basel]),
)
grid.prepare_for_nonlinear_transform()
self.play(
    grid.animate.apply_function(
        lambda p: p + np.array([np.sin(p[1]), np.sin(p[0]), 0])
    ),
    run_time=3,
)
```

```civet
@play(
  Transform title, transform_title
  LaggedStart ...[FadeOut(obj, shift: DOWN) for obj of basel]
)
grid.prepare_for_nonlinear_transform()
@play(
  grid.animate.apply_function(
    (p) => p + np.array [np.sin(p[1]), np.sin(p[0]), 0]
  )
  run_time: 3
)
```

Helper methods and state on the scene (`SineCurveUnitCircle`):

```python
def move_dot_and_draw_curve(self):
    self.t_offset = 0
    def go_around_circle(mob, dt):
        self.t_offset += (dt * rate)
        mob.move_to(orbit.point_from_proportion(self.t_offset % 1))
    dot.add_updater(go_around_circle)
    self.wait(8.5)
```

```civet
move_dot_and_draw_curve()
  @t_offset = 0
  go_around_circle := (mob, dt) =>
    @t_offset += dt * rate
    mob.move_to orbit.point_from_proportion(@t_offset % 1)
  dot.add_updater go_around_circle
  @wait 8.5
```

## Relation to Canvas Commons style

This document is about the Manim-style layer. Scenes can equally be written in
Canvas Commons' own style (`makeScene2D`, JSX nodes, refs, signals), in Civet
or TSX, with the same editor support; the README's "Two styles, one pipeline"
section compares them. The two mix in one scene, in both directions, as the
next two sections show.

## Mobjects as JSX

Mobjects can also be written as JSX, the way Canvas Commons nodes are. It is
the same constructor underneath, so both spellings can be mixed freely.

```civet
row := <VGroup>
  <Circle radius={0.9} color={BLUE} fill_opacity={0.5} />
  <Square side_length={1.8} color={GREEN} />
  {for i of [0...3]
    <Dot radius={0.12} color={RED} />}
</VGroup>
title := <Text font_size={44}>Mobjects in JSX</Text>
formula := <MathTex color={TEAL}>{"a^2"}{"+"}{"b^2"}</MathTex>
```

| JSX | Means |
|---|---|
| Attributes | The keyword arguments, in `snake_case` or `camelCase`. Positional parameters are available by name too: `<Line start={LEFT} end={RIGHT} />` |
| Children that are mobjects | Submobjects, added in order. Arrays and loops are flattened |
| Children that are native nodes | Submobjects too: the node is wrapped, see [Mixing with Canvas Commons nodes](#mixing-with-canvas-commons-nodes) |
| Other children (text, numbers) | Positional arguments: `<Text>Hi</Text>`, `<MathTex>{"a"}{"+"}{"b"}</MathTex>` |
| `ref={myRef}` | Receives the mobject, so `createRef()` from `@canvas-commons/core` works: `myRef().animate.shift UP` |

Limits:

- Nesting works in both directions, with the rules of the next section:
  `<Rect><Circle /></Rect>` with a Manim `Circle` inside a native `Rect` draws
  the circle in the rectangle's coordinate system, and a native node inside
  `<VGroup>` becomes a submobject.
- With `from manim import *`, names such as `Circle` and `Line` are the Manim
  classes. Import a native node of the same name under an alias
  (`import { Circle as CircleNode } from "@canvas-commons/2d"`).
- Points cannot be children, because the JSX runtime flattens arrays. Pass them
  as attributes (`<Line start={a} end={b} />`), and call classes that take a
  list of points positionally, such as `Polygon`, the normal way.
- JSX only constructs. Positioning (`next_to`, `arrange`) and animation are
  still method calls. Animations are not JSX elements.
- Signals as attribute values are not reactive on mobjects; use updaters.

See `examples/jsx-mobjects`.

## Mixing with Canvas Commons nodes

A mobject (Manim units, y up, animated with `play`) and a Canvas Commons node
(pixels, y down, animated with signal tweens) can be used in each other's
place. The bridge is `src/manim/interop.ts`. Examples: `mix-nodes-in-manim`,
`mix-mobjects-in-native`, `mix-units`.

### A native node as a mobject

Wherever the Manim layer expects a mobject it also takes a node: `VGroup(...)`
and `add`, JSX children of a mobject, `Scene.add`, `remove`, `bring_to_front`,
`bring_to_back`, the arguments of animations and of other mobjects (`Brace`,
`SurroundingRectangle`), and the targets of `next_to`, `move_to` and
`align_to`. `wrap(node)` gives the wrapping mobject when you want to call a
Manim method on the node yourself; it is the same mobject every time.
`mob.node`, or `unwrap(mob)`, gives the node back.

```civet
card := <Rect layout padding={24} radius={20} fill="#1f3a4d">
  <Txt fill="#ffffff" fontSize={52} text="native Rect" />
</Rect>
row := VGroup Circle(radius: 0.8), card, Square()
row.arrange RIGHT, buff: 0.6
brace := Brace card, UP
@play FadeIn(card, shift: UP), GrowFromCenter(brace)
@play wrap(card).animate.scale(1.3).set_color(MAROON)
```

| On the mobject | On the node |
|---|---|
| `shift`, `move_to`, `next_to`, `arrange`, … | `position` (of the node's origin) |
| `scale`, `stretch`, `flip` | `scale` |
| `rotate` (radians, counter-clockwise) | `rotation` (degrees, clockwise) |
| `set_opacity`, `fade`, `fill_opacity` | `opacity` |
| `set_color`, `set_fill(color)` | `fill`, or `stroke` for a node without a fill |
| `width`, `height`, `get_center()`, … | read from the node's `cacheBBox()` |

- Both sides stay live. A value the native side changed
  (`yield* card.position.x(300, 1)`) is read back into the mobject; a value a
  Manim method changed is written to the node. When both changed the same
  value since the last look, the native side wins.
- A wrapped node is drawn among the mobjects, in their order, so `add`,
  `bring_to_front` and `set_z_index` place it like any mobject. A node that
  `@view.add` put on the view moves into that order the first time the scene
  displays it (`@add node`, `@play FadeIn(node)`).
- Animations make copies. The copy of a wrapped node holds numbers only; when
  one is put on screen (`@add wrap(card).copy()`, `TransformFromCopy`) it
  displays a `clone()` of the node.
- `Create`, `Uncreate` and `Write` fade a node, because it has no outline to
  trace. `Transform` between two nodes blends position, size, rotation,
  opacity and colour; the content does not morph, so the node pops to the
  target at the end of a `ReplacementTransform`.

### A mobject as the child of a node

A mobject passed where Canvas Commons expects a child node (JSX,
`node.add(mob)`, `view.add(mob)`, the `children` signal) is drawn by a host
node that takes its place in the tree. The mobject's coordinates are then
relative to that host: `[0, 0, 0]` is the parent's origin, one unit is
`config.unit` (135) pixels, y is up. The mobject moves, turns, scales and fades
with its parent.

```civet
star := createRef()
view.add <Rect ref={card} width={420} height={320} fill="#1f3a4d">
  <Star ref={star} outer_radius={0.7} color={YELLOW} fill_opacity={0.8} />
</Rect>
yield* m.play Rotate(star(), PI)      // animations and updaters still apply
yield* card().rotation -15, 0.8       // the star turns with the card
```

`unwrap(mob)` returns the host (`host.mobject` goes back), and it is the same
host every time. A hosted mobject that a scene also knows (because `play`
added it) is drawn once, by its host.

### Mobjects in a native scene: `useManim`

```civet
import { makeScene2D } from "@canvas-commons/2d"
import { useManim, Circle, Create, BLUE, UP } from "manim"

export default makeScene2D (view) ->
  m := useManim view
  circle := Circle radius: 1, color: BLUE
  yield* m.play Create circle
  yield* m.play circle.animate.shift(UP), run_time: 0.5
  yield* m.wait 0.5
```

`useManim(view)` returns a `Scene` attached to the view (`useManim()` uses the
current scene's view), the same one on every call. It has everything a `Scene`
class has except `construct`, `setup` and `tear_down`: `play`, `wait`, `add`,
`remove`, `camera`, updaters, `next_section`. Its mobjects are drawn by
`m.root`, a node added to the view at the first call, so nodes added before
that are below the mobjects and nodes added later above them
(`m.root.moveToBottom()` and the other Canvas Commons ordering methods apply).
The background is the view's. `from manim import *` works in such a file as
well. The timeline has one step per `yield*` statement, labelled with the
animations it plays.

### Native tweens inside `play`

```civet
@play Rotate(square, PI / 2), card.rotation(-12, 0.5).to(0, 0.5)
@play tile.position([-405, -270], 1)
```

A generator among the arguments of `play` (a signal tween, `all(...)`,
`chain(...)`) runs alongside the animations, and the play lasts until both are
done. Updaters keep running for the whole play, which they do not during a
bare `yield* tween`. `run_time` and `rate_func` apply to the animations only.
Tweens are accepted inside `AnimationGroup`, `LaggedStart` and `Succession`
too, but they start when the play starts: `lag_ratio` does not delay them.

### Units

| Helper | Converts |
|---|---|
| `px(n)` | a length in pixels to Manim units (`n / 135`) |
| `units(n)` | a length in Manim units to pixels |
| `to_pixels(point)` | a Manim point to a Canvas Commons `[x, y]` (origin at the frame centre, y down) |
| `to_units([x, y])` | a Canvas Commons position (an array or a `Vector2`) to a Manim point |

```civet
ring := <Ring position={to_pixels dot.get_center()} size={units 1} stroke={RED} />
frame := Square(side_length: px(180)).move_to to_units tile.position()
```

These are the frame's coordinates with the camera at rest; they do not follow
`camera.frame`.

### Limits

- Manim controls a node's placement, opacity and one colour, nothing inside
  it. A `Transform` between a node and a shape cannot morph (the node only
  travels to the target); use `FadeTransform`.
- `fill_opacity` of a wrapped node is the node's own `opacity`. A node created
  with `opacity={0}` therefore stays invisible under `FadeIn`, which fades to
  the opacity the node has.
- A node cannot be sheared. `stretch` (or a non-uniform `scale`) of a rotated
  node is replaced by the closest rotation and scale.
- A wrapped node that lives inside a native container stays there, in the
  container's drawing order; `bring_to_front` and `set_z_index` do not apply
  to it. Its coordinates are converted through the parents assuming they
  rotate and scale uniformly. A node that a flexbox layout positions cannot be
  moved by Manim methods; the mobject then follows the layout.
- Driving the same value of one node from both sides in the same `play` is
  undefined. Transform-style animations (`.animate`, `FadeIn`, `Transform`)
  write only what they change, so `box.animate.shift(UP)` together with a
  native opacity tween of `box` is fine; `Rotate` and `Wiggle` rewrite the
  whole placement every frame.
- A hosted mobject is not a flexbox item: its host has no size in a layout and
  sits at the parent's origin. `<Txt>` drops children that are not text. The
  scene's `bring_to_front` and `set_z_index` do not reorder it; its place is
  its place among the parent's children, and inside one hosted group
  `z_index` orders the members.
- The copy of a wrapped node is a `clone()`: refs and tweens in flight are not
  copied.
- Mobject updaters run during `play` and `wait` only, as in Manim. To keep
  them running during a native tween, pass the tween to `play`.

## Ported gallery examples

Each folder in `examples/` holds `scene.civet`, the original `manim.py` and
`meta.json`. `node tools/e2e.cjs` renders all of them to
`artifacts/e2e/<slug>.png`.

| Gallery example | Folder | Status |
|---|---|---|
| ManimCELogo | `manim-ce-logo` | Ported |
| BraceAnnotation | `brace-annotation` | Ported |
| VectorArrow | `vector-arrow` | Ported (text in the editor font) |
| BooleanOperations | | Skipped: needs boolean path operations |
| PointMovingOnShapes | `point-moving-on-shapes` | Ported |
| MovingAround | `moving-around` | Ported |
| MovingAngle | `moving-angle` | Ported |
| MovingDots | `moving-dots` | Ported |
| MovingGroupToDestination | `moving-group-to-destination` | Ported |
| MovingFrameBox | `moving-frame-box` | Ported |
| RotationUpdater | `rotation-updater` | Ported |
| PointWithTrace | `point-with-trace` | Ported |
| SinAndCosFunctionPlot | `sin-and-cos-function-plot` | Ported |
| ArgMinExample | `arg-min-example` | Ported (`func(x_space).argmin()` became `np.argmin x_space.map(func)`) |
| GraphAreaPlot | `graph-area-plot` | Ported |
| HeatDiagramPlot | `heat-diagram-plot` | Ported |
| FollowingGraphCamera | `following-graph-camera` | Ported |
| MovingZoomedSceneAround | | Skipped: needs `ZoomedScene` |
| OpeningManim | `opening-manim` | Ported |
| SineCurveUnitCircle | `sine-curve-unit-circle` | Ported |

Three more examples are original feature tours: `text-and-color`,
`transform-matching` and `updaters-and-trackers`.
