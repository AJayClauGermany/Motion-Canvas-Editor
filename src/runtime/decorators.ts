/**
 * Legacy decorators → `__decorate` calls, the way TypeScript emits them with
 * `experimentalDecorators`. Sucrase has no decorator support, and Canvas
 * Commons components declare their signals with them:
 *
 *   class Switch extends Node {            class Switch extends Node {
 *     @initial(false)
 *     @signal()                       →
 *     declare public readonly on: …;         declare public readonly on: …;
 *   }                                      };__decorate([initial(false), signal()], Switch.prototype, "on", void 0);
 *
 * The transform is a source-to-source rewrite that never moves code to another
 * line: decorators are blanked out in place and the calls are appended on the
 * line of the class's closing brace. It scans rather than parses, tracking
 * only what is needed to find class members: strings, template literals,
 * comments, regular expressions, JSX and bracket nesting.
 *
 * `__decorate` is defined below and handed to scenes by `Engine.runtimeScope`.
 */

/** A decorator that cannot be lowered. `loc` matches sucrase's error shape. */
export class DecoratorError extends Error {
  public readonly loc: {line: number; column: number};
  public constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'DecoratorError';
    this.loc = {line, column};
  }
}

/**
 * What the previous token was, as far as the next one cares: after a `word`,
 * `literal` or `close` (`)`, `]`, `++`) a `/` divides and a `<` compares; after
 * a `keyword` (`return`, …) or `punct` they start a regular expression or JSX.
 * `brace` is a closed `{…}` group or a class declaration.
 */
type Kind = 'word' | 'keyword' | 'literal' | 'punct' | 'close' | 'brace';

interface Tok {
  kind: Kind;
  text: string;
  start: number;
  end: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Decorator {
  /** Position of the `@`. */
  start: number;
  end: number;
  /** The expression after the `@`. */
  text: string;
}

interface Member {
  decorators: Decorator[];
  /** The property key as a JavaScript expression: `"name"`, `'quoted'`, `Symbol.iterator`. */
  key: string;
  isStatic: boolean;
  kind: 'property' | 'method';
}

interface State {
  pos: number;
  edits: number;
  hist: Tok[];
}

/** Thrown when the scanner loses track; the source is then returned untouched. */
const BAIL = Symbol('bail');

const IDENT_START = /[A-Za-z_$\u00a1-\uffff]/;
const WORD = /[A-Za-z_$\u00a1-\uffff][\w$\u00a1-\uffff]*/y;
const NUMBER = /\d[\w.]*/y;
const JSX_NAME = /[A-Za-z_$][\w$.:-]*/y;
const JSX_CLOSE = /<\/\s*([A-Za-z_$][\w$.:-]*)?\s*>/y;
const GENERIC_ARROW = /\s*(?:,|extends\b)/y;
const CLOSER: Record<string, string> = {'(': ')', '[': ']', '{': '}'};

/** Words an expression may follow, so `/` and `<` after them are not operators. */
const KEYWORDS = new Set([
  'return', 'yield', 'typeof', 'case', 'do', 'else', 'in', 'of', 'instanceof',
  'new', 'delete', 'void', 'throw', 'await', 'default',
]);
const MODIFIERS = new Set([
  'declare', 'public', 'private', 'protected', 'readonly', 'static', 'override',
  'abstract', 'async', 'accessor', 'get', 'set',
]);
/** Type operators: the type goes on after them. */
const TYPE_PREFIX = new Set([
  'keyof', 'typeof', 'readonly', 'infer', 'asserts', 'is', 'extends', 'unique',
  'new', 'abstract', 'in', 'out', 'const',
]);
/** Words that continue an expression when they begin a line. */
const BINARY_WORDS = new Set(['in', 'instanceof', 'as', 'satisfies']);

const isIdentStart = (c: string | undefined): c is string => c !== undefined && IDENT_START.test(c);
const isDigit = (c: string | undefined): c is string => c !== undefined && c >= '0' && c <= '9';

class Lowerer {
  private pos = 0;
  private edits: Edit[] = [];
  private hist: Tok[] = [];
  private holders = 0;

