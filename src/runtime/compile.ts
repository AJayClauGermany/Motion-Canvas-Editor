/**
 * Scene compiler: Civet source → JavaScript that can be evaluated in the page.
 *
 *   Civet ──(dialect pre-pass)──▶ Civet ──▶ TSX ──(sucrase)──▶ CommonJS
 *         ──(operator overloading, optional)──▶ runnable module body
 *
 * Every stage keeps line numbers stable, so a runtime line maps back to the
 * user's source through Civet's source map alone.
 */
import './process-shim';
import {compile as civetCompile} from '@danielx/civet';
import {parse} from 'acorn';
import MagicString from 'magic-string';
import {transform} from 'sucrase';
import {lowerDecorators} from './decorators';

export interface CompileOptions {
  /** Insert `yield*` before `@play` / `@wait`, so scenes read like Manim. */
  implicitYield: boolean;
  /** Rewrite `+ - * /` so vectors support `2 * UP + LEFT`. */
  operators: boolean;
  /** Python-style `# comments` (Civet's `coffeeComment`). */
  hashComments: boolean;
  /**
   * Source language. `tsx` skips Civet and the dialect pre-pass entirely, so
   * a Motion Canvas / Canvas Commons scene runs exactly as written.
   */
  language?: 'civet' | 'tsx';
}

export interface Diagnostic {
  message: string;
  /** 1-based line in the user's source. */
  line?: number;
  column?: number;
  stage: 'civet' | 'transform' | 'runtime';
}

export interface CompileResult {
  ok: boolean;
  /** Module body ready for `evaluate`. */
  js: string;
  /** Civet's TypeScript output, shown in the "Compiled" tab. */
  ts: string;
  /** Source after the dialect pre-pass. */
  expanded: string;
  /** `lineMap[jsLine - 1]` is the 1-based source line. */
  lineMap: number[];
  /** Whether `from manim import *` was present. */
  prelude: boolean;
  /** Names of top-level classes (scene candidates). */
  classNames: string[];
  diagnostics: Diagnostic[];
}

export const defaultCompileOptions: CompileOptions = {
  implicitYield: true,
  operators: true,
  hashComments: true,
};

const PRELUDE_RE = /^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*[ \t]*$/m;
const SCENE_CALLS = ['play', 'wait', 'pause'];

/** Apply the Manim-flavoured conveniences. Never changes the line count. */
export function expandDialect(source: string, options: CompileOptions): {code: string; prelude: boolean} {
  let prelude = false;
  let code = source.replace(PRELUDE_RE, () => {
    prelude = true;
    return '// from manim import *';
  });

  // Python habits: `self.play(...)` and `construct(self)`.
  code = code
    .replace(/\(\s*self\s*\)/g, '()')
    .replace(/\(\s*self\s*,\s*/g, '(')
    .replace(/(?<![\w.$@])self\./g, '@');

  if (options.implicitYield) {
    const lines = code.split('\n');
    const generatorMethods = new Set<string>(SCENE_CALLS);
    const addYield = () => {
      const names = [...generatorMethods].join('|');
      const call = new RegExp(`(?<![\\w.$@])(?<!yield\\*\\s*)(?<!yield\\s+)(@|this\\.)(${names})\\b(?!\\s*[:=(]\\s*(->|=>|\\(.*\\)\\s*(->|=>)))`, 'g');
      const def = new RegExp(`^\\s*(${names})\\s*(\\(.*\\))?\\s*(:\\s*\\S+\\s*)?$`);
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (def.test(lines[i]) || /^\s*(\/\/|#\s)/.test(lines[i])) continue;
        const next = lines[i].replace(call, (_m, obj, name) => `yield* ${obj}${name}`);
        if (next !== lines[i]) {
          lines[i] = next;
          changed = true;
        }
      }
      return changed;
    };
    addYield();
    // Helper methods that animate become generators too; calls to them need
    // `yield*` as well. Iterate until no new generator methods appear.
    for (let pass = 0; pass < 6; pass++) {
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        const m = /^(\s+)([A-Za-z_$][\w$]*)\s*(\([^)]*\))?\s*$/.exec(lines[i]);
        if (!m || generatorMethods.has(m[2]) || m[2] === 'construct') continue;
        if (/^(if|else|for|while|loop|try|catch|finally|switch|when|do|return|break|continue|unless|until)$/.test(m[2])) continue;
        const indent = m[1].length;
        let hasYield = false;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '') continue;
          const ind = /^\s*/.exec(lines[j])![0].length;
          if (ind <= indent) break;
          if (/\byield\b/.test(lines[j])) {
            hasYield = true;
            break;
          }
        }
        if (hasYield) {
          generatorMethods.add(m[2]);
          found = true;
        }
      }
      if (!found) break;
      addYield();
    }
    code = lines.join('\n');
  }
  return {code, prelude};
}

