import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {apiNames} from '../src/manim';
import {compileScene, defaultCompileOptions} from '../src/runtime/compile';
import {civetToTsx} from '../src/runtime/convert';
import {knownNames} from '../src/runtime/dialect';
import {sceneHints} from '../src/runtime/hints';
import {detectLanguage, normalizeSource} from '../src/runtime/normalize';

const memberNames = knownNames();
const rules = (source: string, language: 'civet' | 'tsx' = 'civet', implicitYield = true) =>
  sceneHints(source, {language, apiNames, memberNames, implicitYield}).map(h => `${h.rule}@${h.line}`);

const PYTHON = `from manim import *

class Demo(Scene):
    def construct(self):
        c = Circle(radius=2, color=BLUE)
        self.play(Create(c), run_time=2)
        self.wait()
`;

const TSX = `import {Scene, Circle, Create, BLUE} from 'manim';

export class Demo extends Scene {
  *construct() {
    const dots = [1, 2, 3].map(i => Circle({radius: i * 0.3}));
    const c = Circle({radius: 2, color: BLUE});
    yield* this.play(Create(c), {run_time: 2});
  }
}
`;

const MIXED = `from manim import *

class Demo extends Scene
  construct()
    const c = Circle({radius: 2, color: BLUE});
    const xs = [1, 2].map(i => i * 2);
    self.play(Create(c), run_time=2)
`;

describe('detectLanguage', () => {
  test('Python, TSX, Civet and mixed input', () => {
    expect(detectLanguage(PYTHON).language).toBe('python');
    expect(detectLanguage(TSX).language).toBe('tsx');
    const mixed = detectLanguage(MIXED);
    expect(mixed.language).toBe('civet');
    expect(mixed.mixed).toBe(true);
    for (const slug of readdirSync(join(import.meta.dir, '../examples'))) {
      const civet = readFileSync(join(import.meta.dir, '../examples', slug, 'scene.civet'), 'utf8');
      expect(`${slug}: ${detectLanguage(civet).language}`).toBe(`${slug}: civet`);
      const tsx = join(import.meta.dir, '../examples', slug, 'original.tsx');
      if (existsSync(tsx)) expect(`${slug}: ${detectLanguage(readFileSync(tsx, 'utf8')).language}`).toBe(`${slug}: tsx`);
    }
  });
});

describe('normalizeSource', () => {
  const compiles = (code: string, language: 'civet' | 'tsx') => compileScene(code, {...defaultCompileOptions, language}).ok;

  test('Python becomes Civet or TSX that compiles', () => {
    const civet = normalizeSource(PYTHON, 'civet', {apiNames});
    expect(civet.ok).toBe(true);
    expect(civet.from).toBe('python');
    expect(civet.code).toContain('Circle(radius: 2, color: BLUE)');
    expect(compiles(civet.code, 'civet')).toBe(true);
    const tsx = normalizeSource(PYTHON, 'tsx', {apiNames});
    expect(tsx.code).toContain('yield* this.play(Create(c), {run_time: 2})');
    expect(compiles(tsx.code, 'tsx')).toBe(true);
  });

  test('TSX into a Civet document keeps single-parameter arrows working', () => {
    const r = normalizeSource(TSX, 'civet', {apiNames});
    expect(r.ok).toBe(true);
    expect(r.code).toContain('.map((i) => Circle');
    expect(compiles(r.code, 'civet')).toBe(true);
  });

  test('valid TSX into a TSX document is left alone', () => {
    const r = normalizeSource(TSX, 'tsx', {apiNames});
    expect(r.changed).toBe(false);
  });

  test('TSX missing yield* gets it', () => {
    const r = normalizeSource(TSX.replace('yield* this.play', 'this.play'), 'tsx', {apiNames});
    expect(r.ok).toBe(true);
    expect(r.code).toContain('yield* this.play(');
    expect(r.notes.join(' ')).toContain('yield*');
  });

  test('mixed Civet/TSX with Python keyword arguments is repaired', () => {
    const civet = normalizeSource(MIXED, 'civet', {apiNames});
    expect(civet.ok).toBe(true);
    expect(civet.code).toContain('run_time: 2');
    expect(civet.code).toContain('.map((i) => i * 2)');
    const tsx = normalizeSource(MIXED, 'tsx', {apiNames});
    expect(tsx.ok).toBe(true);
    expect(tsx.code).toContain('yield* this.play(Create(c), {run_time: 2})');
    expect(compiles(tsx.code, 'tsx')).toBe(true);
  });

  test('a parameter default and a Civet method definition are not keyword arguments', () => {
    const src = `from manim import *

class Demo extends Scene
  construct()
    f := (x = 1) => x
    @helper(2)
  helper(n = 1)
    @wait n
`;
    const r = normalizeSource(src, 'civet', {apiNames});
    expect(r.changed).toBe(false);
  });

  test('code that is broken beyond repair reports the Civet error', () => {
    const r = normalizeSource('class Demo extends Scene\n  construct()\n    @play Create(]', 'civet', {apiNames});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Civet');
  });
});

