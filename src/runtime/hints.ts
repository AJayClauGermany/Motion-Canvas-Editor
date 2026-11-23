/**
 * Scene hints: mistakes that compile (or fail with an unhelpful message) but
 * that an author, often an AI agent fluent in TypeScript or Manim's Python
 * rather than Civet, makes predictably. Each hint names the line and the fix.
 *
 * These are heuristics on the source text, not a type checker: they aim at
 * the handful of mistakes that cost the most time, and say "probably".
 * DOM-free: used by the MCP server (Bun) and the editor page.
 */
import type {Language} from './convert';

export type HintSeverity = 'error' | 'warning' | 'info';

export interface Hint {
  rule: string;
  severity: HintSeverity;
  /** 1-based source line. */
  line?: number;
  message: string;
}

export interface HintOptions {
  language: Language;
  /** Names that `from manim import *` provides. */
  apiNames: readonly string[];
  /** Every Manim-layer member name in both spellings (`knownNames()`), for method checks. */
  memberNames?: ReadonlySet<string>;
  /** Whether the compiler inserts `yield*` before `@play`/`@wait` (Civet only). */
  implicitYield?: boolean;
}

/** Blank strings and comments so patterns only see code. Keeps offsets. */
function mask(source: string, hashComments: boolean): string {
  const hash = hashComments ? String.raw`|(?<![\w$)\]])#\s[^\n]*|^[ \t]*#(?![\w$])[^\n]*` : '';
  const re = new RegExp(
    String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*${hash}|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|` + '`(?:\\\\.|[^`\\\\])*`',
    'gm',
  );
  const masked = source.replace(re, m => m.replace(/[^\n]/g, ' '));
  // JSX text: `<Text>Hello World</Text>` is prose, not names.
  return masked.replace(/(<[A-Za-z][^<>]*>)([^<>{}]+)(?=<\/?[A-Za-z])/g, (_m, tag: string, text: string) => tag + text.replace(/[^\n]/g, ' '));
}

const lineAt = (text: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** JavaScript and DOM globals a scene may use without declaring them. */
const GLOBALS = new Set(
  (
    'Math Array Object Number String Boolean Promise Map Set WeakMap WeakSet JSON Date Error TypeError RangeError ' +
    'Symbol Infinity NaN BigInt RegExp Reflect Proxy Intl Float32Array Float64Array Uint8Array Int32Array ' +
    'Uint8ClampedArray ArrayBuffer DataView Function Generator Iterator console window document globalThis ' +
    'Image Path2D DOMMatrix CanvasRenderingContext2D OffscreenCanvas HTMLCanvasElement HTMLImageElement Record Partial ' +
    'Readonly ReturnType Parameters Exclude Pick Omit Required NonNullable InstanceType Awaited PromiseLike ArrayLike ' +
    'ThreadGenerator ReadonlyArray Iterable IterableIterator TemplateStringsArray'
  ).split(' '),
);

/** Manim names that are known to be missing here, with the reason. */
export const UNSUPPORTED: Record<string, string> = {
  ThreeDScene: 'there is no 3D: z is ignored and the camera cannot rotate',
  ThreeDAxes: 'there is no 3D',
  Surface: 'there is no 3D',
  Sphere: 'there is no 3D',
  Cube: 'there is no 3D',
  Prism: 'there is no 3D',
  Cone: 'there is no 3D',
  Cylinder: 'there is no 3D',
  Torus: 'there is no 3D',
  ZoomedScene: 'zoomed scenes are not implemented (use `self.camera.frame.animate.scale(...)`)',
  SVGMobject: 'SVG import is not implemented',
  ImageMobject: 'images are not implemented (a Canvas Commons `<Img>` node works in a native scene)',
  MarkupText: 'only `Text`, `Paragraph`, `Tex` and `MathTex` exist',
  Table: 'tables are not implemented',
  MathTable: 'tables are not implemented',
  Matrix: 'matrices are not implemented (a `MathTex` with `\\begin{bmatrix}` works)',
  Code: 'code blocks are not implemented (a Canvas Commons `<Code>` node works in a native scene)',
  Union: 'boolean operations are not implemented',
  Intersection: 'boolean operations are not implemented',
  Difference: 'boolean operations are not implemented',
  Exclusion: 'boolean operations are not implemented',
  PolarPlane: 'only `NumberLine`, `Axes` and `NumberPlane` exist',
  ComplexPlane: 'only `NumberLine`, `Axes` and `NumberPlane` exist',
  VectorField: 'vector fields are not implemented',
  ArrowVectorField: 'vector fields are not implemented',
  StreamLines: 'vector fields are not implemented',
  Graph: 'graphs and networks are not implemented',
  DiGraph: 'graphs and networks are not implemented',
  BarChart: 'charts are not implemented',
};

/** Edit distance with transpositions (optimal string alignment), case-insensitive. */
function editDistance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d: number[][] = Array.from({length: a.length + 1}, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Up to three names close to `name`, for "did you mean". */
export function suggestNames(name: string, candidates: Iterable<string>): string[] {
  const scored: [string, number][] = [];
  const lower = name.toLowerCase();
  for (const c of candidates) {
    const cl = c.toLowerCase();
    const d = editDistance(name, c);
    const limit = Math.max(1, Math.floor(name.length / 3));
    if (d <= limit || (lower.length >= 4 && cl.length >= 3 && (cl.includes(lower) || lower.includes(cl)) && Math.abs(cl.length - lower.length) <= 6)) {
      scored.push([c, d]);
    }
  }
  return scored.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).slice(0, 3).map(s => s[0]);
}

/** Names the code declares or imports itself (pass masked code). */
export function declaredNames(code: string): Set<string> {
  const out = new Set<string>();
  const add = (list: string) => {
    for (const m of list.matchAll(/(?:^|[\s,{[(])(?:\.\.\.)?([A-Za-z_$][\w$]*)(?=\s*(?:[,}\]):=]|$))/g)) out.add(m[1]);
  };
  for (const m of code.matchAll(/\b(?:const|let|var|class|function\*?|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([{[][^=]*)=/g)) add(m[1]);
  // Civet: `x := …`, `x .= …`, `[a, b] := …`, `{a} := …`.
  for (const m of code.matchAll(/(?:^|[\s;])([A-Za-z_$][\w$]*)\s*(?::=|\.=)/gm)) out.add(m[1]);
  for (const m of code.matchAll(/([[{][^\n=]*[\]}])\s*(?::=|\.=)/g)) add(m[1]);
  for (const m of code.matchAll(/import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from/g)) {
    if (m[1]) out.add(m[1]);
    if (m[2]) out.add(m[2]);
    if (m[3]) for (const part of m[3].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '');
      if (name) out.add(name);
    }
  }
  // Parameters, for-of variables, catch bindings: anything before `=>`/`->`
  // in parentheses, after `for`, after `catch`.
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?::\s*[^=\n]+)?(?:=>|->)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(?\s*(?:const|let|var)?\s*([^\n;]*?)\s+(?:of|in)\b/g)) add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  // Generic type parameters: `class Foo<T>`, `function f<T, U>`.
  for (const m of code.matchAll(/<([A-Z][\w$]*(?:\s*,\s*[A-Z][\w$]*)*)>\s*\(/g)) add(m[1]);
  return out;
}

export function sceneHints(source: string, options: HintOptions): Hint[] {
  const civet = options.language === 'civet';
  const code = mask(source, civet);
  const hints: Hint[] = [];
  const at = (index: number) => lineAt(code, index);
  const push = (rule: string, severity: HintSeverity, index: number | undefined, message: string) => {
    const line = index === undefined ? undefined : at(index);
    if (hints.some(h => h.rule === rule && h.line === line)) return;
    hints.push({rule, severity, line, message});
  };

  const prelude = /^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m.test(source);
  const manimImport = /from\s*['"]manim['"]/.test(source);
  const usesManim = prelude || manimImport;
  const native = /\bmakeScene2D\b/.test(code);
  const sceneClass = /\bclass\s+\w+\s+extends\s+(?:\w+\.)?\w*Scene\b/.test(code);

  if (!native && !sceneClass) {
    push('no-scene', 'error', undefined, 'No scene found. Manim style: a class that `extends Scene` with a `construct` method. Canvas Commons style: `export default makeScene2D(...)`.');
  }

  // ---- Syntax that compiles to something else ---------------------------
  if (civet) {
    for (const m of code.matchAll(/(?<![\w$.)\]])([A-Za-z_$][\w$]*)(\s*)=>/g)) {
      if (m[1] === 'async') continue;
      push('civet-arrow-call', 'error', m.index, `Civet reads \`${m[1]} => …\` as the call \`${m[1]}(=> …)\`. Write \`(${m[1]}) => …\`.`);
    }
    for (const m of source.matchAll(/(?:^[ \t]+|this\.|@)#[A-Za-z_$][\w$]*/gm)) {
      push('civet-hash-private', 'warning', m.index, '`#` starts a comment in scenes, so `#private` fields are not available. Use a normal field.');
    }
    if (sceneClass && !prelude && /^[ \t]*import\s*\{[^}]*\}\s*from\s*['"]manim['"]/m.test(source)) {
      push('import-list', 'info', source.search(/^[ \t]*import\s*\{[^}]*\}\s*from\s*['"]manim['"]/m), 'In Civet, `from manim import *` imports every Manim name and turns on the Manim sugar (`@play` without `yield*`).');
    }
  } else {
    // Civet syntax in a TSX document.
    const civetOnly: [RegExp, string][] = [
      [/^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*/m, "`from manim import *` is Civet only; in TSX list the names: `import {Scene, Circle, Create} from 'manim';`"],
      [/(?<![\w$.])@(?:play|wait|pause)\b/, '`@play` is Civet; in TSX write `yield* this.play(...)`.'],
      [/[\w$\]})]\s*:=/, '`:=` is Civet; in TSX write `const x = …`.'],
      [/makeScene2D\s+\(\s*\w*\s*\)\s*->/, '`(view) ->` is Civet; in TSX write `makeScene2D(function* (view) { … })`.'],
    ];
    for (const [re, message] of civetOnly) {
      const m = re.exec(code);
      if (m) push('civet-in-tsx', 'error', m.index, `${message} (Or convert the whole scene with the convert tool.)`);
    }
    for (const m of code.matchAll(/^([ \t]*)(?:async\s+)?construct\s*\([^)]*\)\s*\{/gm)) {
      // A static scene's `construct` may be a plain method; one that animates may not.
      const rest = code.slice(m.index! + m[0].length);
      const end = rest.search(new RegExp(`^${m[1]}\\}`, 'm'));
      const body = end < 0 ? rest : rest.slice(0, end);
      if (sceneClass && /\byield\b|\bthis\.(?:play|wait|pause)\s*\(/.test(body)) {
        push('construct-generator', 'error', m.index, '`construct` animates, so it must be a generator in TSX: `*construct() { … }`.');
      }
    }
    for (const m of code.matchAll(/makeScene2D\s*\(\s*(?:async\s*)?\(\s*\w*\s*\)\s*=>/g)) {
      push('scene-generator', 'error', m.index, 'The scene function must be a generator: `makeScene2D(function* (view) { … })`. Arrow functions cannot `yield`.');
    }
  }

  // `this.play(...)` without `yield*` does nothing.
  const explicit = !civet || options.implicitYield === false;
  if (explicit) {
    for (const m of code.matchAll(/(?<!yield\*\s*)(?<!yield\s+)(?<![\w$.])(?:this\.|@)(play|wait|pause)\s*[( ]/g)) {
      const before = code.slice(Math.max(0, m.index! - 2), m.index);
      if (/\.\s*$/.test(before)) continue;
      push('missing-yield', 'error', m.index, `\`${m[0].trim().replace(/[( ]$/, '')}\` does nothing without \`yield*\` in front: \`yield* this.${m[1]}(…)\`.`);
    }
  }
  for (const m of code.matchAll(/\byield(?!\s*\*)\s+(?=[\w$@]+(?:\(\))?\.[\w$.]+\s*\()/g)) {
    push('yield-star', 'warning', m.index, 'A tween or animation needs `yield*`, not `yield`: `yield*` runs it to the end, `yield` only waits one frame.');
  }

  // Python habits.
  for (const m of code.matchAll(/([(,]\s*)([a-z_][\w]*)\s*=(?![=>])/g)) {
    const after = code.slice(m.index! + m[0].length);
    if (/^[^()]*\)\s*(=>|->|\{|:\s*$)/m.test(after)) continue;
    const lineStart = code.lastIndexOf('\n', m.index!) + 1;
    const lineEnd = code.indexOf('\n', m.index!);
    if (/^\s*[A-Za-z_$][\w$]*\s*\([^()]*\)\s*$/.test(code.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))) continue;
    if (/^\s*(?:for|while|if)\s*\(/.test(code.slice(lineStart, m.index! + 1))) continue;
    push('python-kwarg', 'error', m.index! + m[1].length, `\`${m[2]}=…\` inside a call is an assignment in JavaScript. Keyword arguments are \`${m[2]}: …\`${civet ? '' : ' in a trailing object: `f(x, {' + m[2] + ': …})`'}.`);
  }
  for (const m of code.matchAll(/(?<![\w$.])(True|False|None)(?![\w$])/g)) {
    push('python-literal', 'error', m.index, `\`${m[1]}\` is Python. Write \`${m[1] === 'True' ? 'true' : m[1] === 'False' ? 'false' : 'undefined'}\`.`);
  }
  for (const m of code.matchAll(/^[ \t]*def\s+\w+\s*\(/gm)) {
    push('python-def', 'error', m.index, '`def` is Python. A method is `name(args)` with an indented body in Civet, or `name(args) { … }` in TSX (`*name()` if it animates).');
  }
  for (const m of code.matchAll(/(?<![\w$.])lambda\s+[\w, ]*:/g)) {
    push('python-lambda', 'error', m.index, '`lambda x: …` is Python. Write `(x) => …`.');
  }
  if (!civet) {
    for (const m of code.matchAll(/(?<![\w$.])self\.(?=[A-Za-z_$])/g)) {
      push('python-self', 'error', m.index, '`self.` is Python. In TSX write `this.`.');
    }
  }

  // ---- Engine rules ----------------------------------------------------
  for (const m of code.matchAll(/\.points\s*(?:\[[^\]]*\]\s*=(?!=)|\.(?:push|splice|pop|shift|unshift|reverse|sort|fill)\s*\()/g)) {
    push('points-mutation', 'warning', m.index, 'Mobject points are immutable: changing the array in place has no effect on the picture. Assign a new array (`mob.points = [...]`) or use `set_points`.');
  }
  for (const m of code.matchAll(/@motion-canvas\//g)) {
    push('motion-canvas-import', 'info', m.index, '`@motion-canvas/*` imports work (they are aliased), but this editor runs Canvas Commons: prefer `@canvas-commons/*`.');
  }

  // Native tweens that are created but never run.
  if (native) {
    for (const m of code.matchAll(/^[ \t]*(?!yield|return|const|let|var|\w+\s*:=)([\w$]+\(\)(?:\.[\w$]+)+)\s*\(([^()\n]*),\s*[\d.]+\s*(?:,[^()\n]*)?\)\s*;?[ \t]*$/gm)) {
      push('native-tween-unused', 'warning', m.index, `\`${m[1]}(…, duration)\` creates a tween but does not run it. Write \`yield* ${m[1]}(…)\`, or drop the duration to set the value at once.`);
    }
  }

  // ---- Names -------------------------------------------------------------
  const api = new Set(options.apiNames);
  const declared = declaredNames(code);
  const known = (n: string) => api.has(n) || declared.has(n) || GLOBALS.has(n);
  if (usesManim || !native) {
    // Calls, `new`, `extends`, JSX tags and type-free uses of PascalCase names.
    const seen = new Set<string>();
    for (const m of code.matchAll(/(?<![\w$.#@])([A-Z][A-Za-z0-9_$]*)(?=\s*\(|[ \t]+[a-z_$"'`[{(\d-])|(?:\bnew|\bextends)\s+([A-Z][\w$]*)|<([A-Z][\w$]*)[\s/>]/gm)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (!name || seen.has(name) || declared.has(name)) continue;
      // Some of these exist as stubs that fail on use; say why up front.
      if (UNSUPPORTED[name] && usesManim) {
        seen.add(name);
        push('unsupported', 'error', m.index, `\`${name}\` is not available in this Manim layer: ${UNSUPPORTED[name]}.`);
        continue;
      }
      if (known(name)) continue;
      // UPPER_CASE constants are checked below.
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
      seen.add(name);
      if (!usesManim && options.apiNames.length && !native) continue;
      const near = suggestNames(name, options.apiNames.filter(n => /^[A-Z]/.test(n)));
      push('unknown-name', 'warning', m.index, `\`${name}\` is not defined here and is not part of the Manim layer.${near.length ? ` Did you mean ${near.map(n => `\`${n}\``).join(', ')}?` : ''}`);
    }
    for (const m of code.matchAll(/(?<![\w$.#@'"])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{2,}[0-9]*)(?![\w$(])/g)) {
      const name = m[1];
      if (seen.has(name) || known(name)) continue;
      seen.add(name);
      const near = suggestNames(name, options.apiNames.filter(n => /^[A-Z][A-Z0-9_]+$/.test(n)));
      push('unknown-constant', 'warning', m.index, `\`${name}\` is not a constant of the Manim layer.${near.length ? ` Did you mean ${near.map(n => `\`${n}\``).join(', ')}?` : ''}`);
    }
    if (!prelude && !manimImport) {
      for (const m of code.matchAll(/(?<![\w$.#@])([A-Z][\w$]*)(?=\s*\(|\s+[a-z_$"'`[{(\d-])/g)) {
        if (api.has(m[1]) && !declared.has(m[1]) && !GLOBALS.has(m[1])) {
          push('manim-import', 'error', 0, civet ? '`' + m[1] + '` comes from the Manim layer: add `from manim import *` as the first line.' : `\`${m[1]}\` comes from the Manim layer: add \`import {${m[1]}, …} from 'manim';\`.`);
          break;
        }
      }
    }
  }
  // snake_case methods that do not exist on mobjects (Manim APIs not ported).
  if (usesManim && options.memberNames) {
    // The scene's own methods and fields: `name(args)` definitions, `@name =`, `this.name =`.
    const own = new Set<string>();
    for (const m of code.matchAll(/^[ \t]+(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:\{|:[^=\n]*)?[ \t]*$/gm)) own.add(m[1]);
    for (const m of code.matchAll(/(?:@|this\.)([A-Za-z_$][\w$]*)\s*(?:=(?!=)|:=|\.=)/g)) own.add(m[1]);
    for (const m of code.matchAll(/^[ \t]+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=(?!=)/gm)) own.add(m[1]);
    for (const m of code.matchAll(/\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\s*\(|[ \t]+(?!(?:and|or|not|is|in|of|instanceof|then|else|if|unless|for|when)\b)[A-Za-z_$"'`[{\d])/g)) {
      if (options.memberNames.has(m[1]) || declared.has(m[1]) || own.has(m[1])) continue;
      push('unknown-method', 'warning', m.index! + 1, `\`.${m[1]}()\` is not a method of the Manim layer here (it may exist in Manim but not be ported). Check it with the API lookup.`);
    }
  }

  // Manim style: mobjects made outside `construct` break seeking.
  if (usesManim) {
    const mobjectish = new Set(options.apiNames.filter(n => /^[A-Z][a-z]/.test(n)));
    for (const m of code.matchAll(/^(?:export\s+)?(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*(?::=|=)\s*(?:new\s+)?([A-Z][\w$]*)\s*[( ]/gm)) {
      if (mobjectish.has(m[2]) && !/Scene$|Tracker$|^Color|^Manim/.test(m[2])) {
        push('module-mobject', 'warning', m.index, `\`${m[1]}\` is created at module level. Create mobjects inside \`construct\`: the scene re-runs from the start on every seek, and a shared mobject keeps the state of the last run.`);
      }
    }
  }

  const order: Record<HintSeverity, number> = {error: 0, warning: 1, info: 2};
  return hints.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0));
}
