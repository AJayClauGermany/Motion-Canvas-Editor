import {For, Show} from 'solid-js';
import {useEditor} from './state';

/** [topic, the familiar spelling, here in Civet, here in TSX] */
type Row = [string, string, string, string];

const manimRows: Row[] = [
  ['Import', 'from manim import *', 'from manim import *', "import {Scene, Circle, Create} from 'manim';"],
  [
    'Scene',
    'class Demo(Scene):\n    def construct(self):',
    'class Demo extends Scene\n  construct()',
    'class Demo extends Scene {\n  *construct() {',
  ],
  ['Assign', 'circle = Circle(radius=2)', 'circle := Circle radius: 2', 'const circle = Circle({radius: 2});'],
  ['Keyword args', 'c.set_fill(PINK, opacity=0.5)', 'c.set_fill PINK, opacity: 0.5', 'c.set_fill(PINK, {opacity: 0.5});'],
  ['Play', 'self.play(Create(c), run_time=2)', '@play Create(c), run_time: 2', 'yield* this.play(Create(c), {run_time: 2});'],
  ['Wait', 'self.wait(0.5)', '@wait 0.5', 'yield* this.wait(0.5);'],
  ['Animate', 'self.play(c.animate.shift(UP))', '@play c.animate.shift UP', 'yield* this.play(c.animate.shift(UP));'],
  ['Vectors', 'c.shift(2 * UP + LEFT)', 'c.shift 2 * UP + LEFT', 'c.shift(2 * UP + LEFT);'],
  ['Lambda', 'lambda m: m.move_to(d)', '(m) => m.move_to d', '(m) => m.move_to(d)'],
  ['Loop', 'for i in range(3):', 'for i of [0...3]', 'for (let i = 0; i < 3; i++) {'],
  ['List build', '[Dot() for _ in range(5)]', 'for _ of [0...5]\n  Dot()', 'range(5).map(() => Dot())'],
  ['Unpack', 'VGroup(*dots)', 'VGroup ...dots', 'VGroup(...dots)'],
  ['Raw TeX', 'MathTex(r"\\frac{a}{b}")', 'MathTex r`\\frac{a}{b}`', 'MathTex(r`\\frac{a}{b}`)'],
  ['Comment', '# note', '# note', '// note'],
  ['JSX (optional)', 'Circle(radius=2, color=BLUE)', '<Circle radius={2} color={BLUE} />', '<Circle radius={2} color={BLUE} />'],
];

const nativeRows: Row[] = [
  [
    'Imports',
    "import {makeScene2D, Rect} from '@canvas-commons/2d';",
    'import { makeScene2D, Rect } from "@canvas-commons/2d"',
    "import {makeScene2D, Rect} from '@canvas-commons/2d';",
  ],
  [
    'Scene',
    'export default makeScene2D(function* (view) {\n  ...\n});',
    'export default makeScene2D (view) ->\n  ...',
    'export default makeScene2D(function* (view) {\n  ...\n});',
  ],
  ['Constant', 'const box = createRef<Rect>();', 'box := createRef<Rect>()', 'const box = createRef<Rect>();'],
  [
    'Add nodes',
    'view.add(<Rect ref={box} width={240} />);',
    'view.add <Rect ref={box} width={240} />',
    'view.add(<Rect ref={box} width={240} />);',
  ],
  ['Tween', 'yield* box().position.x(300, 1);', 'yield* box().position.x 300, 1', 'yield* box().position.x(300, 1);'],
  ['Arrow function', 'width={() => scale() * 120}', 'width={=> scale() * 120}', 'width={() => scale() * 120}'],
  [
    'One parameter',
    'items.map(item => item.id)',
    'items.map (item) => item.id',
    'items.map(item => item.id)',
  ],
  [
    'Loop',
    'for (const node of nodes) {\n  yield* node.opacity(1, 0.3);\n}',
    'for node of nodes\n  yield* node.opacity 1, 0.3',
    'for (const node of nodes) {\n  yield* node.opacity(1, 0.3);\n}',
  ],
  ['Custom signal', '@signal()\ndeclare readonly size: SimpleSignal<number>;', '@@signal()\ndeclare readonly size: SimpleSignal<number>', '@signal()\ndeclare readonly size: SimpleSignal<number>;'],
];

function Table(props: {rows: Row[]; from: string; tsx: boolean}) {
  return (
    <table>
      <thead>
        <tr>
          <th />
          <th>{props.from}</th>
          <th>{props.tsx ? 'Here (TSX)' : 'Here (Civet)'}</th>
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
                <pre>{props.tsx ? row[3] : row[2]}</pre>
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
  const tsx = () => ed.language() === 'tsx';
  return (
    <div class="guide side-scroll">
      <Show
        when={ed.vocabulary() === 'native'}
        fallback={
          <>
            <p class="muted pad">
              This scene uses the Manim vocabulary, a library on top of Canvas Commons.{' '}
              {tsx()
                ? 'In TSX nothing is implicit: imports are listed, every animation call has its yield*, and keyword arguments are an object.'
                : 'In Civet it reads close to Python: calls need no parentheses, := declares a constant, @ is self.'}
            </p>
            <Table rows={manimRows} from="Manim (Python)" tsx={tsx()} />
            <p class="muted pad">
              Every method exists in <code>snake_case</code> and <code>camelCase</code>. Native nodes can join in: add one
              to a <code>VGroup</code>, or pass a tween to <code>play</code>.
            </p>
          </>
        }
      >
        <p class="muted pad">
          This scene uses Canvas Commons' own API: nodes as JSX, refs, signals and explicit <code>yield*</code>.{' '}
          {tsx() ? 'In TSX it is exactly what Motion Canvas users write.' : 'In Civet the same code needs less punctuation.'}
        </p>
        <Table rows={nativeRows} from="Motion Canvas (TSX)" tsx={tsx()} />
        <p class="muted pad">
          Each <code>yield*</code> statement is one step on the timeline. Manim mobjects can join in: import them from{' '}
          <code>manim</code> and drive them with <code>useManim(view)</code>.
        </p>
      </Show>
      <p class="muted pad">
        The Lab's "Source language" choice converts the open scene between Civet and TSX.
      </p>
    </div>
  );
}
