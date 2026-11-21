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
