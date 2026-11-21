/**
 * Converting a scene between the two source languages.
 *
 * Civet → TSX is exact: it is what the Civet compiler emits, with the Manim
 * sugar made explicit (`yield*`, an import list instead of `from manim import *`).
 * TSX → Civet is best-effort: TSX is almost always valid Civet already, so the
 * converter only makes it more idiomatic and checks that the result compiles.
 */
import './process-shim';
import {compile as civetCompile} from '@danielx/civet';
import {CompileOptions, defaultCompileOptions, expandDialect} from './compile';

export type Language = 'civet' | 'tsx';

export interface Conversion {
  code: string;
  /** False when nothing could be produced and `code` is the input unchanged. */
  ok: boolean;
  /** Things the author should know, e.g. that the result is only a re-labelled copy. */
  notes: string[];
}

const MANIM_STAR = /^[ \t]*(?:\/\/|#)\s*from manim import \*[ \t]*$/m;
const MANIM_IMPORT = /^[ \t]*import\s*(?:\*\s*as\s+\w+|\{[^}]*\})\s*from\s*['"]manim['"];?[ \t]*$/gm;

/** Blank out strings, template literals and comments so regexes only see code. */
function maskCode(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    m => m.replace(/[^\n]/g, ' '),
  );
}

/** Names from `candidates` that the code refers to but does not declare itself. */
export function usedNames(code: string, candidates: readonly string[]): string[] {
  const masked = maskCode(code);
  const declared = new Set<string>();
  for (const m of masked.matchAll(/\b(?:const|let|var|class|function\*?)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  const seen = new Set<string>();
  // An identifier that is not a member access (`.x`) and not an object key (`x:`).
  for (const m of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*:(?!:))/g)) seen.add(m[1]);
  // JSX tags and `a ? b : c` branches look like keys to the pattern above.
  for (const m of masked.matchAll(/<\/?([A-Za-z_$][\w$]*)|[?:]\s*([A-Za-z_$][\w$]*)\s*:/g)) seen.add(m[1] ?? m[2]);
  return candidates.filter(n => seen.has(n) && !declared.has(n) && /^[A-Za-z_$][\w$]*$/.test(n) && !n.startsWith('__'));
}

/**
 * Civet → TSX. `apiNames` are the names `from manim import *` provides, used
 * to write the explicit import list.
 */
export function civetToTsx(
  source: string,
  apiNames: readonly string[],
  options: CompileOptions = defaultCompileOptions,
): Conversion {
  const {code: expanded, prelude} = expandDialect(source, {...options, implicitYield: true});
  let ts: string;
  try {
    ts = (civetCompile(expanded, {sync: true, parseOptions: {coffeeComment: options.hashComments}} as any) as unknown as string);
  } catch (e: any) {
    return {
      code: source,
      ok: false,
      notes: [`The scene has to compile before it can be converted to TSX (${String(e?.message ?? e).split('\n')[0]}).`],
    };
  }
  const notes: string[] = [];
  if (prelude) {
    const names = usedNames(ts, apiNames);
    const line = names.length ? `import {${names.join(', ')}} from 'manim';` : `import 'manim';`;
    ts = MANIM_STAR.test(ts) ? ts.replace(MANIM_STAR, line) : `${line}\n${ts}`;
    notes.push('`from manim import *` became an explicit import list, and each animation call shows its `yield*`.');
  }
  return {code: ts.replace(/[ \t]+$/gm, ''), ok: true, notes};
}

function compilesAsCivet(code: string, options: CompileOptions): boolean {
  try {
    civetCompile(expandDialect(code, options).code, {sync: true, parseOptions: {coffeeComment: options.hashComments}} as any);
    return true;
  } catch {
    return false;
  }
}

/** Light, line-based idiom pass. Only touches code outside strings and comments. */
export function civetIdioms(tsx: string): string {
  const masked = maskCode(tsx).split('\n');
  return tsx
    .split('\n')
    .map((line, i) => {
      const code = masked[i];
      let out = line;
      // Trailing semicolon (only when it is real code, not inside a string/comment).
      const semi = /;[ \t]*$/.exec(code);
      // Drop only the `;` itself: what follows it in `code` may be a masked comment.
      if (semi) out = (out.slice(0, semi.index) + out.slice(semi.index + 1)).replace(/[ \t]+$/, '');
      // `const x = …` → `x := …` for plain names and destructuring patterns.
      // The mask keeps column positions, so offsets found in `code` apply to `out`.
      // (No trailing whitespace in the pattern: a masked string is all spaces.)
      const decl = /^([ \t]*)const\s+([A-Za-z_$][\w$]*|\{[^=]*\}|\[[^=]*\])\s*=(?!=|>)/.exec(code);
      if (decl) out = `${decl[1]}${decl[2]} := ${out.slice(decl[0].length).trimStart()}`;
      return out;
    })
    .join('\n');
}

/**
 * Rewrites TSX that Civet accepts but reads differently. Civet parses
 * `color => x` as the call `color(=> x)`, so single parameters need parentheses.
 */
export function civetCompat(tsx: string): string {
  const masked = maskCode(tsx);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(/(?<![\w$.)\]])([A-Za-z_$][\w$]*)(\s*)=>/g)) {
    if (m[1] === 'async') continue;
    out += `${tsx.slice(last, m.index)}(${m[1]})${m[2]}=>`;
    last = m.index! + m[0].length;
  }
  return out + tsx.slice(last);
}

/** TSX → Civet, best-effort. The result is checked to compile as Civet. */
export function tsxToCivet(source: string, options: CompileOptions = defaultCompileOptions): Conversion {
  const notes: string[] = [];
  const usesManim = MANIM_IMPORT.test(source);
  MANIM_IMPORT.lastIndex = 0;
  let base = civetCompat(source);
  if (usesManim) {
    let first = true;
    base = base.replace(MANIM_IMPORT, () => {
      const line = first ? 'from manim import *' : '';
      first = false;
      return line;
    });
  }
  const explicit: CompileOptions = {...options, implicitYield: false};
  const idiomatic = civetIdioms(base).replace(/(?<![\w$.])this\.(?=[A-Za-z_$])/g, '@');
  if (compilesAsCivet(idiomatic, explicit)) {
    notes.push('Converted to Civet syntax where that is safe (`:=`, no semicolons, `@`). Braces and parentheses were kept; Civet accepts them.');
    return {code: idiomatic, ok: true, notes};
  }
  if (compilesAsCivet(base, explicit)) {
    notes.push('The TSX is valid Civet as it stands, so it was kept unchanged.');
    return {code: base, ok: true, notes};
  }
  return {
    code: source,
    ok: false,
    notes: [
      'This TSX uses syntax Civet does not accept (often a comment inside a JSX tag, or an identifier such as `loop` that is a Civet keyword), so it stays in TSX.',
    ],
  };
}
