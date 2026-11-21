import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {transform} from 'sucrase';
import {compileScene, defaultCompileOptions} from '../src/runtime/compile';
import {DecoratorError, __decorate, lowerDecorators} from '../src/runtime/decorators';

const example = (file: string) => readFileSync(join(import.meta.dir, '../examples/cc-custom-component', file), 'utf8');
const lines = (...l: string[]) => l.join('\n');

/** The `__decorate(...)` statements of a lowered source, in order. */
const calls = (out: string) => [...out.matchAll(/__decorate\(\[(.*?)\], ([\w.]+)(?:, (.*?), (void 0|null))?\)/g)].map(m => m.slice(1, 5).filter(x => x !== undefined));

/**
 * Every line of the output is the input line, except where a decorator was
 * blanked out or the calls were appended.
 */
function expectLinesKept(source: string, out: string) {
  const a = source.split('\n');
  const b = out.split('\n');
  expect(b.length).toBe(a.length);
  for (let i = 0; i < a.length; i++) {
    if (b[i].includes('__dec')) continue;
    if (a[i].includes('@')) expect(b[i].length).toBe(a[i].length);
    else expect(b[i]).toBe(a[i]);
  }
}

/**
 * Lower a source, compile it with sucrase as the editor does, and run it.
 * The source gets `dec(tag)`, a decorator factory that records when it is
 * evaluated and what it is applied to.
 */
function run(source: string, scope: Record<string, unknown> = {}) {
  const events: string[] = [];
  const applied: {tag: string; target: any; key: PropertyKey; desc: any; argc: number}[] = [];
  const decorated: {target: any; key: PropertyKey; argc: number}[] = [];
  const dec = (tag: string) => {
    events.push(`eval ${tag}`);
    return (...args: any[]) => {
      events.push(`apply ${tag}`);
      applied.push({tag, target: args[0], key: args[1], desc: args[2], argc: args.length});
    };
  };
  const decorate = (...args: any[]) => {
    decorated.push({target: args[1], key: args[2], argc: args.length});
    return (__decorate as any)(...args);
  };
  const js = transform(lowerDecorators(source), {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
  }).code;
  const exports: Record<string, any> = {};
  const jsx = (type: unknown, props: unknown) => ({type, props});
  const require = () => ({jsx, jsxs: jsx, Fragment: 'fragment'});
  const names = Object.keys(scope);
  new Function('exports', 'require', '__decorate', 'dec', ...names, js)(exports, require, decorate, dec, ...names.map(n => scope[n]));
  return {exports, events, applied, decorated, js};
}