describe('sceneHints', () => {
  test('no hints for any bundled example, in Civet, converted TSX or the TSX original', () => {
    const dir = join(import.meta.dir, '../examples');
    for (const slug of readdirSync(dir)) {
      const civet = readFileSync(join(dir, slug, 'scene.civet'), 'utf8');
      expect(`${slug}: ${rules(civet)}`).toBe(`${slug}: `);
      expect(`${slug} (tsx): ${rules(civetToTsx(civet, apiNames).code, 'tsx')}`).toBe(`${slug} (tsx): `);
      const original = join(dir, slug, 'original.tsx');
      if (existsSync(original)) expect(`${slug} (original): ${rules(readFileSync(original, 'utf8'), 'tsx')}`).toBe(`${slug} (original): `);
    }
  });

  test('Civet reads a bare single-parameter arrow as a call', () => {
    expect(rules('from manim import *\nclass A extends Scene\n  construct()\n    xs := [1].map(i => i * 2)\n')).toContain('civet-arrow-call@4');
  });

  test('Python habits', () => {
    const r = rules('from manim import *\nclass A extends Scene\n  construct()\n    c := Circle(radius=2)\n    c.set_fill(BLUE, opacity=None)\n');
    expect(r).toContain('python-kwarg@4');
    expect(r).toContain('python-literal@5');
    expect(rules(PYTHON)).toContain('python-def@4');
  });

  test('TSX: Civet syntax, a non-generator construct, and a missing yield*', () => {
    const r = rules(`from manim import *\nclass A extends Scene {\n  construct() {\n    const c = Circle();\n    this.play(Create(c));\n    @wait 1\n  }\n}\n`, 'tsx');
    expect(r).toContain('civet-in-tsx@1');
    expect(r).toContain('construct-generator@3');
    expect(r).toContain('missing-yield@5');
  });

  test('explicit-yield Civet needs yield* too', () => {
    const src = 'from manim import *\nclass A extends Scene\n  construct()\n    @play Create Circle()\n';
    expect(rules(src, 'civet', true)).not.toContain('missing-yield@4');
    expect(rules(src, 'civet', false)).toContain('missing-yield@4');
  });

  test('names that do not exist here, with suggestions', () => {
    const hints = sceneHints(
      'from manim import *\nclass A extends ThreeDScene\n  construct()\n    c := Cirlce()\n    c.set_fill_colour BLUE\n    c.shift UPP\n',
      {language: 'civet', apiNames, memberNames},
    );
    const by = (rule: string) => hints.find(h => h.rule === rule);
    expect(by('unsupported')?.message).toContain('3D');
    expect(by('unknown-name')?.message).toContain('`Circle`');
    expect(by('unknown-method')?.line).toBe(5);
    expect(by('unknown-constant')?.message).toContain('`UP`');
  });

  test('a native tween that is never run', () => {
    const src = `import {makeScene2D, Circle} from '@canvas-commons/2d';
import {createRef} from '@canvas-commons/core';
export default makeScene2D(function* (view) {
  const c = createRef<Circle>();
  view.add(<Circle ref={c} />);
  c().scale(2, 1);
});
`;
    expect(rules(src, 'tsx')).toContain('native-tween-unused@6');
  });

  test('points mutation and module-level mobjects', () => {
    const r = rules('from manim import *\nshared := Circle()\nclass A extends Scene\n  construct()\n    shared.points[0] = [0, 0, 0]\n    @add shared\n');
    expect(r).toContain('module-mobject@2');
    expect(r).toContain('points-mutation@5');
  });

  test('a missing manim import', () => {
    expect(rules('class A extends Scene\n  construct()\n    @play Create Circle()\n')).toContain('manim-import@1');
  });
});

