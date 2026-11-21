import {describe, expect, test} from 'bun:test';
import {
  compileScene,
  defaultCompileOptions,
  expandDialect,
  overloadOperators,
} from '../src/runtime/compile';
import {__op} from '../src/manim/vec';

const expand = (source: string, options = defaultCompileOptions) => expandDialect(source, options);
const lines = (s: string) => s.split('\n').length;

/** Run transformed code with the real `__op` and return the value of `result`. */
function run(js: string, scope: Record<string, unknown> = {}): any {
  const names = Object.keys(scope);
  const fn = new Function('__op', ...names, `${overloadOperators(js)}\nreturn result;`);
  return fn(__op, ...names.map(n => scope[n]));
}
const UP = [0, 1, 0];
const LEFT = [-1, 0, 0];
const RIGHT = [1, 0, 0];

describe('expandDialect', () => {
  test('recognises the prelude and keeps the line count', () => {
    const source = 'from manim import *\n\nclass A extends Scene\n  construct()\n    @wait()\n';
    const {code, prelude} = expand(source);
    expect(prelude).toBe(true);
    expect(code.split('\n')[0]).toBe('// from manim import *');
    expect(lines(code)).toBe(lines(source));
  });

  test('no prelude without the import line', () => {
    expect(expand('class A extends Scene\n  construct()\n    @wait()\n').prelude).toBe(false);
    expect(expand('x := "from manim import *"\n').prelude).toBe(false);
  });

  test('inserts yield* before @play, @wait and @pause', () => {
    const {code} = expand('    @play Create circle\n    @wait 2\n    @pause()\n');
    expect(code).toBe('    yield* @play Create circle\n    yield* @wait 2\n    yield* @pause()\n');
  });

  test('also when written as this.play', () => {
    expect(expand('    this.play FadeIn x\n').code).toBe('    yield* this.play FadeIn x\n');
  });

  test('Python habits: self.play(...) and construct(self)', () => {
    const {code} = expand('  construct(self)\n    self.play(Create(c))\n    self.add(c)\n    helper(self, 1)\n');
    expect(code).toBe('  construct()\n    yield* @play(Create(c))\n    @add(c)\n    helper(1)\n');
  });

  test('does not touch names that merely contain self, play or wait', () => {
    const source = '    myself.x = 1\n    @playful()\n    display.play()\n    @awaiting = 2\n';
    expect(expand(source).code).toBe(source);
  });

  test('does not yield twice', () => {
    const source = '    yield* @play Create c\n    yield @wait()\n';
    expect(expand(source).code).toBe(source);
  });

  test('leaves comments and method definitions alone', () => {
    const source = '    # @play this later\n    // @wait()\n  wait()\n    1\n  play(a, b)\n    2\n';
    expect(expand(source).code).toBe(source);
  });

  test('a play among other calls on one line', () => {
    expect(expand('    if ready then @play Create c\n').code).toBe('    if ready then yield* @play Create c\n');
  });

  test('helper methods that animate become generators, and their callers yield', () => {
    const source = [
      'class A extends Scene',
      '  construct()',
      '    @intro()',
      '    @setup_axes()',
      '  intro()',
      '    @play Create c',
      '  setup_axes()',
      '    @add ax',
      '',
    ].join('\n');
    const out = expand(source).code.split('\n');
    expect(out[2]).toBe('    yield* @intro()');
    expect(out[3]).toBe('    @setup_axes()');
    expect(out[5]).toBe('    yield* @play Create c');
  });

  test('generator helpers propagate through several levels', () => {
    const source = [
      '  construct()',
      '    @outer()',
      '  outer()',
      '    @inner()',
      '  inner()',
      '    @wait()',
      '',
    ].join('\n');
    const out = expand(source).code.split('\n');
    expect(out[1]).toBe('    yield* @outer()');
    expect(out[3]).toBe('    yield* @inner()');
  });

  test('implicitYield can be switched off', () => {
    const source = '    @play Create c\n';
    expect(expand(source, {...defaultCompileOptions, implicitYield: false}).code).toBe(source);
  });
});