/** Rewrite arithmetic so `__op` can dispatch on vectors. Keeps lines intact. */
export function overloadOperators(js: string): string {
  const ast = parse(js, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    preserveParens: true,
    allowReturnOutsideFunction: true,
  }) as any;
  const s = new MagicString(js);
  const binary: Record<string, string> = {'+': 'add', '-': 'sub', '*': 'mul', '/': 'div'};
  const assign: Record<string, string> = {'+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div'};
  const isNumeric = (n: any): boolean =>
    n.type === 'Literal' && typeof n.value === 'number'
      ? true
      : n.type === 'ParenthesizedExpression'
        ? isNumeric(n.expression)
        : n.type === 'UnaryExpression' && n.operator === '-'
          ? isNumeric(n.argument)
          : n.type === 'BinaryExpression' && n.operator in binary
            ? isNumeric(n.left) && isNumeric(n.right)
            : false;
  const isStringy = (n: any): boolean =>
    (n.type === 'Literal' && typeof n.value === 'string') || n.type === 'TemplateLiteral';

  const visit = (node: any) => {
    if (!node || typeof node.type !== 'string') return;
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
    if (node.type === 'BinaryExpression' && node.operator in binary) {
      if (node.left.type === 'PrivateIdentifier') return;
      // Pure number maths and string concatenation keep native semantics.
      if (isNumeric(node.left) && isNumeric(node.right)) return;
      if (node.operator === '+' && (isStringy(node.left) || isStringy(node.right))) return;
      const between = js.slice(node.left.end, node.right.start);
      const at = node.left.end + between.indexOf(node.operator);
      s.prependLeft(node.start, `__op.${binary[node.operator]}(`);
      s.overwrite(at, at + node.operator.length, ',');
      s.appendRight(node.end, ')');
    } else if (node.type === 'UnaryExpression' && node.operator === '-' && !isNumeric(node.argument)) {
      s.overwrite(node.start, node.start + 1, '__op.neg(');
      s.appendRight(node.end, ')');
    } else if (node.type === 'AssignmentExpression' && node.operator in assign) {
      if (node.left.type !== 'Identifier' && node.left.type !== 'MemberExpression') return;
      // A numeric right-hand side still needs dispatch: in `v *= 2` the left
      // side may be a vector.
      const target = js.slice(node.left.start, node.left.end);
      const between = js.slice(node.left.end, node.right.start);
      const at = node.left.end + between.indexOf(node.operator);
      s.overwrite(at, at + node.operator.length, `= __op.${assign[node.operator]}(${target},`);
      s.appendRight(node.end, ')');
    }
  };
  visit(ast);
  return s.toString();
}

function topLevelClasses(ts: string): string[] {
  const names: string[] = [];
  for (const m of ts.matchAll(/^(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(m[1]);
  }
  return names;
}

const STEP_SKIP = new Set(['play', 'wait', 'pause']);

/**
 * Sucrase calls imported functions as `_mod.fn.call(void 0, ...args)`.
 * Returns the real callee and arguments of a call either way.
 */
function unwrapCall(node: any): {callee: any; args: any[]} {
  const callee = node.callee;
  const viaCall =
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.name === 'call' &&
    node.arguments[0]?.type === 'UnaryExpression' &&
    node.arguments[0].operator === 'void';
  return viaCall ? {callee: callee.object, args: node.arguments.slice(1)} : {callee, args: node.arguments};
}

/** A short name for what a `yield*` statement runs: `all`, `position.x`, `waitFor`. */
function describeCall(node: any): string {
  let n = node;
  if (n.type === 'CallExpression') n = unwrapCall(n).callee;
  const parts: string[] = [];
  while (n) {
    if (n.type === 'MemberExpression') {
      if (!n.computed && n.property.type === 'Identifier') parts.unshift(n.property.name);
      n = n.object;
    } else if (n.type === 'CallExpression') {
      // `ref().opacity(...)`: the ref call itself says nothing.
      if (n.callee.type === 'Identifier' || n.callee.type === 'ThisExpression') break;
      n = n.callee;
    } else if (n.type === 'Identifier') {
      if (parts.length === 0) parts.unshift(n.name);
      break;
    } else break;
  }
  return parts.slice(-2).join('.') || 'step';
}

/**
 * Record a timeline step for every `yield*` statement of a scene, so native
 * Canvas Commons scenes get the same step-by-step timeline as `play` calls.
 *
 * `yield* X` becomes `yield* __step(line, kind, name, X)` in the generator
 * passed to `makeScene2D` and in generator methods of classes (where calls on
 * `this`, such as `this.play`, already record themselves). Keeps lines intact.
 */
export function instrumentSteps(js: string, lineMap: number[]): string {
  let ast: any;
  try {
    ast = parse(js, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch {
    return js;
  }
  const s = new MagicString(js);
  let touched = false;

  const instrumentBody = (fn: any, isMethod: boolean) => {
    const visit = (node: any) => {
      if (!node || typeof node.type !== 'string') return;
      // Nested functions are their own timeline-less helpers.
      if (/Function(Expression|Declaration)$/.test(node.type) || node.type === 'ArrowFunctionExpression' || node.type === 'ClassBody') return;
      if (node.type === 'ExpressionStatement' && node.expression.type === 'YieldExpression' && node.expression.delegate) {
        const arg = node.expression.argument;
        const onThis =
          arg.type === 'CallExpression' &&
          arg.callee.type === 'MemberExpression' &&
          arg.callee.object.type === 'ThisExpression';
        if (!(isMethod && onThis)) {
          const name = describeCall(arg);
          const kind = /^(waitFor|waitUntil|delay)$/.test(name) ? 'wait' : 'play';
          const line = lineMap[node.loc.start.line - 1] ?? node.loc.start.line;
          s.prependLeft(arg.start, `__step(${line},${JSON.stringify(kind)},${JSON.stringify(name)},`);
          s.appendRight(arg.end, ')');
          touched = true;
        }
        return;
      }
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child.type === 'string') visit(child);
      }
    };
    fn.body.body.forEach(visit);
  };

  const walk = (node: any) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const {callee, args} = unwrapCall(node);
      const name =
        callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : '';
      const fn = args[0];
      if (name === 'makeScene2D' && fn?.type === 'FunctionExpression' && fn.generator) {
        instrumentBody(fn, false);
        s.appendRight(fn.body.start + 1, '__stepsBegin();');
        s.appendLeft(fn.body.end - 1, ';__stepsDone();');
        touched = true;
      }
    } else if (node.type === 'MethodDefinition' && node.value.generator && !STEP_SKIP.has(node.key?.name)) {
      instrumentBody(node.value, true);
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child.type === 'string') walk(child);
    }
  };
  walk(ast);
  return touched ? s.toString() : js;
}

