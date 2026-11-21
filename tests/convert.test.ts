import {describe, expect, test} from 'bun:test';
import {compileScene, defaultCompileOptions} from '../src/runtime/compile';
import {civetToTsx, tsxToCivet, usedNames} from '../src/runtime/convert';

const API = ['Scene', 'Circle', 'Square', 'Create', 'Transform', 'FadeOut', 'PINK', 'PI', 'UP', 'LEFT', 'VGroup', '__op'];
const tsx = {...defaultCompileOptions, language: 'tsx' as const};

const MANIM = `from manim import *

class Demo extends Scene
  construct()
    circle := Circle radius: 2, color: PINK   # a circle
    @play Create circle
    circle.shift 2 * UP + LEFT
    @wait 0.5
`;

describe('civetToTsx', () => {
  test('a Manim scene gets an import list and explicit yield*', () => {
    const r = civetToTsx(MANIM, API);
    expect(r.ok).toBe(true);
    expect(r.code).toContain("import {Scene, Circle, Create, PINK, UP, LEFT} from 'manim';");
    expect(r.code).toContain('yield* this.play(Create(circle))');
    expect(r.code).toContain('yield* this.wait(0.5)');
    expect(r.code).not.toContain('from manim import');
  });

  test('the generated TSX compiles in TSX mode, with vector arithmetic', () => {
    const compiled = compileScene(civetToTsx(MANIM, API).code, tsx);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.classNames).toEqual(['Demo']);
    expect(compiled.js).toContain('__op.add(__op.mul(2 , _manim.UP) , _manim.LEFT)');
  });

  test('a native scene needs no import list', () => {
    const r = civetToTsx('import { makeScene2D } from "@canvas-commons/2d"\nexport default makeScene2D (view) ->\n  yield* view.opacity 0, 1\n', API);
    expect(r.ok).toBe(true);
    expect(r.code).not.toContain("'manim'");
    expect(compileScene(r.code, tsx).diagnostics).toEqual([]);
  });

  test('a scene that does not compile is left alone', () => {
    const r = civetToTsx('class A extends\n  (((', API);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('class A extends\n  (((');
  });
});

describe('usedNames', () => {
  test('ignores member names, object keys, strings, comments and local declarations', () => {
    const code = `const Square = 1; // Transform
      circle.FadeOut(); f({PINK: 1}); s = "VGroup"; x = Circle(); y = a ? UP : LEFT; <Create />`;
    expect(usedNames(code, API)).toEqual(['Circle', 'Create', 'UP', 'LEFT']);
  });
});

describe('tsxToCivet', () => {
  test('round trip of a Manim scene compiles to the same steps', () => {
    const back = tsxToCivet(civetToTsx(MANIM, API).code);
    expect(back.ok).toBe(true);
    expect(back.code).toContain('from manim import *');
    expect(back.code).toContain('circle := Circle({radius: 2, color: PINK})');
    expect(back.code).toContain('yield* @play(Create(circle))');
    const compiled = compileScene(back.code, {...defaultCompileOptions, implicitYield: false});
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.prelude).toBe(true);
  });

  test('strings and comments are not rewritten', () => {
    const r = tsxToCivet(`const a = "const b = 1;";\nconst c = 2; // keep; this\n`);
    expect(r.code).toBe(`a := "const b = 1;"\nc := 2 // keep; this\n`);
  });

  test('single-parameter arrows get parentheses (Civet would read them as calls)', () => {
    const r = tsxToCivet('const xs = colors.map(color => color + "x => y");\nconst f = async v => v;\n');
    expect(r.code).toBe('xs := colors.map((color) => color + "x => y")\nf := async (v) => v\n');
  });

  test('TSX that Civet cannot parse stays TSX and says why', () => {
    const src = `export default makeScene2D(function* (view) {\n  view.add(\n    <Circle\n      // a comment in a tag\n      size={1}\n    />,\n  );\n});\n`;
    const r = tsxToCivet(src);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(src);
    expect(r.notes[0]).toContain('stays in TSX');
  });
});
