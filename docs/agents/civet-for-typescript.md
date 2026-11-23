# Civet for TypeScript authors

Civet compiles to TypeScript and accepts almost all of it, so you can write
TypeScript inside a Civet scene and only switch to Civet spellings where they
read better. This page lists what you need for scenes and the places where
TypeScript text means something else in Civet. Everything below was checked
against the compiler the editor uses (Civet 0.11, with `#` comments on).

## TypeScript that is already valid Civet

Braced blocks, `const`/`let`, semicolons, `function*`, generator methods
`*construct() { … }`, JSX, type annotations, generics (`createRef<Circle>()`),
optional chaining, `a ? b : c`, template literals, `class X extends Y { … }`.
A TSX scene usually compiles as Civet unchanged, *except for the spellings in
the next section*. You can mix: a braced `for (…) { … }` inside an indented
method body is fine.

## TypeScript that means something else in Civet

| You write (TypeScript habit) | Civet reads | Write instead |
|---|---|---|
| `xs.map(x => x * 2)` | `xs.map(x(=> x * 2))`, a call of `x` | `xs.map((x) => x * 2)` |
| `this.#count`, `#count = 0` | a comment from `#` on | a normal field: `count = 0`, `@count` |
| `"value: ${n}"` / `"#{n}"` | the literal text | `` `value: ${n}` `` |
| `@helper()` on its own line in a class body | a **static** method `helper` | `helper()` (no `@`) to define; `@helper()` to call |
| `let loop = 3` (also `until`, `unless`, `when`, `then`) | a keyword: parse error | another name |
| `<Rect /* note */ />` | parse error | no comments inside a JSX tag |
| `f(run_time=2)` (from Python) | an assignment to `run_time` | `f run_time: 2` or `f({run_time: 2})` |

The editor's tools (write_scene, open_scene, convert_code) fix the first and
the last automatically and report it; check_scene flags all of them.

## Civet you will read in scenes

| Civet | TypeScript |
|---|---|
| `x := 1` | `const x = 1` |
| `x .= 1` | `let x = 1` |
| `@x`, `@play Create c` | `this.x`, `this.play(Create(c))` |
| `f a, b, key: 1` | `f(a, b, {key: 1})`: parentheses are optional at the end of a statement |
| `c.set_fill BLUE, opacity: 0.5` | `c.set_fill(BLUE, {opacity: 0.5})` |
| `c.shift(UP).scale 2` | `c.shift(UP).scale(2)`: keep parentheses mid-chain |
| `(x) => x + 1` | `(x) => x + 1` (keeps `this`) |
| `(x) -> x + 1` | `function (x) { return x + 1 }` (its own `this`; avoid in scene methods) |
| last expression of a function | is returned |
| `makeScene2D (view) ->` + indented body with `yield*` | `makeScene2D(function* (view) { … })`: a function containing `yield` is a generator |
| `construct()` + indented body | `construct() { … }`; becomes `*construct()` when it animates |
| `for x of xs` + indented body | `for (const x of xs) { … }` |
| `ys := for x of xs` + body `x * 2` | `xs.map(x => x * 2)` |
| `[0...3]`, `[0..3]` | `[0, 1, 2]`, `[0, 1, 2, 3]` |
| `a and b or not c`, `a is b` | `a && b \|\| !c`, `a === b` |
| `unless done` | `if (!done)` |
| `loop` + body | `while (true) { … }` |
| `o :=` + indented `a: 1` lines | `const o = {a: 1}` |
| `# comment`, `// comment` | `// comment` |
| `@@signal()` | the decorator `@signal()` (`@` alone is `this`) |

## The Manim dialect (Manim-style Civet only)

With `from manim import *` as the first line:

- `@play …`, `@wait …` and calls to your own scene methods that animate get
  `yield*` inserted. In the Lab's "explicit" mode they must be written
  `yield* @play …`. get_editor_state reports which mode the document uses.
- `self.` is accepted for `@`, and `construct(self)` for `construct()`.
- `+ - * /` work element-wise on vectors: `2 * UP + LEFT`.
- Names exist in snake_case and camelCase (`set_fill` / `setFill`); the
  document's dialect setting says which the user prefers.

## When a scene does not compile

The error names a line in your source. Common causes:

- A multi-line call that mixes positional arguments with `key: value` lines
  ending in commas: wrap the keyword arguments in `{ }` or drop the commas.
- Inconsistent indentation inside a block (tabs and spaces).
- A paren-free call whose first argument starts with `(`, `[` or `-`: add
  parentheses (`f(-x)`, `f([1, 2])`).
