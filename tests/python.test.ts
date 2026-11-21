import {describe, expect, test} from 'bun:test';
import {compileScene} from '../src/runtime/compile';
import {pythonToCivet} from '../src/runtime/python';

const convert = (py: string) => pythonToCivet(py).code;
/** Convert a statement inside a scene method and return just that line. */
const line = (py: string) =>
  convert(`from manim import *\nclass A(Scene):\n    def construct(self):\n        ${py}\n`)
    .split('\n')
    .slice(3)
    .join('\n')
    .trim();

describe('pythonToCivet', () => {
  test('class, method and self', () => {
    expect(convert('from manim import *\n\nclass Demo(Scene):\n    def construct(self):\n        self.wait()\n')).toBe(
      'from manim import *\n\nclass Demo extends Scene\n    construct()\n        @wait()\n',
    );
  });

  test('adds the manim import when the snippet omits it', () => {
    const r = pythonToCivet('class Demo(Scene):\n    def construct(self):\n        self.wait()\n');
    expect(r.code.startsWith('from manim import *\n\nclass Demo extends Scene')).toBe(true);
    expect(r.notes.join(' ')).toContain('Added');
  });

  test('keyword arguments, but not default parameters or comparisons', () => {
    expect(line('c = Circle(radius=2, color=BLUE)')).toBe('c := Circle(radius: 2, color: BLUE)');
    expect(line('ok = a == b')).toBe('ok := a == b');
  });

  test('assignment: const by default, let when reassigned', () => {
    const out = convert('class A(Scene):\n    def construct(self):\n        x = 1\n        y = 2\n        x = 3\n        y += 1\n');
    expect(out).toContain('let x = 1');
    expect(out).toContain('x = 3');
    expect(out).toContain('let y = 2');
    expect(line('a, b = f()')).toBe('[a, b] := f()');
  });

  test('lambda, including one that closes a call', () => {
    expect(line('d.add_updater(lambda m: m.move_to(p))')).toBe('d.add_updater((m) => m.move_to(p))');
    expect(line('g = always_redraw(lambda: Dot())')).toBe('g := always_redraw(() => Dot())');
  });

  test('tuples become arrays, call parentheses stay', () => {
    expect(line('ax = Axes(x_range=(-3, 3), y_range=[0, 1])')).toBe('ax := Axes(x_range: [-3, 3], y_range: [0, 1])');
    expect(line('p = (a + b) * 2')).toBe('p := (a + b) * 2');
  });

  test('comprehensions, unpacking, range and enumerate', () => {
    expect(line('dots = VGroup(*[Dot() for _ in range(5)])')).toBe('dots := VGroup(...(for _ of [0...5] then Dot()))');
    expect(line('evens = [x for x in xs if x % 2 == 0]')).toBe('evens := (for x of xs when x % 2 == 0 then x)');
    const loop = convert('class A(Scene):\n    def construct(self):\n        for i, d in enumerate(dots):\n            d.shift(i * RIGHT)\n');
    expect(loop).toContain('for d, i of dots');
  });

  test('slices and negative indices', () => {
    expect(line('self.add(t[1:3], t[:2], t[2:], t[-1])')).toBe('@add(t[1...3], t[...2], t[2..], t.at(-1))');
  });

  test('strings: raw, f-strings, and code-looking text left alone', () => {
    expect(line('m = MathTex(r"\\frac{a}{b}")')).toBe('m := MathTex("\\\\frac{a}{b}")');
    expect(line('t = Text(f"v = {x:.2f} and {name}")')).toBe('t := Text(`v = ${(x).toFixed(2)} and ${name}`)');
    expect(line('t = Text("self.play(x=1) # not a comment")')).toBe('t := Text("self.play(x=1) # not a comment")');
  });

  test('literals, builtins and control flow', () => {
    const out = convert(
      'class A(Scene):\n    def construct(self):\n        if len(xs) > 3 and not done:\n            pass\n        elif x is None:\n            self.wait()\n        else:\n            print(True)\n',
    );
    expect(out).toContain('if xs.length > 3 and not done');
    expect(out).toContain('else if x is null');
    expect(out).toContain('console.log(true)');
  });

  test('nested def closes over self; top-level def is a function', () => {
    const out = convert('def helper(x):\n    return x\n\nclass A(Scene):\n    def construct(self):\n        def go(m):\n            return self.dot\n');
    expect(out).toContain('function helper(x)');
    expect(out).toContain('go := (m) =>');
    expect(out).toContain('return @dot');
  });

  test('multi-line call with positional then keyword arguments gets braces', () => {
    const out = line('c = ax.plot(\n            lambda x: x ** 2,\n            x_range=[0, 4],\n            color=GREEN,\n        )');
    expect(out).toContain('{x_range: [0, 4], color: GREEN}');
  });

  test('converted scenes compile', () => {
    const py = `from manim import *

class MovingAround(Scene):
    def construct(self):
        square = Square(color=BLUE, fill_opacity=1)

        self.play(square.animate.shift(LEFT))
        self.play(square.animate.set_fill(ORANGE))
        self.play(square.animate.scale(0.3))
        self.play(square.animate.rotate(0.4))
`;
    const compiled = compileScene(convert(py));
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.classNames).toEqual(['MovingAround']);
    expect(compiled.js).toContain('yield* this.play(square.animate.shift(LEFT))');
  });
});