  public constructor(private readonly src: string) {}

  public run(): string {
    const s = this.src;
    for (;;) {
      this.trivia();
      const c = s[this.pos];
      if (c === undefined) break;
      if (c === ')' || c === ']' || c === '}') throw BAIL;
      this.token();
    }
    if (this.edits.length === 0) return s;
    const edits = this.edits.map((e, i) => ({...e, i})).sort((a, b) => a.start - b.start || a.i - b.i);
    let out = '';
    let at = 0;
    for (const e of edits) {
      if (e.start < at) throw BAIL;
      out += s.slice(at, e.start) + e.text;
      at = e.end;
    }
    return out + s.slice(at);
  }

  // ------------------------------------------------------------- bookkeeping

  private push(kind: Kind, start: number, text = this.src.slice(start, this.pos)) {
    if (this.hist.length > 48) this.hist.splice(0, 32);
    this.hist.push({kind, text, start, end: this.pos});
  }

  private save(): State {
    return {pos: this.pos, edits: this.edits.length, hist: this.hist.slice()};
  }

  private restore(state: State) {
    this.pos = state.pos;
    this.edits.length = state.edits;
    this.hist = state.hist;
  }

  private match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m) this.pos += m[0].length;
    return m;
  }

  private word(): string {
    const m = this.match(WORD);
    if (!m) throw BAIL;
    return m[0];
  }

  private error(message: string, at: number): DecoratorError {
    const before = this.src.slice(0, at);
    const line = before.split('\n').length;
    return new DecoratorError(message, line, at - before.lastIndexOf('\n') - 1);
  }

  /** Replace a range with blanks, keeping its line breaks. */
  private blank(start: number, end: number) {
    this.edits.push({start, end, text: this.src.slice(start, end).replace(/[^\n]/g, ' ')});
  }

  // ------------------------------------------------------------------ atoms

  /** Skip whitespace and comments. Returns whether a line break was crossed. */
  private trivia(): boolean {
    const s = this.src;
    let newline = false;
    for (;;) {
      const c = s[this.pos];
      if (c === '\n') {
        newline = true;
        this.pos++;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\u00a0' || c === '\ufeff') {
        this.pos++;
      } else if (c === '/' && s[this.pos + 1] === '/') {
        const end = s.indexOf('\n', this.pos);
        this.pos = end < 0 ? s.length : end;
      } else if (c === '/' && s[this.pos + 1] === '*') {
        const close = s.indexOf('*/', this.pos + 2);
        const end = close < 0 ? s.length : close + 2;
        if (s.slice(this.pos, end).includes('\n')) newline = true;
        this.pos = end;
      } else {
        return newline;
      }
    }
  }

  private string() {
    const s = this.src;
    const quote = s[this.pos];
    let i = this.pos + 1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') i++;
      else if (c === quote) {
        i++;
        break;
      } else if (c === '\n') break;
    }
    this.pos = Math.min(i, s.length);
  }

  private template() {
    const s = this.src;
    this.pos++;
    for (;;) {
      const c = s[this.pos];
      if (c === undefined) throw BAIL;
      if (c === '\\') this.pos += 2;
      else if (c === '`') {
        this.pos++;
        return;
      } else if (c === '$' && s[this.pos + 1] === '{') {
        this.pos++;
        this.group();
      } else this.pos++;
    }
  }

  private regex(): boolean {
    const s = this.src;
    let inClass = false;
    for (let i = this.pos + 1; i < s.length; i++) {
      const c = s[i];
      if (c === '\n') return false;
      if (c === '\\') i++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++;
        while (i < s.length && /[A-Za-z]/.test(s[i])) i++;
        this.pos = i;
        return true;
      }
    }
    return false;
  }

  /** A bracketed group, from its opening bracket to the matching closing one. */
  private group() {
    const start = this.pos;
    const close = CLOSER[this.src[start]];
    this.pos++;
    this.push('punct', start);
    for (;;) {
      this.trivia();
      const c = this.src[this.pos];
      if (c === undefined) throw BAIL;
      if (c === close) {
        this.pos++;
        return;
      }
      if (c === ')' || c === ']' || c === '}') throw BAIL;
      this.token();
    }
  }

  /** `<T>`, with nested angle brackets. */
  private angles() {
    const s = this.src;
    let depth = 0;
    for (;;) {
      this.trivia();
      const c = s[this.pos];
      if (c === undefined) throw BAIL;
      if (c === '<') {
        depth++;
        this.pos++;
      } else if (c === '=' && s[this.pos + 1] === '>') {
        this.pos += 2;
      } else if (c === '>') {
        this.pos++;
        if (--depth === 0) return;
      } else if (c === '(' || c === '[' || c === '{') {
        this.group();
      } else if (c === ')' || c === ']' || c === '}') {
        throw BAIL;
      } else if (c === '"' || c === "'" || c === '`') {
        this.token();
      } else {
        this.pos++;
      }
    }
  }

  /**
   * A JSX element or fragment. Text between tags is not code: an apostrophe,
   * an `@` or a keyword in it means nothing. Returns false if what follows
   * `<` turns out not to be JSX (a comparison or a type argument list).
   */
  private jsx(): boolean {
    const s = this.src;
    this.pos++;
    const name = this.match(JSX_NAME)?.[0] ?? '';
    if (name) {
      // `<T,>(x: T) => x` and `<T extends U>(x: T) => x` are generic functions.
      GENERIC_ARROW.lastIndex = this.pos;
      if (GENERIC_ARROW.test(s)) return false;
    }
    for (;;) {
      while (/\s/.test(s[this.pos] ?? '')) this.pos++;
      const c = s[this.pos];
      const next = s[this.pos + 1];
      if (c === undefined) return false;
      if (c === '/' && next === '>') {
        this.pos += 2;
        return true;
      }
      if (c === '/' && (next === '/' || next === '*')) {
        this.trivia();
        continue;
      }
      if (c === '>') {
        this.pos++;
        break;
      }
      if (!name) return false;
      if (c === '{') {
        this.group();
      } else if (c === '"' || c === "'") {
        const end = s.indexOf(c, this.pos + 1);
        if (end < 0) return false;
        this.pos = end + 1;
      } else if (c === '<') {
        if (!/=\s*$/.test(s.slice(Math.max(0, this.pos - 40), this.pos)) || !this.jsx()) return false;
      } else if (/[\w$:.=-]/.test(c)) {
        this.pos++;
      } else {
        return false;
      }
    }
    for (;;) {
      const c = s[this.pos];
      if (c === undefined) return false;
      if (c === '{') {
        this.group();
      } else if (c === '<') {
        if (s[this.pos + 1] === '/') {
          const m = this.match(JSX_CLOSE);
          return !!m && (m[1] ?? '') === name;
        }
        if (!this.jsx()) return false;
      } else {
        // Text. Sucrase lets a stray `}` or `>` through, so they are text too.
        this.pos++;
      }
    }
  }

  private tryJsx(): boolean {
    const s = this.src;
    const next = s[this.pos + 1];
    if (next !== '>' && !isIdentStart(next)) return false;
    const state = this.save();
    let ok = false;
    try {
      ok = this.jsx();
    } catch (e) {
      if (e !== BAIL) throw e;
    }
    if (!ok) this.restore(state);
    return ok;
  }

  /** Consume one token. A bracketed group, a JSX element and a class each count as one. */
  private token() {
    const s = this.src;
    const start = this.pos;
    const c = s[start];
    const prev = this.hist[this.hist.length - 1];
    const operand = !prev || prev.kind === 'punct' || prev.kind === 'keyword';
    if (c === '"' || c === "'") {
      this.string();
      return this.push('literal', start);
    }
    if (c === '`') {
      this.template();
      return this.push('literal', start);
    }
    if (c === '(' || c === '[' || c === '{') {
      this.group();
      return this.push(c === '{' ? 'brace' : 'close', start);
    }
    if (c === '/' && (operand || prev.kind === 'brace') && this.regex()) return this.push('literal', start);
    if (c === '<' && operand && this.tryJsx()) return this.push('literal', start);
    if (c === '@' && this.decoratedClass()) return;
    if (isIdentStart(c)) {
      const w = this.word();
      if (w === 'class' && this.classAhead()) return this.classAt(start, [], []);
      return this.push(KEYWORDS.has(w) ? 'keyword' : 'word', start);
    }
    if (isDigit(c)) {
      this.match(NUMBER);
      return this.push('literal', start);
    }
    if (c === '=' && s[start + 1] === '>') {
      this.pos += 2;
      return this.push('punct', start);
    }
    if ((c === '+' || c === '-') && s[start + 1] === c) {
      this.pos += 2;
      return this.push(operand ? 'punct' : 'close', start);
    }
    this.pos++;
    this.push('punct', start);
  }

  // ---------------------------------------------------------------- classes

  /** After the word `class`: is this the keyword, rather than a property named `class`? */
  private classAhead(): boolean {
    const prev = this.hist[this.hist.length - 1];
    if (prev && prev.text.endsWith('.')) return false;
    const at = this.pos;
    this.trivia();
    const c = this.src[this.pos];
    this.pos = at;
    return c === '{' || isIdentStart(c);
  }

  /** `@name`, `@name(args)`, `@a.b(args)` or `@(expression)`. */
  private decorator(): Decorator | null {
    const s = this.src;
    const state = this.save();
    this.pos++;
    if (s[this.pos] === '(') this.group();
    else if (isIdentStart(s[this.pos])) this.word();
    else {
      this.restore(state);
      return null;
    }
    for (;;) {
      if (s[this.pos] === '.' && isIdentStart(s[this.pos + 1])) {
        this.pos++;
        this.word();
      } else if (s[this.pos] === '(') {
        this.group();
      } else if (s[this.pos] === '<') {
        // Type arguments: `@initial<DrawHooks>({…})`.
        const at = this.pos;
        this.angles();
        if (s[this.pos] !== '(') {
          this.pos = at;
          break;
        }
      } else break;
    }
    // The expression is moved as text, so nothing inside it may be rewritten.
    const end = this.pos;
    this.restore(state);
    this.pos = end;
    return {start: state.pos, end, text: s.slice(state.pos + 1, end)};
  }

  /** `@dec class X {}`, `@dec export class X {}`, `@dec export default class {}`. */
  private decoratedClass(): boolean {
    const s = this.src;
    const state = this.save();
    const decorators: Decorator[] = [];
    const lead: Tok[] = [];
    try {
      while (s[this.pos] === '@') {
        const d = this.decorator();
        if (!d) break;
        decorators.push(d);
        this.trivia();
      }
      while (decorators.length && isIdentStart(s[this.pos])) {
        const start = this.pos;
        const w = this.word();
        if (w === 'class') {
          if (!this.classAhead()) break;
          this.classAt(start, decorators, lead);
          return true;
        }
        if (w !== 'export' && w !== 'default' && w !== 'abstract') break;
        lead.push({kind: 'word', text: w, start, end: this.pos});
        this.trivia();
      }
    } catch (e) {
      if (e !== BAIL) throw e;
    }
    this.restore(state);
    return false;
  }

  /**
   * A class, from the `class` keyword at `classStart` (already consumed).
   * `lead` are the `export` / `default` / `abstract` words between the class
   * decorators and the keyword.
   */
  private classAt(classStart: number, classDecorators: Decorator[], lead: Tok[]) {
    const s = this.src;
    const editsBefore = this.edits.length;

    // What comes before decides whether this is a declaration or an expression.
    const h = this.hist;
    let i = h.length - 1;
    const words = [...lead];
    while (i >= 0 && h[i].kind !== 'punct' && (h[i].text === 'abstract' || h[i].text === 'default' || h[i].text === 'export')) {
      words.unshift(h[i--]);
      if (words[0].text === 'export') break;
    }
    const exported = words.some(t => t.text === 'export');
    const isDefault = words.some(t => t.text === 'default');
    const before = i >= 0 ? h[i] : undefined;
    const declaration =
      exported ||
      !before ||
      before.kind === 'word' ||
      before.kind === 'literal' ||
      before.kind === 'close' ||
      before.kind === 'brace' ||
      (before.kind === 'punct' && (before.text === ';' || before.text === '{'));
    // `const X = class … {}`: the binding names the class.
    const binding =
      !declaration && i >= 2 && h[i].text === '=' && h[i - 1].kind === 'word' && /^(const|let|var)$/.test(h[i - 2].text)
        ? h[i - 1].text
        : null;

    this.trivia();
    let name: string | null = null;
    if (isIdentStart(s[this.pos])) {
      const at = this.pos;
      const w = this.word();
      if (w === 'extends' || w === 'implements') this.pos = at;
      else name = w;
    }
    // Heritage: up to the `{` that is not inside type arguments.
    let angle = 0;
    for (;;) {
      this.trivia();
      const c = s[this.pos];
      if (c === undefined || c === ';' || c === ')' || c === ']' || c === '}') throw BAIL;
      if (c === '{' && angle === 0) break;
      if (c === '<') {
        angle++;
        this.pos++;
      } else if (c === '=' && s[this.pos + 1] === '>') {
        this.pos += 2;
      } else if (c === '>') {
        angle = Math.max(0, angle - 1);
        this.pos++;
      } else {
        this.token();
      }
    }

    this.pos++;
    const members: Member[] = [];
    for (;;) {
      this.trivia();
      const c = s[this.pos];
      if (c === undefined) throw BAIL;
      if (c === '}') {
        this.pos++;
        break;
      }
      if (c === ';') {
        this.pos++;
        continue;
      }
      const member = this.member();
      if (member) members.push(member);
    }
    const bodyEnd = this.pos;
    const done = () => this.push(declaration ? 'brace' : 'literal', classStart);
    if (members.length === 0 && classDecorators.length === 0) return done();

    // A class decorator spread over several lines cannot be moved behind the
    // class without moving lines. Leave such a class as it was written.
    if (classDecorators.some(d => d.text.includes('\n'))) {
      this.edits.length = editsBefore;
      return done();
    }

    const wrap = !(declaration && name) && !(binding && classDecorators.length === 0 && this.statementEnds());
    const ref = wrap ? '__c' : declaration ? name! : binding!;
    const calls: string[] = [];
    const cleanup: string[] = [];
    // TypeScript's order: instance members first, then static ones.
    for (const m of [...members.filter(m => !m.isStatic), ...members.filter(m => m.isStatic)]) {
      const list = m.decorators.map(d => {
        if (!d.text.includes('\n')) {
          this.blank(d.start, d.end);
          return d.text;
        }
        // A decorator spread over several lines stays where it is, as a
        // static field that holds its value until the class is complete.
        const holder = `__dec${this.holders++}`;
        this.edits.push({start: d.start, end: d.start + 1, text: `static ${holder} = `}, {start: d.end, end: d.end, text: ';'});
        cleanup.push(`delete ${ref}.${holder}`);
        return `${ref}.${holder}`;
      });
      const target = m.isStatic ? ref : `${ref}.prototype`;
      calls.push(`__decorate([${list.join(', ')}], ${target}, ${m.key}, ${m.kind === 'method' ? 'null' : 'void 0'})`);
    }
    for (const d of classDecorators) this.blank(d.start, d.end);
    const classList = classDecorators.map(d => d.text).join(', ');

    if (wrap) {
      // An expression (or an anonymous default export): there is no binding
      // to refer to afterwards, so hand the class to a function instead.
      const result = classDecorators.length ? `__decorate([${classList}], __c)` : '__c';
      for (const t of words) if (t.text === 'abstract') this.blank(t.start, t.end);
      this.edits.push(
        {start: classStart, end: classStart, text: `((__c) => (${[...calls, ...cleanup, result].join(', ')}))(`},
        {start: bodyEnd, end: bodyEnd, text: declaration ? ');' : ')'},
      );
    } else {
      let text = ';' + [...calls, ...cleanup].map(c => `${c};`).join('');
      if (classDecorators.length) {
        text += `${ref} = __decorate([${classList}], ${ref});`;
        // The export has to see the decorated class.
        for (const t of words) if (t.text !== 'abstract') this.blank(t.start, t.end);
        if (exported) text += isDefault ? `export default ${ref};` : `export {${ref}};`;
      }
      this.edits.push({start: bodyEnd, end: bodyEnd, text});
    }
    done();
  }

  /** Whether the statement ends right after the class expression just scanned. */
  private statementEnds(): boolean {
    const at = this.pos;
    const newline = this.trivia();
    const c = this.src[this.pos];
    const ends = c === undefined || c === ';' || c === '}' || (newline && this.startsLine(c));
    this.pos = at;
    return ends;
  }

  /** Whether a token at the start of a line begins something new rather than continuing an expression. */
  private startsLine(c: string): boolean {
    if (c === '@' || c === '#' || c === '"' || c === "'" || isDigit(c)) return true;
    if (!isIdentStart(c)) return false;
    WORD.lastIndex = this.pos;
    const m = WORD.exec(this.src);
    return !m || !BINARY_WORDS.has(m[0]);
  }

  /** One class member. Returns it if it is decorated. */
  private member(): Member | null {
    const s = this.src;
    const decorators: Decorator[] = [];
    while (s[this.pos] === '@') {
      const d = this.decorator();
      if (!d) throw BAIL;
      decorators.push(d);
      this.trivia();
    }

    let isStatic = false;
    let accessor = false;
    let isPrivate = false;
    let key = '';
    const nameStart = this.pos;
    for (;;) {
      this.trivia();
      const c = s[this.pos];
      const start = this.pos;
      if (c === '*') {
        this.pos++;
      } else if (c === '"' || c === "'") {
        this.string();
        key = s.slice(start, this.pos);
        break;
      } else if (c === '[') {
        this.group();
        key = s.slice(start + 1, this.pos - 1).trim();
        break;
      } else if (isDigit(c)) {
        const text = this.match(NUMBER)![0];
        key = JSON.stringify(String(Number(text)));
        break;
      } else if (c === '#') {
        this.pos++;
        this.word();
        isPrivate = true;
        break;
      } else if (isIdentStart(c)) {
        const w = this.word();
        const after = this.pos;
        this.trivia();
        const n = s[this.pos];
        if (w === 'static' && n === '{') {
          // A static initialization block.
          this.group();
          return null;
        }
        if (MODIFIERS.has(w) && n !== undefined && (isIdentStart(n) || isDigit(n) || '#["\'*'.includes(n))) {
          if (w === 'static') isStatic = true;
          if (w === 'get' || w === 'set' || w === 'accessor') accessor = true;
          continue;
        }
        this.pos = after;
        key = JSON.stringify(w);
        break;
      } else {
        throw BAIL;
      }
    }

    this.trivia();
    if (s[this.pos] === '?' || s[this.pos] === '!') this.pos++;
    this.trivia();
    let kind: Member['kind'] = accessor ? 'method' : 'property';
    if (s[this.pos] === '(' || s[this.pos] === '<') {
      kind = 'method';
      if (s[this.pos] === '<') this.angles();
      this.trivia();
      if (s[this.pos] === '(') this.group();
      this.trivia();
      if (s[this.pos] === ':') {
        this.pos++;
        this.type();
      }
      this.trivia();
      if (s[this.pos] === '{') this.group();
    } else {
      if (s[this.pos] === ':') {
        this.pos++;
        this.type();
      }
      const at = this.pos;
      this.trivia();
      if (s[this.pos] === '=' && s[this.pos + 1] !== '>') {
        this.pos++;
        this.initializer();
      } else {
        this.pos = at;
      }
    }

    if (decorators.length === 0) return null;
    if (isPrivate) throw this.error('Decorators cannot be applied to #private members.', decorators[0].start);
    if (key.includes('\n')) throw this.error('A decorated member needs its computed name on one line.', nameStart);
    return {decorators, key, isStatic, kind};
  }

  /**
   * A type annotation: up to the `=`, `;`, line end or method body that ends
   * it. A `{` is an object type where a type is expected and a body otherwise.
   */
  private type() {
    const s = this.src;
    let angle = 0;
    let operand = true;
    for (;;) {
      const at = this.pos;
      const newline = this.trivia();
      const c = s[this.pos];
      if (c === undefined) return;
      if (newline && angle === 0 && !operand && c !== '|' && c !== '&' && c !== '.') {
        this.pos = at;
        return;
      }
      if (c === ';' || c === ')' || c === ']' || c === '}') return;
      if (c === '=' && s[this.pos + 1] === '>') {
        this.pos += 2;
        operand = true;
      } else if (c === '=' || c === ',') {
        if (angle === 0) return;
        this.pos++;
        operand = true;
      } else if (c === '{') {
        if (angle === 0 && !operand) return;
        this.group();
        operand = false;
      } else if (c === '(' || c === '[') {
        this.group();
        operand = false;
      } else if (c === '<') {
        angle++;
        this.pos++;
        operand = true;
      } else if (c === '>') {
        angle = Math.max(0, angle - 1);
        this.pos++;
        operand = false;
      } else if (c === '"' || c === "'" || c === '`') {
        if (c === '`') this.template();
        else this.string();
        operand = false;
      } else if (isIdentStart(c)) {
        operand = TYPE_PREFIX.has(this.word());
      } else if (isDigit(c)) {
        this.match(NUMBER);
        operand = false;
      } else if ('|&?:.-'.includes(c)) {
        this.pos++;
        operand = true;
      } else {
        return;
      }
    }
  }

  /** A property initializer: up to the `;` or the line break that ends it. */
  private initializer() {
    const s = this.src;
    this.push('punct', this.pos - 1);
    for (;;) {
      const at = this.pos;
      const newline = this.trivia();
      const c = s[this.pos];
      if (c === undefined || c === ';' || c === ')' || c === ']' || c === '}') return;
      if (newline && this.startsLine(c)) {
        // Automatic semicolon insertion. A `>` may close type arguments
        // (`x = y as Map<K, V>`), so it counts as an end as well.
        const prev = this.hist[this.hist.length - 1];
        if ((prev.kind !== 'punct' && prev.kind !== 'keyword') || prev.text === '>') {
          this.pos = at;
          return;
        }
      }
      this.token();
    }
  }
}

