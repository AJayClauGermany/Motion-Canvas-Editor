import {For} from 'solid-js';

const rows: [string, string, string][] = [
  ['Import', 'from manim import *', 'from manim import *'],
  ['Scene', 'class Demo(Scene):\n    def construct(self):', 'class Demo extends Scene\n  construct()'],
  ['Assign', 'circle = Circle(radius=2)', 'circle := Circle radius: 2'],
  ['Keyword args', 'c.set_fill(PINK, opacity=0.5)', 'c.set_fill PINK, opacity: 0.5'],
  ['Play', 'self.play(Create(c), run_time=2)', '@play Create(c), run_time: 2'],
  ['Wait', 'self.wait(0.5)', '@wait 0.5'],
  ['Animate', 'self.play(c.animate.shift(UP))', '@play c.animate.shift UP'],
  ['Vectors', 'c.shift(2 * UP + LEFT)', 'c.shift 2 * UP + LEFT'],
  ['Lambda', 'lambda m: m.move_to(d)', '(m) => m.move_to d'],
  ['Loop', 'for i in range(3):', 'for i of [0...3]'],
  ['List build', '[Dot() for _ in range(5)]', 'for _ of [0...5]\n  Dot()'],
  ['Unpack', 'VGroup(*dots)', 'VGroup ...dots'],
  ['Raw TeX', 'MathTex(r"\\frac{a}{b}")', 'MathTex "\\\\frac{a}{b}"'],
  ['Comment', '# note', '# note'],
];

export function Guide() {
  return (
    <div class="guide side-scroll">
      <p class="muted pad">
        Scenes are Civet: TypeScript with indentation-based, Python-like syntax. The Manim vocabulary is a library on top of
        Canvas Commons, so both APIs work in one file.
      </p>
      <table>
        <thead>
          <tr>
            <th />
            <th>Manim (Python)</th>
            <th>Here (Civet)</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows}>
            {row => (
              <tr>
                <th>{row[0]}</th>
                <td>
                  <pre>{row[1]}</pre>
                </td>
                <td>
                  <pre>{row[2]}</pre>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="muted pad">
        Parentheses are optional for calls, <code>:=</code> declares a constant, <code>@</code> is <code>self</code>. Every
        method exists in <code>snake_case</code> and <code>camelCase</code>.
      </p>
    </div>
  );
}