describe('agent docs', () => {
  test('every complete scene in docs/agents compiles, with no hints', () => {
    const dir = join(import.meta.dir, '../docs/agents');
    let count = 0;
    for (const file of readdirSync(dir)) {
      const md = readFileSync(join(dir, file), 'utf8');
      for (const m of md.matchAll(/```(civet|tsx)\n([\s\S]*?)```/g)) {
        const [, language, code] = m as unknown as [string, 'civet' | 'tsx', string];
        if (!/makeScene2D|extends Scene\b/.test(code)) continue;
        count++;
        const compiled = compileScene(code, {...defaultCompileOptions, language});
        expect(`${file}: ${compiled.diagnostics.map(d => `${d.line}: ${d.message}`).join('; ')}`).toBe(`${file}: `);
        expect(`${file}: ${rules(code, language)}`).toBe(`${file}: `);
      }
    }
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

describe('Python habits in Civet and TSX', () => {
  test('a first assignment becomes a declaration; fields and declared names do not', () => {
    const src = `from manim import *

class A extends Scene
  speed = 2
  construct()
    total .= 0
    dots = [1, 2].map((i) => Dot())
    n = 1
    n = n + 1
    total = 3
`;
    const r = normalizeSource(src, 'civet', {apiNames, from: 'civet'});
    expect(r.code).toContain('  speed = 2');
    expect(r.code).toContain('dots := [1, 2]');
    expect(r.code).toContain('n .= 1');
    expect(r.code).toContain('    n = n + 1');
    expect(r.code).toContain('    total = 3');
  });

  test('`*xs` unpacking in a call becomes a spread', () => {
    const r = normalizeSource('from manim import *\nclass A extends Scene\n  construct()\n    dots := [Dot()]\n    @play LaggedStart(*dots.map((d) => FadeIn(d)), lag_ratio: 0.3)\n    x := 2 * 3\n', 'civet', {apiNames, from: 'civet'});
    expect(r.ok).toBe(true);
    expect(r.code).toContain('LaggedStart(...dots.map');
    expect(r.code).toContain('x := 2 * 3');
  });
});

describe('repairs leave correct code alone', () => {
  test('no bundled example changes when normalised to its own language', () => {
    const dir = join(import.meta.dir, '../examples');
    for (const slug of readdirSync(dir)) {
      const civet = readFileSync(join(dir, slug, 'scene.civet'), 'utf8');
      const r = normalizeSource(civet, 'civet', {apiNames, from: 'civet'});
      expect(`${slug}: ${r.changed} ${r.notes.join(' ')}`).toBe(`${slug}: false `);
      const original = join(dir, slug, 'original.tsx');
      if (existsSync(original)) {
        const t = normalizeSource(readFileSync(original, 'utf8'), 'tsx', {apiNames, from: 'tsx'});
        expect(`${slug} (tsx): ${t.changed} ${t.notes.join(' ')}`).toBe(`${slug} (tsx): false `);
      }
    }
  });
});

describe('editor-side helpers', async () => {
  const {applyEdit, lineDiff, revisionOf} = await import('../src/editor/agent');

  test('applyEdit replaces unique text, refuses missing or ambiguous text', () => {
    const src = 'a := 1\nb := 2\nb := 2\n';
    expect(applyEdit(src, {old: 'a := 1', new: 'a := 3'})).toBe('a := 3\nb := 2\nb := 2\n');
    expect((applyEdit(src, {old: 'c := 1', new: 'x'}) as {error: string}).error).toContain('not found');
    expect((applyEdit(src, {old: 'b := 2', new: 'x'}) as {error: string}).error).toContain('occurs 2 times');
    expect(applyEdit(src, {old: 'b := 2', new: 'b := 5', all: true})).toBe('a := 1\nb := 5\nb := 5\n');
  });

  test('applyEdit accepts text copied with the line-number gutter', () => {
    const src = 'x := 1\ny := 2\n';
    expect(applyEdit(src, {old: ' 2│ y := 2', new: ' 2│ y := 4'})).toBe('x := 1\ny := 4\n');
  });

  test('lineDiff shows removals before additions, with context', () => {
    const d = lineDiff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nd\nE\nf\ng\nh');
    expect(d.map(l => l.kind)).toEqual(['gap', 'same', 'same', 'del', 'add', 'same', 'same', 'gap']);
    const kinds = d.map(l => l.kind).join(' ');
    expect(kinds).toContain('del add');
    expect(d.find(l => l.kind === 'del')!.text).toBe('e');
    expect(d.find(l => l.kind === 'add')!.text).toBe('E');
  });

  test('revisionOf is stable and changes with the text', () => {
    expect(revisionOf('abc')).toBe(revisionOf('abc'));
    expect(revisionOf('abc')).not.toBe(revisionOf('abd'));
  });
});