describe('overloadOperators', () => {
  test('vector arithmetic: 2 * UP + LEFT', () => {
    expect(run('const result = 2 * UP + LEFT;', {UP, LEFT})).toEqual([-1, 2, 0]);
  });

  test('precedence and associativity are preserved', () => {
    expect(run('const result = a - b - c;', {a: 10, b: 3, c: 2})).toBe(5);
    expect(run('const result = a - (b - c);', {a: 10, b: 3, c: 2})).toBe(9);
    expect(run('const result = a + b * c;', {a: 1, b: 2, c: 3})).toBe(7);
    expect(run('const result = (a + b) * c;', {a: 1, b: 2, c: 3})).toBe(9);
    expect(run('const result = a / b / c;', {a: 12, b: 3, c: 2})).toBe(2);
  });

  test('subtraction and division of points', () => {
    expect(run('const result = (a - b) / 2;', {a: [4, 3, 0], b: [2, 1, 0]})).toEqual([1, 1, 0]);
  });

  test('unary minus on a vector', () => {
    expect(run('const result = -UP;', {UP})).toEqual([-0, -1, -0]);
    expect(run('const result = -x + 1;', {x: 4})).toBe(-3);
    expect(run('const result = a - -b;', {a: 1, b: 2})).toBe(3);
  });

  test('compound assignment', () => {
    expect(run('let result = UP; result += LEFT; result *= 2;', {UP, LEFT})).toEqual([-2, 2, 0]);
    expect(run('const o = {p: RIGHT}; o.p -= RIGHT; const result = o.p;', {RIGHT})).toEqual([0, 0, 0]);
    expect(run('let result = 1; result += 2; result /= 3;')).toBe(1);
  });

  test('compound assignment with a numeric right-hand side still dispatches', () => {
    expect(run('let result = UP; result *= 2;', {UP})).toEqual([0, 2, 0]);
    expect(run('let result = [2, 4, 0]; result /= 2; result -= 1;')).toEqual([0, 1, -1]);
    expect(run('let result = "n"; result += 1;')).toBe('n1');
  });

  test('pure number maths is left untouched', () => {
    const js = 'const result = 2 * 3 + -4 / (1 - 5);';
    expect(overloadOperators(js)).toBe(js);
    expect(run(js)).toBe(7);
  });

  test('string concatenation is left untouched', () => {
    const js = 'const result = "a" + b + `c${1 + 1}`;';
    expect(overloadOperators(js)).toContain('"a" + b');
    expect(run(js, {b: 'b'})).toBe('abc2');
  });

  test('other operators are not rewritten', () => {
    const js = 'const result = [a ** 2, a % 3, a > 1, a << 1, i++, typeof a];';
    expect(overloadOperators(`let i = 0; ${js}`)).toBe(`let i = 0; ${js}`);
  });

  test('expressions inside calls, arrows and template literals', () => {
    expect(run('const f = p => p + [1, 1, 0]; const result = f(UP);', {UP})).toEqual([1, 2, 0]);
    expect(run('const result = [UP, LEFT].map(v => v * 2);', {UP, LEFT})).toEqual([[0, 2, 0], [-2, 0, 0]]);
    expect(run('const result = `${1 + n}`;', {n: 2})).toBe('3');
  });

  test('line numbers do not move', () => {
    const js = 'const a = UP +\n  LEFT;\nconst result = a\n  * 2;';
    const out = overloadOperators(js);
    expect(lines(out)).toBe(lines(js));
    expect(out.split('\n')[2]).toContain('const result');
    expect(run(js, {UP, LEFT})).toEqual([-2, 2, 0]);
  });

  test('comments between operands are tolerated', () => {
    expect(run('const result = a /* plus */ + b;', {a: [1, 0, 0], b: [0, 1, 0]})).toEqual([1, 1, 0]);
  });

  test('yield expressions and generators survive', () => {
    const js = 'function* g(){ const x = (yield 1) + 1; return x * 2; }\nconst it = g(); it.next(); const result = it.next(4).value;';
    expect(run(js)).toBe(10);
  });
});