describe('lowerDecorators', () => {
  test('a source without decorators is returned as it is', () => {
    const plain = 'class A { x = 1; }\n';
    expect(lowerDecorators(plain)).toBe(plain);
    // An `@` that is not a decorator changes nothing either.
    const noise = lines(
      "import {Rect} from '@canvas-commons/2d';",
      'class A {',
      "  s = '@x } {';",
      '  // @notADecorator }',
      '  /* @nope { */',
      "  t = `@x ${ {a: '}'}.a } }`;",
      '  r = /[}@]/.test(this.s) ? 1 / 2 : 3 / 4;',
      '  render() { return <Txt text="@a }">it\'s } @not {"}"} <b>@x</b></Txt>; }',
      '}',
    );
    expect(lowerDecorators(noise)).toBe(noise);
  });

  test('property decorators become a __decorate call after the class', () => {
    const source = lines(
      'export class Switch extends Node {',
      '  @initial(false)',
      '  @signal()',
      '  declare public readonly initialState: SimpleSignal<boolean, this>;',
      '',
      "  @initial('#68ABDF')",
      '  @colorSignal()',
      '  declare public readonly accent: ColorSignal<this>;',
      '}',
      'export const after = 1;',
    );
    const out = lowerDecorators(source);
    expect(out.split('\n')).toEqual([
      'export class Switch extends Node {',
      '                 ',
      '           ',
      '  declare public readonly initialState: SimpleSignal<boolean, this>;',
      '',
      '                     ',
      '                ',
      '  declare public readonly accent: ColorSignal<this>;',
      '};__decorate([initial(false), signal()], Switch.prototype, "initialState", void 0);' +
        '__decorate([initial(\'#68ABDF\'), colorSignal()], Switch.prototype, "accent", void 0);',
      'export const after = 1;',
    ]);
  });

  test('the output has the same lines as the input', () => {
    for (const file of ['original.tsx', 'scene.civet']) {
      const source = file.endsWith('.civet') ? compileScene(example(file)).ts : example(file);
      const out = lowerDecorators(source);
      expect(out).not.toBe(source);
      expectLinesKept(source, out);
      expect(out.replace(/\/\/.*/g, '')).not.toMatch(/^\s*@/m);
    }
  });

  test('several decorators on one line', () => {
    const out = lowerDecorators('class A { @a() @b foo = 1; @c() static bar() {} }');
    expect(out).toBe(
      'class A {         foo = 1;      static bar() {} };' +
        '__decorate([a(), b], A.prototype, "foo", void 0);__decorate([c()], A, "bar", null);',
    );
  });

  test('decorators separated by comments and blank lines', () => {
    const source = lines(
      'class A {',
      '  // @initial - sets the default',
      '  @initial(1)',
      '  // @signal - is required { for every prop',
      '',
      '  @signal() /* } */',
      '  declare public readonly x: SimpleSignal<number, this>;',
      '}',
    );
    const out = lowerDecorators(source);
    expectLinesKept(source, out);
    expect(calls(out)).toEqual([['initial(1), signal()', 'A.prototype', '"x"', 'void 0']]);
    expect(out).toContain('// @signal - is required { for every prop');
  });

  test('decorator arguments may nest brackets, strings, functions and regular expressions', () => {
    const args = "{a: ')', b: [1, (2)], c: () => ({x: '}'}), d: `${'`'}@x}`, e: /[)}]\\//g, f: function () { return '('; }}";
    const out = lowerDecorators(lines('class A {', `  @initial(${args})`, '  @ns.signal<T>()', '  @(pick(1))', '  declare x: T;', '}'));
    expect(out.split('\n').pop()).toBe(`};__decorate([initial(${args}), ns.signal<T>(), (pick(1))], A.prototype, "x", void 0);`);
  });

  test('modifiers decide the target and the descriptor argument', () => {
    const members: [string, string, string, string][] = [
      ['declare public readonly p1: SimpleSignal<number, this>;', 'A.prototype', '"p1"', 'void 0'],
      ['protected readonly p2 = 1;', 'A.prototype', '"p2"', 'void 0'],
      ['private static override s1: Map<string, Array<number>> = new Map();', 'A', '"s1"', 'void 0'],
      ['public static async s2() {}', 'A', '"s2"', 'null'],
      ['public *gen(n: number): Generator<number> { yield n; }', 'A.prototype', '"gen"', 'null'],
      ['async *agen() {}', 'A.prototype', '"agen"', 'null'],
      ['public get g(): number { return 1; }', 'A.prototype', '"g"', 'null'],
      ['public set h(v: number) {}', 'A.prototype', '"h"', 'null'],
      ['static get sg() { return 1; }', 'A', '"sg"', 'null'],
      ["'quoted-name' = 1;", 'A.prototype', "'quoted-name'", 'void 0'],
      ['[Symbol.iterator]() {}', 'A.prototype', 'Symbol.iterator', 'null'],
      ['42 = 1;', 'A.prototype', '"42"', 'void 0'],
      ['get = 1;', 'A.prototype', '"get"', 'void 0'],
      ['static = 2;', 'A.prototype', '"static"', 'void 0'],
      ['static static() {}', 'A', '"static"', 'null'],
      ['async() {}', 'A.prototype', '"async"', 'null'],
      ['optional?: number;', 'A.prototype', '"optional"', 'void 0'],
      ['definite!: number;', 'A.prototype', '"definite"', 'void 0'],
      ['method<T extends {a: number}>(x: T): {a: number} { return x; }', 'A.prototype', '"method"', 'null'],
      ['guard(): this is A { return true; }', 'A.prototype', '"guard"', 'null'],
      ['arrow = (e: Event): void => { if (e) { } };', 'A.prototype', '"arrow"', 'void 0'],
      ['overloaded(x: number): void;', 'A.prototype', '"overloaded"', 'null'],
    ];
    const source = lines(
      'class A extends B {',
      ...members.map(m => `  @d ${m[0]}`),
      '  static { init(); }',
      '  constructor(private x: number) { super(); }',
      '}',
    );
    const out = lowerDecorators(source);
    expectLinesKept(source, out);
    // As in TypeScript's output, instance members come first, then static ones.
    const ordered = [...members.filter(m => m[1] !== 'A'), ...members.filter(m => m[1] === 'A')];
    expect(calls(out)).toEqual(ordered.map(m => ['d', m[1], m[2], m[3]]));
    // Each member is still there, on its line, without its decorator.
    out.split('\n').slice(1, members.length + 1).forEach((line, i) => expect(line).toBe(`     ${members[i][0]}`));
  });

  test('class declarations, exported or not, and class expressions bound to a name', () => {
    const source = lines(
      'export class A { @d x; }',
      'export default class B { @d x; }',
      'abstract class C { @d x; }',
      'const D = class extends Y { @d x; };',
      'export const E = class Named { @d static x; }',
      'let F = class { @d x() {} }',
    );
    expect(lowerDecorators(source).split('\n')).toEqual([
      'export class A {    x; };__decorate([d], A.prototype, "x", void 0);',
      'export default class B {    x; };__decorate([d], B.prototype, "x", void 0);',
      'abstract class C {    x; };__decorate([d], C.prototype, "x", void 0);',
      'const D = class extends Y {    x; };__decorate([d], D.prototype, "x", void 0);;',
      'export const E = class Named {    static x; };__decorate([d], E, "x", void 0);',
      'let F = class {    x() {} };__decorate([d], F.prototype, "x", null);',
    ]);
  });

  test('other class expressions are decorated through a function', () => {
    const source = lines(
      'foo(class { @d x; });',
      'const E = wrap(class extends Y { @d x; }), F = 2;',
      'x.G = class { @d x() {} };',
      'export default class extends Node {',
      '  @d x;',
      '}',
      'export const y = 1;',
    );
    expect(lowerDecorators(source).split('\n')).toEqual([
      'foo(((__c) => (__decorate([d], __c.prototype, "x", void 0), __c))(class {    x; }));',
      'const E = wrap(((__c) => (__decorate([d], __c.prototype, "x", void 0), __c))(class extends Y {    x; })), F = 2;',
      'x.G = ((__c) => (__decorate([d], __c.prototype, "x", null), __c))(class {    x() {} });',
      'export default ((__c) => (__decorate([d], __c.prototype, "x", void 0), __c))(class extends Node {',
      '     x;',
      '});',
      'export const y = 1;',
    ]);
  });

  test('several classes in a file, and classes inside methods', () => {
    const source = lines(
      'class Outer {',
      '  @d a = 1;',
      '  method() {',
      '    class Inner { @d b; }',
      '    return class { @d c; };',
      '  }',
      '  @d z() {}',
      '}',
      'class Second<T extends {a: 1}> extends Base<{b: 2}> implements I<T> {',
      '  @d s;',
      '}',
    );
    const out = lowerDecorators(source);
    expectLinesKept(source, out);
    expect(out.split('\n')[3]).toBe('    class Inner {    b; };__decorate([d], Inner.prototype, "b", void 0);');
    expect(out.split('\n')[4]).toBe('    return ((__c) => (__decorate([d], __c.prototype, "c", void 0), __c))(class {    c; });');
    expect(out.split('\n')[7]).toBe('};__decorate([d], Outer.prototype, "a", void 0);__decorate([d], Outer.prototype, "z", null);');
    expect(out.split('\n')[10]).toBe('};__decorate([d], Second.prototype, "s", void 0);');
  });

  test('strings, comments, templates, regular expressions and JSX in a class body are not code', () => {
    const body = [
      "  s = '@x } {';",
      '  // @notADecorator }',
      '  /* @nope {',
      '     } */',
      "  t = `@x ${ {a: '}'}.a } } ${`}`}`;",
      '  r = /[}@]/.test(this.s) ? 1 / 2 : 3 / 4;',
      '  render() {',
      '    const small = this.a < this.b;',
      '    return (',
      '      <Txt',
      '        // a comment in a tag }',
      '        text="@a }"',
      "        other='{'",
      '        fill={small ? "}" : <></>}',
      '      >',
      "        it's } @not a decorator {'}'} {/* } */}",
      '        <b>@x</b>',
      '      </Txt>',
      '    );',
      '  }',
      '  generic = <T,>(x: T) => x;',
    ];
    const source = lines('class A {', ...body, '  @real()', '  declare v: number;', '}', 'const after = `}`;');
    const out = lowerDecorators(source).split('\n');
    expect(out.slice(1, body.length + 1)).toEqual(body);
    expect(out[body.length + 3]).toBe('};__decorate([real()], A.prototype, "v", void 0);');
    expect(out[body.length + 4]).toBe('const after = `}`;');
  });

  test('class bodies without semicolons, as Civet writes them', () => {
    const source = lines(
      'class A extends Node {',
      '  @initial(false)',
      '  @signal()',
      '  declare readonly a: SimpleSignal<boolean, this>',
      '',
      '  b: boolean',
      '  readonly c = createSignal(0)',
      '  d = x as Map<string, number>',
      '  @computed()',
      '  e() {',
      '    return 1',
      '  }',
      '  f = () => {',
      '    return 2',
      '  }',
      '  g = this.c() +',
      '    2',
      '  @threadable()',
      '  *h() {}',
      '}',
    );
    const out = lowerDecorators(source);
    expectLinesKept(source, out);
    expect(calls(out)).toEqual([
      ['initial(false), signal()', 'A.prototype', '"a"', 'void 0'],
      ['computed()', 'A.prototype', '"e"', 'null'],
      ['threadable()', 'A.prototype', '"h"', 'null'],
    ]);
  });

  test('a decorator that spans lines stays in place', () => {
    const source = lines(
      'class A {',
      '  @vector2Signal({',
      "    x: 'width',",
      "    y: 'height',",
      '  })',
      '  @signal()',
      '  declare public readonly size: Vector2Signal<this>;',
      '',
      '  @lazy(() => {',
      "    const a = document.createElement('span')",
      '    return a',
      '  })',
      '  protected static formatter: HTMLElement;',
      '}',
    );
    expect(lowerDecorators(source).split('\n')).toEqual([
      'class A {',
      '  static __dec0 = vector2Signal({',
      "    x: 'width',",
      "    y: 'height',",
      '  });',
      '           ',
      '  declare public readonly size: Vector2Signal<this>;',
      '',
      '  static __dec1 = lazy(() => {',
      "    const a = document.createElement('span')",
      '    return a',
      '  });',
      '  protected static formatter: HTMLElement;',
      '};__decorate([A.__dec0, signal()], A.prototype, "size", void 0);__decorate([A.__dec1], A, "formatter", void 0);' +
        'delete A.__dec0;delete A.__dec1;',
    ]);
  });

  test('class decorators', () => {
    const source = lines(
      '@sealed',
      'class A { @d x; }',
      "@reg('b') export class B {}",
      "@reg('c')",
      'export default class C { @d static y() {} }',
      "export @reg('d') class D {}",
      "const E = @reg('e') class {};",
      "@reg('f') export default class {}",
    );
    expect(lowerDecorators(source).split('\n')).toEqual([
      '       ',
      'class A {    x; };__decorate([d], A.prototype, "x", void 0);A = __decorate([sealed], A);',
      "                 class B {};B = __decorate([reg('b')], B);export {B};",
      '         ',
      "               class C {    static y() {} };__decorate([d], C, \"y\", null);C = __decorate([reg('c')], C);export default C;",
      "                 class D {};D = __decorate([reg('d')], D);export {D};",
      "const E =           ((__c) => (__decorate([reg('e')], __c)))(class {});",
      "          export default ((__c) => (__decorate([reg('f')], __c)))(class {});",
    ]);
  });

  test('what is not supported is left alone or reported', () => {
    // A class decorator over several lines: the whole class stays as written.
    const multi = lines('@register({', '  name: 1,', '})', 'class G { @d x; }');
    expect(lowerDecorators(multi)).toBe(multi);
    // Parameter decorators are not lowered; the member decorator next to them is.
    expect(lowerDecorators('class A { constructor(@Inject() private x: number) {} @d y; }')).toBe(
      'class A { constructor(@Inject() private x: number) {}    y; };__decorate([d], A.prototype, "y", void 0);',
    );
    // Sources the scanner cannot follow come back unchanged.
    const broken = 'class A { @d x = (1; }';
    expect(lowerDecorators(broken)).toBe(broken);

    let error: unknown;
    try {
      lowerDecorators(lines('class A {', '  ok = 1;', '  @d #secret = 1;', '}'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DecoratorError);
    expect((error as DecoratorError).message).toContain('#private');
    expect((error as DecoratorError).loc).toEqual({line: 3, column: 2});
  });
});

describe('lowered code', () => {
  test('applies decorators to the right members, last to first', () => {
    const {exports, events, applied, decorated} = run(
      lines(
        'export class A {',
        "  @dec('a1')",
        "  @dec('a2')",
        '  declare public readonly a: number;',
        '',
        "  @dec('b1') @dec('b2') @dec('b3')",
        '  public b() { return 1; }',
        '',
        "  @dec('s')",
        '  public static s = 5;',
        '',
        "  @dec('g')",
        '  public get g() { return 2; }',
        '',
        '  public plain = 3;',
        '}',
      ),
    );
    const A = exports.A;
    // Factories run top to bottom, member by member; decorators apply bottom
    // to top. Static members follow the instance members, as in TypeScript.
    expect(events).toEqual([
      'eval a1', 'eval a2', 'apply a2', 'apply a1',
      'eval b1', 'eval b2', 'eval b3', 'apply b3', 'apply b2', 'apply b1',
      'eval g', 'apply g',
      'eval s', 'apply s',
    ]);
    expect(decorated).toEqual([
      {target: A.prototype, key: 'a', argc: 4},
      {target: A.prototype, key: 'b', argc: 4},
      {target: A.prototype, key: 'g', argc: 4},
      {target: A, key: 's', argc: 4},
    ]);
    const by = (tag: string) => applied.find(a => a.tag === tag)!;
    expect(by('a1').target).toBe(A.prototype);
    expect(by('a1').key).toBe('a');
    expect(by('a1').desc).toBeUndefined();
    expect(by('b3').target).toBe(A.prototype);
    expect(by('b3').key).toBe('b');
    expect(by('b3').desc.value).toBe(A.prototype.b);
    expect(by('s').target).toBe(A);
    expect(by('s').key).toBe('s');
    // Static fields are initialized before their decorators run.
    expect(A.s).toBe(5);
    expect(typeof by('g').desc.get).toBe('function');
    expect(new A().plain).toBe(3);
  });

  test('a method decorator can replace the method', () => {
    const {exports} = run(
      lines(
        'export class A {',
        '  @double',
        '  @addOne',
        '  public value(n: number) { return n; }',
        '',
        '  @readonly',
        '  public fixed() { return 1; }',
        '}',
      ),
      {
        double: (_t: unknown, _k: string, desc: PropertyDescriptor) => ({...desc, value: (n: number) => desc.value(n) * 2}),
        addOne: (_t: unknown, _k: string, desc: PropertyDescriptor) => ({...desc, value: (n: number) => desc.value(n) + 1}),
        readonly: (_t: unknown, _k: string, desc: PropertyDescriptor) => {
          desc.writable = false;
        },
      },
    );
    // addOne wraps the method first, double wraps the result.
    expect(new exports.A().value(3)).toBe(8);
    expect(Object.getOwnPropertyDescriptor(exports.A.prototype, 'fixed')!.writable).toBe(false);
  });

  test('a property decorator can define an accessor on the prototype', () => {
    const {exports} = run(
      lines(
        'export class Switch {',
        '  @initial(7)',
        '  @signal()',
        '  declare public readonly level: number;',
        '}',
      ),
      {
        signal: () => (target: any, key: string) => {
          Object.defineProperty(target, key, {get: () => target[`__${key}`], configurable: true});
        },
        initial: (value: unknown) => (target: any, key: string) => {
          // Runs after `signal()`, like Canvas Commons' `@initial`.
          expect(Object.getOwnPropertyDescriptor(target, key)).toBeDefined();
          target[`__${key}`] = value;
        },
      },
    );
    expect(new exports.Switch().level).toBe(7);
  });

  test('class expressions', () => {
    const {exports, applied} = run(
      lines(
        'class Base {}',
        "const Bound = class extends Base { @dec('bound') x() {} };",
        "const made = [class { @dec('element') static y = 1; }];",
        "export default class extends Base { @dec('default') z() {} }",
        'export {Bound, made};',
      ),
    );
    expect(exports.Bound.name).toBe('Bound');
    expect(applied.map(a => [a.tag, a.target, a.key])).toEqual([
      ['bound', exports.Bound.prototype, 'x'],
      ['element', exports.made[0], 'y'],
      ['default', exports.default.prototype, 'z'],
    ]);
    expect(Object.getPrototypeOf(exports.default)).toBe(Object.getPrototypeOf(exports.Bound));
  });

  test('decorators that span lines', () => {
    const {exports, events, applied} = run(
      lines(
        'export class A {',
        '  @dec(',
        "    'first',",
        '  )',
        "  @dec('second')",
        '  declare public readonly a: number;',
        '',
        "  @dec(['third',",
        '  ].join())',
        '  public static b() {}',
        '}',
      ),
    );
    expect(events.filter(e => e.startsWith('apply'))).toEqual(['apply second', 'apply first', 'apply third']);
    expect(applied.map(a => [a.target, a.key])).toEqual([
      [exports.A.prototype, 'a'],
      [exports.A.prototype, 'a'],
      [exports.A, 'b'],
    ]);
    expect(Object.getOwnPropertyNames(exports.A).filter(n => n.startsWith('__dec'))).toEqual([]);
  });

  test('class decorators can replace the class, and exports see the replacement', () => {
    const tagged = (tag: string) => (target: any) => {
      const replacement = class extends target {};
      (replacement as any).tag = tag;
      return replacement;
    };
    const {exports, events} = run(
      lines(
        "@tagged('a')",
        'export class A {',
        "  @dec('member') x() {}",
        '}',
        "@tagged('b') export default class B {}",
        "export const C = @tagged('c') class {};",
        'export const sameA = A;',
      ),
      {tagged},
    );
    expect(exports.A.tag).toBe('a');
    expect(exports.sameA).toBe(exports.A);
    expect(exports.default.tag).toBe('b');
    expect(exports.C.tag).toBe('c');
    expect(events).toEqual(['eval member', 'apply member']);
  });

  test('decorated classes with JSX and generators', () => {
    const {exports, applied} = run(
      lines(
        'export class Switch {',
        "  @dec('state')",
        '  declare public readonly state: boolean;',
        '  public view = <rect fill="@not }">it\'s {this.label()}</rect>;',
        "  @dec('toggle')",
        '  public *toggle(n: number) { yield n; return `${n}}`; }',
        '  public label() { return 1 < 2 ? "on" : "off"; }',
        '}',
      ),
    );
    const s = new exports.Switch();
    expect(s.view).toEqual({type: 'rect', props: {fill: '@not }', children: ["it's ", 'on']}});
    expect([...s.toggle(3)]).toEqual([3]);
    expect(applied.map(a => a.key)).toEqual(['state', 'toggle']);
  });
});

describe('__decorate', () => {
  test('two arguments decorate a class', () => {
    class A {}
    class B {}
    const order: string[] = [];
    const result = __decorate([(c: unknown) => (order.push('first'), c === B ? 'done' : undefined), () => (order.push('second'), B)], A);
    expect(order).toEqual(['second', 'first']);
    expect(result).toBe('done');
    expect(__decorate([() => undefined], A)).toBe(A);
  });

  test('a void 0 descriptor decorates a property and defines nothing', () => {
    const target = {};
    const seen: unknown[][] = [];
    __decorate([(...args: unknown[]) => void seen.push(args)], target, 'x', void 0);
    expect(seen).toEqual([[target, 'x', undefined]]);
    expect(Object.getOwnPropertyDescriptor(target, 'x')).toBeUndefined();
  });

  test('a null descriptor is looked up, passed along and defined again', () => {
    const target = {m: () => 1};
    const original = target.m;
    __decorate(
      [
        (_t: unknown, _k: string, desc: PropertyDescriptor) => ({...desc, value: () => desc.value() + 1}),
        (_t: unknown, _k: string, desc: PropertyDescriptor) => {
          expect(desc.value).toBe(original);
        },
      ],
      target,
      'm',
      null,
    );
    expect(target.m()).toBe(2);
  });

  test('three arguments pass no descriptor', () => {
    const seen: number[] = [];
    __decorate([(...args: unknown[]) => void seen.push(args.length)], {}, 'x');
    expect(seen).toEqual([2]);
  });
});

describe('compileScene with decorators', () => {
  const tsx = {...defaultCompileOptions, language: 'tsx' as const};

  test('the custom component example compiles as TSX', () => {
    const source = example('original.tsx');
    const r = compileScene(source, tsx);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    const js = r.js.split('\n');
    const at = js.findIndex(l => l.includes('__decorate('));
    // The calls sit on the line of the class's closing brace.
    expect(source.split('\n')[r.lineMap[at] - 1]).toBe('}');
    expect(js[at]).toContain('Switch.prototype, "initialState", void 0);');
    expect(js[at]).toContain('Switch.prototype, "accent", void 0);');
    expect(r.js).not.toMatch(/^\s*@/m);
    // Nothing moved: a later statement is still on its own line.
    const toggle = source.split('\n').findIndex(l => l.includes('yield* switchRef().toggle(0.6);'));
    expect(js[toggle]).toContain('switchRef().toggle(0.6)');
  });

  test('the Civet version, with @@ decorators, compiles too', () => {
    const source = example('scene.civet');
    expect(source).toContain('@@signal()');
    const r = compileScene(source);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.ts).toContain('  @signal()');
    const calls = r.js.split('\n').filter(l => l.includes('__decorate('));
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('Switch.prototype, "initialState", void 0);');
    expect(calls[0]).toContain('Switch.prototype, "accent", void 0);');
    // Only the `exports.__classes` line is added.
    expect(r.js.split('\n').length).toBe(r.ts.split('\n').length + 1);
  });

  test('method decorators and a class expression in Civet', () => {
    const r = compileScene(
      lines(
        "import {Node, computed, initial, signal} from '@canvas-commons/2d'",
        "import {SimpleSignal, threadable} from '@canvas-commons/core'",
        'Meter := class extends Node',
        '  @@initial(0) @@signal()',
        '  declare readonly level: SimpleSignal<number, this>',
        '  @@computed()',
        '  doubled()',
        '    @level() * 2',
        '  @@threadable()',
        '  fill(duration: number)',
        '    yield* @level 1, duration',
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.js).toContain('], Meter.prototype, "level", void 0);');
    expect(r.js).toContain('], Meter.prototype, "doubled", null);');
    expect(r.js).toContain('], Meter.prototype, "fill", null);');
  });

  test('a decorator that cannot be lowered is a diagnostic on its line', () => {
    const r = compileScene(lines('class A {', '  ok = 1;', '  @d #secret = 1;', '}'), tsx);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([{stage: 'transform', message: 'Decorators cannot be applied to #private members.', line: 3}]);
  });
});
