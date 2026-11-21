import {For, Show} from 'solid-js';
import {useEditor} from './state';

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
  ['Raw TeX', 'MathTex(r"\\frac{a}{b}")', 'MathTex r`\\frac{a}{b}`'],
  ['Comment', '# note', '# note'],
  ['JSX (optional)', 'Circle(radius=2, color=BLUE)', '<Circle radius={2} color={BLUE} />'],
];

const nativeRows: [string, string, string][] = [
  ['Imports', "import {makeScene2D, Rect} from '@canvas-commons/2d';", 'import { makeScene2D, Rect } from "@canvas-commons/2d"'],
  ['Scene', 'export default makeScene2D(function* (view) {\n  ...\n});', 'export default makeScene2D (view) ->\n  ...'],
  ['Constant', 'const box = createRef<Rect>();', 'box := createRef<Rect>()'],
  ['Add nodes', 'view.add(<Rect ref={box} width={240} />);', 'view.add <Rect ref={box} width={240} />'],
  ['Tween', 'yield* box().position.x(300, 1);', 'yield* box().position.x 300, 1'],
  ['Together', 'yield* all(\n  box().rotation(90, 1),\n  box().fill("#e6a700", 1),\n);', 'yield* all(\n  box().rotation(90, 1),\n  box().fill("#e6a700", 1),\n)'],
  ['Arrow function', 'width={() => scale() * 120}', 'width={=> scale() * 120}'],
  ['Loop', 'for (const node of nodes) {\n  yield* node.opacity(1, 0.3);\n}', 'for node of nodes\n  yield* node.opacity 1, 0.3'],
  ['Comment', '// note', '// note'],
];

function Table(props: {rows: [string, string, string][]; from: string}) {
  return (
    <table>
      <thead>
        <tr>
          <th />
          <th>{props.from}</th>
          <th>Here (Civet)</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>
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
  );
}

export function Guide() {
  const ed = useEditor();
  return (
    <Show when={ed.vocabulary() === 'native'} fallback={<ManimGuide />}>
      <div class="guide side-scroll">
        <p class="muted pad">
          This scene uses Canvas Commons' own API: nodes as JSX, refs, signals and explicit <code>yield*</code>. Nothing in
          it is Manim-specific. It can be written in Civet or, with the Lab's TSX choice, exactly as in Motion Canvas.
        </p>
        <Table rows={nativeRows} from="Motion Canvas (TSX)" />
        <p class="muted pad">
          Each top-level <code>yield*</code> statement is one step on the timeline. To use Manim's mobjects in the same
          file, add <code>from manim import *</code> and write a <code>Scene</code> class instead.
        </p>
      </div>
    </Show>
  );
}

function ManimGuide() {
  return (
    <div class="guide side-scroll">
      <p class="muted pad">
        Scenes are Civet: TypeScript with indentation-based, Python-like syntax. The Manim vocabulary is a library on top of
        Canvas Commons, so both APIs work in one file.
      </p>
      <Table rows={rows} from="Manim (Python)" />
      <p class="muted pad">
        Parentheses are optional for calls, <code>:=</code> declares a constant, <code>@</code> is <code>self</code>. Every
        method exists in <code>snake_case</code> and <code>camelCase</code>.
      </p>
    </div>
  );
}
