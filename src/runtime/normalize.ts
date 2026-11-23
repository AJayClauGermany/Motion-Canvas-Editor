/**
 * Turning scene code from an outside author (an AI agent, a paste) into the
 * language a document is edited in.
 *
 * Agents write TypeScript far more fluently than Civet, often write Manim's
 * Python, and frequently mix the two: TSX statements inside an indented Civet
 * class, `self.play` in TSX, `run_time=2` keyword arguments. Civet is close to
 * a TypeScript superset, so most of that already compiles, but a few TSX
 * spellings compile to something else without an error (see `civetCompat`).
 * `normalizeSource` detects what it was given, converts it, and reports what
 * it did, so the caller can tell the author.
 *
 * DOM-free: used by the MCP server (Bun) and by the editor page.
 */
import './process-shim';
import {compile as civetCompile} from '@danielx/civet';
import {parse} from 'acorn';
import {transform} from 'sucrase';
import {CompileOptions, defaultCompileOptions, expandDialect} from './compile';
import {civetCompat, civetToTsx, Language, tsxToCivet} from './convert';
import {lowerDecorators} from './decorators';
import {declaredNames} from './hints';
import {pythonToCivet} from './python';

export type InputLanguage = Language | 'python';

export interface Detection {
  language: InputLanguage;
  /** The other language's markers that were also found (mixed input). */
  mixed: boolean;
  /** Why, in a few words each: shown to the author. */
  evidence: string[];
}

/** Blank strings and comments (both `//` and `#`) so patterns only see code. */
function maskCode(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?<![\w$)\]])#\s[^\n]*|^[ \t]*#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/gm,
    m => m.replace(/[^\n]/g, ' '),
  );
}

interface Marker {
  re: RegExp;
  weight: number;
  label: string;
}

const PYTHON: Marker[] = [
  {re: /^[ \t]*def\s+\w+\s*\([^)]*\)\s*(->\s*[^:]+)?:[ \t]*$/m, weight: 4, label: '`def name(...):`'},
  {re: /^[ \t]*class\s+\w+\s*\(\s*[\w.]*\s*\)\s*:[ \t]*$/m, weight: 4, label: '`class Name(Base):`'},
  {re: /\bself\.play\s*\(/, weight: 1, label: '`self.play(...)`'},
  {re: /^[ \t]*(?:import\s+numpy|from\s+\w+\s+import\s+\w)/m, weight: 2, label: 'Python import'},
  {re: /\blambda\s+[\w, ]*:/, weight: 2, label: '`lambda x:`'},
  {re: /^[ \t]*(?:for|if|elif|while|with)\b[^\n{]*:[ \t]*$/m, weight: 2, label: 'block statement ending in `:`'},
  {re: /\b(?:True|False|None)\b/, weight: 1, label: '`True`/`False`/`None`'},
];

const TSX: Marker[] = [
  {re: /;[ \t]*$/m, weight: 1, label: 'semicolons'},
  {re: /\bfunction\s*\*/, weight: 3, label: '`function*`'},
  {re: /^[ \t]*\*\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/m, weight: 3, label: 'generator method `*name() {`'},
  {re: /^[ \t]*(?:export\s+)?(?:default\s+)?class\s+\w+[^\n]*\{[ \t]*$/m, weight: 2, label: 'class body in braces'},
  {re: /^[ \t]*(?:const|let)\s+[\w${}[\], ]+=(?!=)/m, weight: 1, label: '`const x = …`'},
  {re: /^[ \t]*import\s*\{[^}]*\}\s*from\s*['"]manim['"]/m, weight: 3, label: "`import {...} from 'manim'`"},
  {re: /\byield\*\s*this\./, weight: 2, label: '`yield* this.…`'},
];

const CIVET: Marker[] = [
  {re: /[\w$\]})]\s*:=/, weight: 2, label: '`:=` declarations'},
  {re: /\.=/, weight: 1, label: '`.=` declarations'},
  {re: /(?<![\w$.])@[A-Za-z_$]/, weight: 2, label: '`@` for `this`'},
  {re: /\)\s*->|^\s*[\w$]+\s*\([^)]*\)\s*$/m, weight: 1, label: 'indented method or `->` function'},
  {re: /^[ \t]*(?:export\s+)?class\s+\w+(?:\s+extends\s+[\w.]+)?[ \t]*$/m, weight: 3, label: 'class without braces'},
  {re: /makeScene2D\s+\(/, weight: 3, label: '`makeScene2D (view) ->`'},
  {re: /\[\s*[\w.]+\s*\.\.\.?\s*[\w.]+\s*\]/, weight: 1, label: 'range literal `[a...b]`'},
];