export function compileScene(source: string, options: CompileOptions = defaultCompileOptions): CompileResult {
  const result: CompileResult = {
    ok: false,
    js: '',
    ts: '',
    expanded: source,
    lineMap: [],
    prelude: false,
    classNames: [],
    diagnostics: [],
  };

  const tsxMode = options.language === 'tsx';
  const {code: expanded, prelude} = tsxMode ? {code: source, prelude: false} : expandDialect(source, options);
  result.expanded = expanded;
  result.prelude = prelude;

  let ts: string;
  if (tsxMode) {
    ts = source;
    result.lineMap = source.split('\n').map((_line, i) => i + 1);
  } else try {
    const out = civetCompile(expanded, {
      sync: true,
      sourceMap: true,
      parseOptions: {coffeeComment: options.hashComments},
    } as any) as any;
    ts = out.code;
    const lines: number[][][] = out.sourceMap.lines;
    let last = 1;
    result.lineMap = lines.map(segments => {
      const seg = segments.find(s => s.length >= 4);
      if (seg) last = seg[2] + 1;
      return last;
    });
  } catch (e: any) {
    const raw = String(e?.message ?? e);
    // Civet 0.11 throws an internal error (not a ParseError) for a multi-line
    // call that mixes positional arguments with bare `key: value` lines.
    const internal = /hoistDec/.test(raw);
    result.diagnostics.push({
      stage: 'civet',
      message: internal
        ? 'Civet could not compile a multi-line call that mixes positional arguments with `key: value` lines ending in commas. Wrap the keyword arguments in { }, or drop the trailing commas.'
        : raw.split('\nExpected:')[0].replace(/^unknown:\d+:\d+\s*/, ''),
      line: !internal && typeof e?.line === 'number' ? e.line : undefined,
      column: !internal && typeof e?.column === 'number' ? e.column : undefined,
    });
    return result;
  }
  result.ts = ts;
  result.classNames = topLevelClasses(ts);

  try {
    let js = transform(lowerDecorators(ts), {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'automatic',
      jsxImportSource: '@canvas-commons/2d',
      production: true,
    }).code;
    js = instrumentSteps(js, result.lineMap);
    // Plain TSX keeps plain JavaScript arithmetic; a TSX scene that imports the
    // Manim layer gets vector arithmetic, as its Civet counterpart does.
    if (options.operators && (!tsxMode || /from\s*['"]manim['"]/.test(ts))) js = overloadOperators(js);
    if (result.classNames.length) {
      js += `\n;exports.__classes = {${result.classNames.join(', ')}};`;
    }
    result.js = js;
    result.ok = true;
  } catch (e: any) {
    const jsLine = e?.loc?.line;
    const sourceLine = jsLine ? result.lineMap[jsLine - 1] : undefined;
    result.diagnostics.push({
      stage: 'transform',
      message: String(e?.message ?? e),
      line: sourceLine,
    });
  }
  return result;
}
