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

export interface CompileOptions {
  /** Insert `yield*` before `@play` / `@wait`, so scenes read like Manim. */
  implicitYield: boolean;
  /** Rewrite `+ - * /` so vectors support `2 * UP + LEFT`. */
  operators: boolean;
  /** Python-style `# comments` (Civet's `coffeeComment`). */
  hashComments: boolean;
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
      if (isNumeric(node.right)) return;
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

  const {code: expanded, prelude} = expandDialect(source, options);
  result.expanded = expanded;
  result.prelude = prelude;

  let ts: string;
  try {
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
    result.diagnostics.push({
      stage: 'civet',
      message: String(e?.message ?? e).split('\nExpected:')[0].replace(/^unknown:\d+:\d+\s*/, ''),
      line: typeof e?.line === 'number' ? e.line : undefined,
      column: typeof e?.column === 'number' ? e.column : undefined,
    });
    return result;
  }
  result.ts = ts;
  result.classNames = topLevelClasses(ts);

  try {
    let js = transform(ts, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'automatic',
      jsxImportSource: '@canvas-commons/2d',
      production: true,
    }).code;
    if (options.operators) js = overloadOperators(js);
    if (result.classNames.length) {
      js += `\n;exports.__classes = {${result.classNames.join(', ')}};`;
    }
    result.js = js;
    result.ok = true;
  } catch (e: any) {
    const jsLine = e?.loc?.line;
    result.diagnostics.push({
      stage: 'transform',
      message: String(e?.message ?? e),
      line: jsLine ? result.lineMap[jsLine - 1] : undefined,
    });
  }
  return result;
}