const score = (code: string, markers: Marker[]) => {
  let total = 0;
  const labels: string[] = [];
  for (const m of markers) {
    if (m.re.test(code)) {
      total += m.weight;
      labels.push(m.label);
    }
  }
  return {total, labels};
};

/** Guess the language of scene code. Ties go to Civet, which accepts most TSX. */
export function detectLanguage(code: string): Detection {
  const masked = maskCode(code);
  const py = score(masked, PYTHON);
  const tsx = score(masked, TSX);
  const civet = score(masked, CIVET);
  // Python needs a `def` or `class X(Base):`, so Civet's own `#` comments and
  // `from manim import *` (shared by both) do not count.
  if (py.total >= 4 && py.total > tsx.total && py.total >= civet.total) {
    return {language: 'python', mixed: false, evidence: py.labels};
  }
  if (tsx.total > civet.total) return {language: 'tsx', mixed: civet.total > 0, evidence: tsx.labels};
  return {language: 'civet', mixed: tsx.total > 0, evidence: civet.labels.length ? civet.labels : ['no TSX markers']};
}

export interface Normalized {
  ok: boolean;
  /** The code in the target language (the input unchanged when `ok` is false). */
  code: string;
  from: InputLanguage;
  to: Language;
  /** Whether `code` differs from the input. */
  changed: boolean;
  /** What was done and why, for the author. */
  notes: string[];
  /** Why it failed, when `ok` is false. */
  error?: string;
}

export interface NormalizeOptions {
  /** Language of the input, when known. Default: detect. */
  from?: InputLanguage | 'auto';
  /** Names that `from manim import *` provides, for TSX import lists. */
  apiNames: readonly string[];
  compile?: CompileOptions;
}

/** First Civet error message, or null when the code compiles as Civet. */
export function civetError(code: string, options: CompileOptions = defaultCompileOptions): string | null {
  try {
    civetCompile(expandDialect(code, options).code, {sync: true, parseOptions: {coffeeComment: options.hashComments}} as any);
    return null;
  } catch (e: any) {
    const line = typeof e?.line === 'number' ? ` (line ${e.line})` : '';
    return String(e?.message ?? e).split('\n')[0].replace(/^unknown:\d+:\d+\s*/, '') + line;
  }
}

/** First TSX error message, or null when the code is valid TypeScript + JSX. */
export function tsxError(code: string): string | null {
  try {
    // Decorators are lowered first, as `compileScene` does: sucrase cannot compile them.
    const js = transform(lowerDecorators(code), {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'automatic',
      jsxImportSource: '@canvas-commons/2d',
      production: true,
    }).code;
    parse(js, {ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true});
    return null;
  } catch (e: any) {
    return String(e?.message ?? e).split('\n')[0];
  }
}

const ARROW_NOTE = 'Wrapped single arrow-function parameters in parentheses: Civet reads `x => y` as the call `x(=> y)`.';