describe('compileScene', () => {
  const scene = [
    'from manim import *',
    '',
    'class Demo extends Scene',
    '  construct()',
    '    circle := Circle radius: 2, fill_opacity: 0.5  # a comment',
    '    circle.shift 2 * UP + LEFT',
    '    @play Create circle',
    '    @wait()',
    '',
  ].join('\n');

  test('compiles a Manim-style scene', () => {
    const r = compileScene(scene);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.prelude).toBe(true);
    expect(r.classNames).toEqual(['Demo']);
    expect(r.ts).toContain('*construct()');
    expect(r.ts).toContain('yield* this.play(Create(circle))');
    expect(r.ts).toContain('Circle({radius: 2, fill_opacity: 0.5})');
    expect(r.js.replace(/\s+,/g, ',')).toContain('circle.shift(__op.add(__op.mul(2, UP), LEFT))');
    expect(r.js).toContain('exports.__classes = {Demo}');
  });

  test('the line map points back at the source', () => {
    const r = compileScene(scene);
    const jsLines = r.js.split('\n');
    const playLine = jsLines.findIndex(l => l.includes('this.play('));
    expect(r.lineMap[playLine]).toBe(7);
    const shiftLine = jsLines.findIndex(l => l.includes('circle.shift('));
    expect(r.lineMap[shiftLine]).toBe(6);
  });

  test('the compiled module runs', () => {
    const r = compileScene(scene);
    const calls: string[] = [];
    class Scene {
      *play(...args: unknown[]) {
        calls.push(`play:${args.length}`);
      }
      *wait() {
        calls.push('wait');
      }
    }
    const shifted: unknown[] = [];
    const Circle = (opts: unknown) => ({opts, shift: (v: unknown) => shifted.push(v)});
    const Create = (m: unknown) => ({create: m});
    const exports: Record<string, any> = {};
    new Function('exports', '__op', 'Scene', 'Circle', 'Create', 'UP', 'LEFT', r.js)(
      exports, __op, Scene, Circle, Create, UP, LEFT,
    );
    const instance = new exports.__classes.Demo();
    for (const _ of instance.construct()) void _;
    expect(calls).toEqual(['play:1', 'wait']);
    expect(shifted).toEqual([[-1, 2, 0]]);
  });

  test('operators can be switched off', () => {
    const r = compileScene(scene, {...defaultCompileOptions, operators: false});
    expect(r.ok).toBe(true);
    expect(r.js).not.toContain('__op.');
  });

  test('a syntax error is reported with its line', () => {
    const r = compileScene('from manim import *\n\nclass Demo extends Scene\n  construct()\n    x := (1 +\n');
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0].stage).toBe('civet');
    expect(typeof r.diagnostics[0].message).toBe('string');
  });

  test('raw TeX strings through the r tag keep their backslashes', () => {
    const r = compileScene('from manim import *\nclass T extends Scene\n  construct()\n    @add MathTex r`\\frac{a}{b} \\\\ \\LaTeX`\n');
    expect(r.ok).toBe(true);
    const seen: string[] = [];
    const exports: Record<string, any> = {};
    class Scene {
      add(x: string) {
        seen.push(x);
      }
    }
    const rTag = (s: TemplateStringsArray, ...v: unknown[]) => String.raw(s, ...v);
    new Function('exports', '__op', 'Scene', 'MathTex', 'r', r.js)(exports, __op, Scene, (s: string) => s, rTag);
    new exports.__classes.T().construct();
    expect(seen).toEqual(['\\frac{a}{b} \\\\ \\LaTeX']);
  });

  test('every example in examples/ compiles', async () => {
    const {readdirSync, existsSync, readFileSync} = await import('node:fs');
    const {join} = await import('node:path');
    const dir = join(import.meta.dir, '..', 'examples');
    const failures: string[] = [];
    let count = 0;
    for (const slug of readdirSync(dir)) {
      const file = join(dir, slug, 'scene.civet');
      if (!existsSync(file)) continue;
      count++;
      const r = compileScene(readFileSync(file, 'utf8'));
      if (!r.ok) failures.push(`${slug}: ${r.diagnostics.map(d => d.message).join('; ')}`);
    }
    expect(failures).toEqual([]);
    expect(count).toBeGreaterThan(15);
  });
});