/**
 * TypeScript's `__decorate` helper, which the lowered code calls. The engine
 * puts it in every scene's scope.
 *
 * With two arguments it decorates a class and returns the class to use. With
 * three it decorates a property. With four it decorates a method or accessor:
 * `null` means "look the descriptor up", and a descriptor returned by a
 * decorator is defined on the target. Decorators run last to first.
 */
export function __decorate(decorators: any[], target: any, key?: PropertyKey, desc?: any): any {
  const c = arguments.length;
  let r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key!)) : desc;
  for (let i = decorators.length - 1; i >= 0; i--) {
    const d = decorators[i];
    if (d) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  }
  if (c > 3 && r) Object.defineProperty(target, key!, r);
  return r;
}

/**
 * Rewrite legacy decorators on class members (and on classes) as `__decorate`
 * calls. The output has the same lines as the input.
 *
 * Supported: any number of decorators per member, on properties, methods,
 * generators, accessors and static members, in class declarations (exported
 * or not) and class expressions; decorator arguments of any shape. As in
 * TypeScript's output, a class's instance members are decorated before its
 * static ones, and the class itself last.
 *
 * One difference from TypeScript: a member decorator written over several
 * lines cannot move without moving lines, so it is evaluated where it stands
 * (as a temporary static field), before the single-line ones.
 *
 * Not supported: parameter decorators (left as they are), `#private` members
 * (reported as an error), and class decorators that span lines (that class
 * is left as it is).
 *
 * @throws DecoratorError for a decorator that cannot be lowered.
 */
export function lowerDecorators(ts: string): string {
  if (!ts.includes('@')) return ts;
  try {
    return new Lowerer(ts).run();
  } catch (e) {
    // The scanner lost track of the source. Let the next stage report it.
    if (e === BAIL) return ts;
    throw e;
  }
}
