/**
 * Best-effort Manim (Python) → Civet converter, for pasting existing scenes.
 *
 * It is a syntax translator, not a Python implementation: it rewrites the
 * constructs Manim scenes actually use (classes, `def`, keyword arguments,
 * lambdas, comprehensions, tuples, slices, f-strings) and leaves anything it
 * does not understand in place, so the result may need a few manual fixes.
 * Lines it had to give up on are returned in `notes`.
 */

export interface PythonConversion {
  code: string;
  notes: string[];
}

const OPEN = '';
const CLOSE = '';

interface Masked {
  text: string;
  table: string[];
}

/** Replace strings and comments by placeholders so regexes only see code. */
function mask(source: string): Masked {
  const table: string[] = [];
  let out = '';
  let i = 0;
  const n = source.length;
  const push = (literal: string) => {
    table.push(literal);
    out += `${OPEN}${table.length - 1}${CLOSE}`;
  };
  while (i < n) {
    const c = source[i];
    if (c === '#') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      push(source.slice(i, j));
      i = j;
      continue;
    }
    const prefix = /^[rRfFbBuU]{0,2}(?=["'])/.exec(source.slice(i, i + 3))?.[0] ?? '';
    const q = source[i + prefix.length];
    const prevIsWord = i > 0 && /[\w$]/.test(source[i - 1]);
    if ((q === '"' || q === "'") && !(prefix && prevIsWord)) {
      const start = i;
      let j = i + prefix.length;
      const triple = source.startsWith(q.repeat(3), j);
      const delim = triple ? q.repeat(3) : q;
      j += delim.length;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source.startsWith(delim, j)) {
          j += delim.length;
          break;
        }
        if (!triple && source[j] === '\n') break;
        j++;
      }
      push(source.slice(start, j));
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return {text: out, table};
}

function convertString(literal: string): string {
  if (literal.startsWith('#')) return literal;
  const m = /^([rRfFbBuU]{0,2})("""|'''|"|')([\s\S]*)\2$/.exec(literal);
  if (!m) return literal;
  const prefix = m[1].toLowerCase();
  const quote = m[2];
  let body = m[3];
  const raw = prefix.includes('r');
  if (prefix.includes('f')) {
    if (raw) body = body.replace(/\\/g, '\\\\');
    body = body
      .replace(/`/g, '\\`')
      .replace(/\{\{/g, '')
      .replace(/\}\}/g, '')
      .replace(/\{([^{}]+?)(?:!r)?(?::([^{}]*))?\}/g, (_m, expr: string, spec?: string) => {
        const e = convertExpression(expr.trim());
        const fixed = spec && /^\.(\d+)f$/.exec(spec);
        return fixed ? `\${(${e}).toFixed(${fixed[1]})}` : `\${${e}}`;
      })
      .replace(//g, '{')
      .replace(//g, '}');
    return '`' + body + '`';
  }
  if (raw) {
    // r"\frac{a}{b}" → r`\frac{a}{b}` (the `r` tag is String.raw), unless the
    // text contains something a template literal would interpret.
    if (!/`|\$\{/.test(body) && !body.endsWith('\\')) return 'r`' + body + '`';
    body = body.replace(/\\/g, '\\\\');
  }
  return quote + body + quote;
}

const isWord = (c: string | undefined) => !!c && /[\w$]/.test(c);

/** Find the index of the bracket matching the one at `open`. */
function matching(text: string, open: number): number {
  const pairs: Record<string, string> = {'(': ')', '[': ']', '{': '}'};
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c in pairs) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Split on commas that are not nested in brackets. */
function splitTop(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(last, i));
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(last));
  return out;
}

function indexOfTop(text: string, pattern: RegExp, from = 0): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0) {
      pattern.lastIndex = 0;
      const m = pattern.exec(text.slice(i));
      if (m && m.index === 0) return i;
    }
  }
  return -1;
}

function convertRange(args: string): string {
  const parts = splitTop(args).map(p => p.trim());
  if (parts.length === 1) return `[0...${parts[0]}]`;
  if (parts.length === 2) return `[${parts[0]}...${parts[1]}]`;
  return `range(${args})`;
}

function convertIterable(expr: string): string {
  const r = /^range\((.*)\)$/s.exec(expr.trim());
  if (r && matching(expr.trim(), 5) === expr.trim().length - 1) return convertRange(r[1]);
  return expr.trim();
}

function convertLoopHead(targets: string, iterable: string): string {
  const it = iterable.trim();
  const en = /^enumerate\((.*)\)$/s.exec(it);
  const names = splitTop(targets).map(s => s.trim().replace(/^\((.*)\)$/, '$1'));
  if (en && names.length === 2) return `for ${names[1].includes(',') ? `[${names[1]}]` : names[1]}, ${names[0]} of ${convertIterable(en[1])}`;
  if (names.length > 1) return `for [${names.join(', ')}] of ${convertIterable(it)}`;
  return `for ${names[0]} of ${convertIterable(it)}`;
}

/** Expression-level rewrites on masked code. */
function convertExpression(code: string): string {
  let s = code;

  // lambda a, b: body  →  (a, b) => body
  for (;;) {
    const m = /\blambda\b/.exec(s);
    if (!m) break;
    const colon = indexOfTop(s, /:/y, m.index + 6);
    if (colon < 0) break;
    const args = s.slice(m.index + 6, colon).trim();
    s = `${s.slice(0, m.index)}(${args}) =>${s.slice(colon + 1)}`;
  }

  // Bracket-aware pass: keyword arguments, star-unpacking, tuples, slices,
  // comprehensions.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '(' && c !== '[') {
      out += c;
      continue;
    }
    const close = matching(s, i);
    if (close < 0) {
      out += c;
      continue;
    }
    const prev = out.trimEnd().slice(-1);
    const before = out.trimEnd();
    const afterKeyword = /(?:^|[^\w$.@])(?:return|in|of|if|and|or|not|else|is|yield|await|then|when)$/.test(before);
    const isCall = (isWord(prev) || prev === ')' || prev === ']') && !afterKeyword;
    const inner = convertExpression(s.slice(i + 1, close));
    if (c === '(') {
      if (isCall) {
        const args = splitTop(inner).map(arg =>
          arg
            .replace(/^(\s*)\*\*(?=[\w$@(\[])/, '$1...')
            .replace(/^(\s*)\*(?=[\w$@(\[])/, '$1...')
            .replace(/^(\s*)([A-Za-z_]\w*)\s*=(?!=)\s*/, '$1$2: '),
        );
        out += `(${bracePositionalThenKeywords(args).join(',')})`;
      } else if (splitTop(inner).length > 1 && !/=>\s*$/.test(s.slice(close + 1, close + 6)) && !/^\s*=>/.test(s.slice(close + 1))) {
        // A tuple. In JS `(a, b)` is the comma operator, so make it an array.
        const parts = splitTop(inner);
        if (parts[parts.length - 1].trim() === '') parts.pop();
        out += `[${parts.join(',')}]`;
      } else {
        out += `(${inner})`;
      }
    } else {
      const comp = indexOfTop(inner, /\sfor\s/y);
      if (!isCall && comp >= 0) {
        // [expr for x in xs if cond]  →  (for x of xs when cond then expr)
        const expr = inner.slice(0, comp).trim();
        const rest = inner.slice(comp + 5);
        const inAt = indexOfTop(rest, /\sin\s/y);
        if (inAt >= 0) {
          const targets = rest.slice(0, inAt);
          let iterable = rest.slice(inAt + 4);
          let guard = '';
          const ifAt = indexOfTop(iterable, /\sif\s/y);
          if (ifAt >= 0) {
            guard = ` when ${iterable.slice(ifAt + 4).trim()}`;
            iterable = iterable.slice(0, ifAt);
          }
          out += `(${convertLoopHead(targets, iterable)}${guard} then ${expr})`;
        } else {
          out += `[${inner}]`;
        }
      } else if (isCall && /^\s*-\s*\d+\s*$/.test(inner)) {
        // Negative index: a[-1] → a.at(-1)
        out += `.at(${inner.trim()})`;
      } else if (isCall && indexOfTop(inner, /:/y) >= 0) {
        // Slice: a[1:3] → a[1...3], a[:3] → a[...3], a[1:] → a[1..]
        const [from, to] = splitTop(inner, ':').map(p => p.trim());
        out += to === '' || to === undefined ? `[${from || 0}..]` : `[${from}...${to}]`;
      } else {
        out += `[${inner}]`;
      }
    }
    i = close;
  }
  s = out;

  return s
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/(?<![\w$.])self\.(?=[A-Za-z_])/g, '@')
    .replace(/(?<![\w$.])self(?![\w$])/g, 'this')
    .replace(/\s\/\/\s/g, ' %/ ')
    .replace(/\bis not\b/g, 'isnt')
    .replace(/(?<![\w$.@])len\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, '($1).length')
    .replace(/(?<![\w$.@])str\(/g, 'String(')
    .replace(/(?<![\w$.@])float\(/g, 'Number(')
    .replace(/(?<![\w$.@])int\(/g, 'Math.floor(')
    .replace(/(?<![\w$.@])(abs|min|max|round|pow)\(/g, 'Math.$1(')
    .replace(/(?<![\w$.@])print\(/g, 'console.log(')
    .replace(/(?<![\w$.@])math\.(?=[a-z])/g, 'Math.')
    .replace(/\bMath\.pi\b/g, 'Math.PI')
    .replace(/\(([A-Za-z_@][\w.@]*)\)\.length/g, '$1.length');
}

const KEYWORD_ARG = /^\s*[A-Za-z_]\w*: /;

/**
 * Civet 0.11 crashes on a multi-line call that lists positional arguments and
 * then bare `key: value` lines with trailing commas, so give the keyword run
 * explicit braces in that case.
 */
function bracePositionalThenKeywords(args: string[]): string[] {
  if (!args.some(a => a.includes('\n'))) return args;
  const first = args.findIndex(a => KEYWORD_ARG.test(a));
  if (first <= 0) return args;
  let last = args.length - 1;
  while (last > first && args[last].trim() === '') last--;
  if (!args.slice(first, last + 1).every(a => KEYWORD_ARG.test(a))) return args;
  // One line for the whole object: Civet is picky about multi-line braces.
  const lead = /^\s*/.exec(args[first])![0];
  const object = `${lead}{${args.slice(first, last + 1).map(a => a.trim()).join(', ')}}`;
  return [...args.slice(0, first), object, ...args.slice(last + 1)];
}

interface Block {
  indent: number;
  kind: 'class' | 'function' | 'other';
  /** Names assigned more than once in this function (need `let`). */
  reassigned?: Set<string>;
  declared?: Set<string>;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].length;

/** Names assigned more than once (or augmented) inside the block starting at `start`. */
function reassignedNames(lines: string[], start: number, indent: number): Set<string> {
  const counts = new Map<string, number>();
  const bump = (name: string, by = 1) => counts.set(name, (counts.get(name) ?? 0) + by);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (depth === 0 && indentOf(line) <= indent) break;
    if (depth === 0) {
      const simple = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(line);
      if (simple) bump(simple[1]);
      const aug = /^\s*([A-Za-z_]\w*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*)=/.exec(line);
      if (aug) bump(aug[1], 2);
      const tuple = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=(?!=)/.exec(line);
      if (tuple) tuple[1].split(',').forEach(n => bump(n.trim()));
    }
    for (const c of line) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
}

export function pythonToCivet(python: string): PythonConversion {
  const notes: string[] = [];
  const {text, table} = mask(python.replace(/\r\n?/g, '\n').replace(/\t/g, '    '));
  // Line continuations with a backslash join the next line.
  const lines = text.replace(/\\\n\s*/g, ' ').split('\n');
  const out: string[] = [];
  const blocks: Block[] = [];
  let depth = 0;
  const topLevel: Block = {indent: -1, kind: 'function', reassigned: reassignedNames(lines, 0, -1), declared: new Set()};

  // Group physical lines into logical statements (brackets may span lines).
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (depth > 0 || line.trim() === '') {
      // Continuation lines are handled as part of the statement they belong to.
    }
    let statement = line;
    let d = 0;
    for (const c of line) {
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) d--;
    }
    const extra: string[] = [];
    while (d > 0 && i + 1 < lines.length) {
      i++;
      extra.push(lines[i]);
      for (const c of lines[i]) {
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) d--;
      }
    }
    if (extra.length) statement = [line, ...extra].join('\n');
    line = statement;

    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    const indent = indentOf(line);
    const ws = line.slice(0, indent);
    const body = line.slice(indent);

    // A comment-only line: keep it, and do not let its indentation close blocks.
    if (new RegExp(`^${OPEN}\\d+${CLOSE}$`).test(body) && table[Number(body.slice(1, -1))].startsWith('#')) {
      const next = lines.slice(i + 1).find(l => l.trim() !== '');
      out.push((next ? next.slice(0, indentOf(next)) : ws) + body);
      continue;
    }
    while (blocks.length && blocks[blocks.length - 1].indent >= indent) blocks.pop();
    const parent = blocks[blocks.length - 1];
    const scope = [...blocks].reverse().find(b => b.kind === 'function') ?? topLevel;

    let m: RegExpExecArray | null;
    const trailing = (rest: string) => (rest.trim() ? ' ' + rest.trim() : '');
    // Split off a trailing comment placeholder so block keywords can match `:`.
    const cm = new RegExp(`\\s*(${OPEN}\\d+${CLOSE})\\s*$`).exec(body);
    const hasComment = cm && table[Number(cm[1].slice(1, -1))].startsWith('#');
    const stmt = hasComment ? body.slice(0, cm!.index) : body;
    const comment = hasComment ? `  ${cm![1]}` : '';
    const emit = (code: string) => out.push(ws + code + comment);

    if ((m = /^from\s+manim\s+import\s+\*\s*$/.exec(stmt))) {
      emit('from manim import *');
    } else if ((m = /^(?:import\s+.+|from\s+\S+\s+import\s+.+)$/.exec(stmt))) {
      const literal = `# ${stmt}  (not needed here)`;
      table.push(literal);
      out.push(`${ws}${OPEN}${table.length - 1}${CLOSE}`);
    } else if ((m = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:\s*$/.exec(stmt))) {
      const base = m[2]?.split(',')[0].trim();
      emit(`class ${m[1]}${base && base !== 'object' ? ` extends ${base}` : ''}`);
      blocks.push({indent, kind: 'class'});
    } else if ((m = /^def\s+([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*(?:->[^:]+)?:\s*$/.exec(stmt))) {
      const params = splitTop(m[2])
        .map(p => p.trim())
        .filter(p => p && p !== 'self' && p !== 'cls')
        .map(p => convertExpression(p.replace(/^\*\*/, '...').replace(/^\*/, '...').replace(/\s*:\s*[^=]+(?==|$)/, '')))
        .join(', ');
      const isMethod = parent?.kind === 'class';
      const name = m[1] === '__init__' ? 'constructor' : m[1];
      // A def nested in a method closes over `self`, so it must be an arrow.
      const nested = !isMethod && blocks.some(b => b.kind === 'class');
      emit(isMethod ? `${name}(${params})` : nested ? `${name} := (${params}) =>` : `function ${name}(${params})`);
      blocks.push({indent, kind: 'function', reassigned: reassignedNames(lines, i + 1, indent), declared: new Set()});
    } else if ((m = /^if\s+__name__\s*==/.exec(stmt))) {
      notes.push('Dropped the `if __name__ == "__main__"` block.');
      // Skip its body.
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || indentOf(lines[i + 1]) > indent)) i++;
    } else if ((m = /^(if|elif|while)\s+([\s\S]*?):\s*$/.exec(stmt))) {
      emit(`${m[1] === 'elif' ? 'else if' : m[1]} ${convertExpression(m[2])}`);
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^(if|elif|while)\s+([\s\S]*?):\s*(\S[\s\S]*)$/.exec(stmt)) && indexOfTop(stmt, /:/y) === stmt.indexOf(m[3]) - 1 - (stmt.slice(0, stmt.indexOf(m[3])).length - stmt.slice(0, stmt.indexOf(m[3])).trimEnd().length)) {
      emit(`${m[1] === 'elif' ? 'else if' : m[1]} ${convertExpression(m[2])} then ${convertExpression(m[3])}`);
    } else if ((m = /^else\s*:\s*$/.exec(stmt))) {
      emit('else');
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^for\s+([\s\S]+?)\s+in\s+([\s\S]+?):\s*$/.exec(stmt))) {
      emit(convertLoopHead(convertExpression(m[1]), convertExpression(m[2])));
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^try\s*:\s*$/.exec(stmt))) {
      emit('try');
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^except\b(?:\s+[\w.]+)?(?:\s+as\s+(\w+))?\s*:\s*$/.exec(stmt))) {
      emit(`catch ${m[1] ?? 'e'}`);
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^finally\s*:\s*$/.exec(stmt))) {
      emit('finally');
      blocks.push({indent, kind: 'other'});
    } else if ((m = /^with\s+([\s\S]+?):\s*$/.exec(stmt))) {
      notes.push(`"with ${restore(m[1], table)}" has no direct equivalent; its body was kept as a plain block.`);
      emit(`do`);
      blocks.push({indent, kind: 'other'});
    } else if (/^pass\s*$/.test(stmt)) {
      emit('void 0');
    } else if ((m = /^(return|yield|raise)\b\s*([\s\S]*)$/.exec(stmt))) {
      const keyword = m[1] === 'raise' ? 'throw' : m[1];
      emit(`${keyword}${trailing(convertExpression(m[2]))}`);
    } else if ((m = /^([A-Za-z_]\w*)\s*(?::\s*[\w\[\], .]+)?\s*=(?!=)\s*([\s\S]+)$/.exec(stmt)) && parent?.kind !== 'class') {
      const name = m[1];
      const value = convertExpression(m[2]);
      if (scope.reassigned?.has(name)) {
        if (scope.declared!.has(name)) emit(`${name} = ${value}`);
        else {
          scope.declared!.add(name);
          emit(`let ${name} = ${value}`);
        }
      } else {
        emit(`${name} := ${value}`);
      }
    } else if ((m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=(?!=)\s*([\s\S]+)$/.exec(stmt))) {
      const names = m[1].split(',').map(s => s.trim());
      const rhs = convertExpression(m[2]);
      const value = splitTop(rhs).length > 1 ? `[${rhs}]` : rhs;
      const again = names.some(n => scope.reassigned?.has(n));
      if (again) {
        const fresh = names.filter(n => !scope.declared!.has(n));
        if (fresh.length === names.length) {
          names.forEach(n => scope.declared!.add(n));
          emit(`let [${names.join(', ')}] = ${value}`);
        } else emit(`[${names.join(', ')}] = ${value}`);
      } else emit(`[${names.join(', ')}] := ${value}`);
    } else {
      emit(convertExpression(stmt));
    }
  }

  let code = out.join('\n');
  code = code.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, n) => convertString(table[Number(n)]));
  // Docstrings as statements are noise in Civet; keep them as block comments.
  code = code.replace(/^(\s*)"""([\s\S]*?)"""\s*$/gm, (_m, ws, text) => `${ws}###${text}###`);
  if (!/^from manim import \*$/m.test(code)) {
    code = `from manim import *\n\n${code.replace(/^\n+/, '')}`;
    notes.push('Added `from manim import *`.');
  }
  if (/\bnp\.\w+/.test(code)) notes.push('`np` is a small built-in shim (sin, cos, array, linspace, arange, …), not numpy.');
  if (/\bsuper\(\)/.test(code)) notes.push('Check `super()` calls: use `super.method(...)` in Civet.');
  return {code: code.replace(/[ \t]+$/gm, ''), notes};
}

function restore(text: string, table: string[]): string {
  return text.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, n) => table[Number(n)]);
}