/** Python habits that compile in Civet/TSX but mean something else. */
function fixPythonisms(code: string, notes: string[]): string {
  const masked = maskCode(code);
  let out = '';
  let last = 0;
  let count = 0;
  // `Circle(radius=2)` → `Circle(radius: 2)`: inside a call's parentheses an
  // `name=value` is an assignment in JS, never a keyword argument.
  for (const m of masked.matchAll(/([(,]\s*)([a-z_][\w]*)\s*=(?![=>])\s*/g)) {
    // Skip parameter defaults: `(x = 1) =>`, `foo(a = 1) {`, and a Civet
    // method definition, which is a bare `name(params)` line.
    const after = masked.slice(m.index! + m[0].length);
    if (/^[^()]*\)\s*(=>|->|\{|:\s*$)/m.test(after)) continue;
    const lineStart = masked.lastIndexOf('\n', m.index!) + 1;
    const lineEnd = masked.indexOf('\n', m.index!);
    const line = masked.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (/^\s*[A-Za-z_$][\w$]*\s*\([^()]*\)\s*$/.test(line)) continue;
    const start = m.index! + m[1].length;
    out += code.slice(last, start) + `${m[2]}: `;
    last = m.index! + m[0].length;
    count++;
  }
  let result = code;
  if (count) {
    notes.push(`Rewrote ${count} Python-style keyword argument${count === 1 ? '' : 's'} \`name=value\` as \`name: value\` (in JS, \`name=value\` inside a call is an assignment).`);
    result = out + code.slice(last);
  }
  // `f(*xs)` → `f(...xs)`: right after `(` or `,` a `*` cannot be a multiplication.
  const maskedResult = maskCode(result);
  let splats = 0;
  let spread = '';
  let at = 0;
  for (const m of maskedResult.matchAll(/([(,[]\s*)\*(?=[A-Za-z_$([])/g)) {
    const star = m.index! + m[1].length;
    spread += result.slice(at, star) + '...';
    at = star + 1;
    splats++;
  }
  if (splats) {
    notes.push(`Rewrote ${splats} Python unpacking \`*xs\` as the spread \`...xs\`.`);
    result = spread + result.slice(at);
  }
  return result;
}

/** Whether `index` lies between a JSX tag's `<Name` and its closing `>`. */
function insideJsxTag(masked: string, index: number): boolean {
  const before = masked.slice(0, index).replace(/=>|>=|<=/g, '  ');
  const open = before.search(/<[A-Za-z][\w.]*(?=[\s/>])[^<>]*$/);
  return open >= 0 && !/>/.test(before.slice(open));
}

const CLASS_LINE = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/;

/**
 * Python declares a variable by assigning it; JavaScript does not, and the
 * scene then throws "x is not defined". Declare the first statement-level
 * assignment to a name that is declared nowhere: `x := …` in Civet (`.=` when
 * it is reassigned later), `let x = …` in TSX.
 */
export function declareAssignments(code: string, language: Language, notes: string[]): string {
  const masked = maskCode(code);
  const declared = declaredNames(masked);
  const lines = code.split('\n');
  const maskedLines = masked.split('\n');
  const assigned = new Map<string, number[]>();
  maskedLines.forEach((line, i) => {
    const m = /^(\s*)([A-Za-z_$][\w$]*)\s*=(?![=>])/.exec(line);
    if (!m || declared.has(m[2]) || /^(this|self|exports|module|window|globalThis)$/.test(m[2])) return;
    // `x={1}` / `fill="red"` on its own line: an attribute of a multi-line JSX tag.
    if (/^\s*[\w$]+=["'{]/.test(code.split('\n')[i])) return;
    if (insideJsxTag(masked, maskedLines.slice(0, i).join('\n').length)) return;
    // A direct member of a class body is a field declaration, not an assignment.
    const indent = m[1].length;
    for (let j = i - 1; j >= 0; j--) {
      if (!maskedLines[j].trim()) continue;
      const ind = /^\s*/.exec(maskedLines[j])![0].length;
      if (ind < indent) {
        if (CLASS_LINE.test(maskedLines[j])) return;
        break;
      }
    }
    assigned.set(m[2], [...(assigned.get(m[2]) ?? []), i]);
  });
  if (!assigned.size) return code;
  for (const [name, at] of assigned) {
    const i = at[0];
    lines[i] =
      language === 'civet'
        ? lines[i].replace(new RegExp(`^(\\s*)${name.replace(/\$/g, '\\$')}\\s*=`), `$1${name} ${at.length > 1 ? '.=' : ':='}`)
        : lines[i].replace(new RegExp(`^(\\s*)${name.replace(/\$/g, '\\$')}\\s*=`), `$1let ${name} =`);
  }
  notes.push(`Declared ${[...assigned.keys()].map(n => `\`${n}\``).join(', ')}: a first assignment does not declare a variable in JavaScript.`);
  return lines.join('\n');
}

/**
 * Convert scene code to `to`. Python goes through the Python converter; TSX
 * and mixed input go through Civet, which normalises both.
 */
export function normalizeSource(code: string, to: Language, options: NormalizeOptions): Normalized {
  const compile = options.compile ?? defaultCompileOptions;
  const detected = !options.from || options.from === 'auto' ? detectLanguage(code) : null;
  const from: InputLanguage = detected?.language ?? (options.from as InputLanguage);
  const notes: string[] = [];
  if (detected?.mixed) notes.push(`The code mixes ${from === 'tsx' ? 'Civet' : 'TSX'} syntax into ${from === 'tsx' ? 'TSX' : 'Civet'}; it was normalised.`);
  const result = (ok: boolean, out: string, error?: string): Normalized => ({
    ok,
    code: ok ? out : code,
    from,
    to,
    changed: ok && out !== code,
    notes,
    error,
  });

  let civet: string | null = null;
  if (from === 'python') {
    const converted = pythonToCivet(code);
    notes.push('Converted from Manim Python with the Python → Civet converter.', ...converted.notes);
    civet = converted.code;
  }
  // Python's own `name=value` keyword arguments are handled by its converter.
  const fixed = civet ?? declareAssignments(fixPythonisms(code, notes), from === 'tsx' ? 'tsx' : 'civet', notes);

  if (to === 'civet') {
    if (civet === null) {
      if (from === 'tsx') {
        const converted = tsxToCivet(fixed, {...compile, implicitYield: false});
        if (converted.ok) {
          notes.push(...converted.notes);
          return result(true, converted.code);
        }
        // Fall through: keep the text if it compiles as Civet as it stands.
      }
      civet = civetCompat(fixed);
      if (civet !== fixed) notes.push(ARROW_NOTE);
    }
    const error = civetError(civet, compile);
    if (error) return result(false, civet, `Does not compile as Civet: ${error}`);
    return result(true, civet);
  }

  // to === 'tsx'
  if (civet === null && from === 'tsx' && !/^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(code) && !tsxError(fixed)) {
    const bareCalls = /\bthis\.(play|wait|pause)\s*\(/.test(maskCode(fixed).replace(/yield\*\s*this\./g, ''));
    if (!bareCalls) return result(true, fixed);
    // Valid TSX, but `this.play(...)` without `yield*` does nothing; the
    // Civet dialect pass below inserts it.
    notes.push('Added the missing `yield*` before `this.play` / `this.wait` calls.');
  }
  // Civet (or mixed, or Python converted to Civet): compile it; Civet's
  // output is TSX with the Manim sugar made explicit.
  const source = civetCompat(fixed);
  if (source !== fixed) notes.push(ARROW_NOTE);
  const converted = civetToTsx(source, options.apiNames, compile);
  if (!converted.ok) return result(false, source, converted.notes[0]);
  notes.push(...converted.notes);
  if (from !== 'python' && from !== 'tsx') notes.push('Converted from Civet to TSX (exact: this is the Civet compiler’s output).');
  return result(true, converted.code);
}

/**
 * Repair a fragment of a document (the replacement text of an edit) without
 * compiling it: Python keyword arguments, Civet's single-parameter arrows,
 * and a missing `yield*` where the compiler does not insert one.
 */
export function repairSnippet(code: string, language: Language, explicitYield: boolean): {code: string; notes: string[]} {
  const notes: string[] = [];
  let out = fixPythonisms(code, notes);
  if (language === 'civet') {
    const fixed = civetCompat(out);
    if (fixed !== out) notes.push(ARROW_NOTE);
    out = fixed;
  }
  if (explicitYield) {
    const fixed = out.replace(/^([ \t]*)((?:this\.|@)(?:play|wait|pause)\b)/gm, '$1yield* $2');
    if (fixed !== out) notes.push('Added the missing `yield*` before `play`/`wait` calls.');
    out = fixed;
  }
  return {code: out, notes};
}
