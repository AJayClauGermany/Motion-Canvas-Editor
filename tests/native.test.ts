import {describe, expect, test} from 'bun:test';
import {compileScene, defaultCompileOptions, instrumentSteps} from '../src/runtime/compile';

const CIVET = `import { makeScene2D, Rect } from "@canvas-commons/2d"
import { all, createRef, waitFor } from "@canvas-commons/core"

export default makeScene2D (view) ->
  box := createRef<Rect>()
  view.add <Rect ref={box} width={100} height={100} fill="red" />
  yield* box().position.x 300, 1
  yield* all(
    box().rotation(90, 1),
    box().opacity(0.5, 1),
  )
  yield* waitFor 0.5
`;

const TSX = `import {makeScene2D, Rect} from '@canvas-commons/2d';
import {createRef, loop, waitFor} from '@canvas-commons/core';

export default makeScene2D(function* (view) {
  const box = createRef<Rect>();
  view.add(
    <Rect
      // a comment inside a tag, which Civet rejects
      ref={box}
      width={100}
    />,
  );
  yield* box().position.x(300, 1);
  yield* waitFor(0.5);
});
`;

/** The `__step(line, kind, name, …)` calls a compiled scene contains. */
const steps = (js: string) => [...js.matchAll(/__step\((\d+),"(\w+)","([\w.]+)",/g)].map(m => [Number(m[1]), m[2], m[3]]);

describe('native Canvas Commons scenes', () => {
  test('every yield* statement becomes a timeline step with its source line', () => {
    const r = compileScene(CIVET);
    expect(r.diagnostics).toEqual([]);
    expect(steps(r.js)).toEqual([
      [7, 'play', 'position.x'],
      [8, 'play', 'all'],
      [12, 'wait', 'waitFor'],
    ]);
    expect(r.js).toContain('__stepsBegin();');
    expect(r.js).toContain(';__stepsDone();})');
  });

  test('instrumentation keeps the line count', () => {
    const r = compileScene(CIVET);
    const plain = compileScene(CIVET.replace(/yield\* /g, 'yield '));
    expect(r.js.split('\n').length).toBe(plain.js.split('\n').length);
  });

  test('nested functions are not instrumented', () => {
    const js = 'x = makeScene2D(function*(view){ yield* a(); const f = function*(){ yield* b(); }; yield* f(); });';
    expect(steps(instrumentSteps(js, [1]))).toEqual([
      [1, 'play', 'a'],
      [1, 'play', 'f'],
    ]);
  });

  test('in a Manim scene only non-play yield* statements are instrumented', () => {
    const r = compileScene('from manim import *\nclass A extends Scene\n  construct()\n    @play Create Circle()\n    yield* waitFor 1\n    @helper()\n  helper()\n    @wait()\n');
    expect(r.diagnostics).toEqual([]);
    expect(steps(r.js)).toEqual([[5, 'wait', 'waitFor']]);
  });

  test('TSX mode runs Motion Canvas syntax that Civet rejects', () => {
    expect(compileScene(TSX).ok).toBe(false);
    const r = compileScene(TSX, {...defaultCompileOptions, language: 'tsx'});
    expect(r.diagnostics).toEqual([]);
    expect(steps(r.js)).toEqual([
      [13, 'play', 'position.x'],
      [14, 'wait', 'waitFor'],
    ]);
  });

  test('TSX mode leaves arithmetic and Manim sugar alone', () => {
    const r = compileScene('const a = [1, 2];\nconst b = a + a;\nfrom manim import *\n', {...defaultCompileOptions, language: 'tsx'});
    expect(r.js).not.toContain('__op');
    expect(r.prelude).toBe(false);
  });
});
