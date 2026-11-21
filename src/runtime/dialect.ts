/**
 * Source-to-source conversions between the dialect variants the editor lets
 * you compare (the "Lab"). All of them work on Civet text and keep line
 * numbers stable.
 */
import {api} from '../manim';
import {camel, snake} from '../manim/util';
import {defaultCompileOptions, expandDialect} from './compile';

let known: Set<string> | null = null;
/** Every member/function name the Manim layer exposes, in both spellings. */
export function knownNames(): Set<string> {
  if (known) return known;
  known = new Set<string>();
  for (const [name, value] of Object.entries(api)) {
    known.add(name);
    let proto = typeof value === 'function' ? (value as any).prototype : null;
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) known.add(key);
      proto = Object.getPrototypeOf(proto);
    }
  }
  return known;
}

/** Apply `fn` to code only, leaving strings and comments untouched. */
function mapCode(source: string, fn: (code: string) => string): string {
  const pattern = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|(?<![\w$)\]])#\s[^\n]*|^\s*#[^\n]*)/gm;
  let out = '';
  let last = 0;
  for (const m of source.matchAll(pattern)) {
    out += fn(source.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + fn(source.slice(last));
}

export function toCamelCase(source: string): string {
  const names = knownNames();
  return mapCode(source, code =>
    code.replace(/(?<![\w$])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w$])(\s*:(?!:))?/g, (id, colon) => {
      const bare = colon ? id.slice(0, id.length - colon.length) : id;
      const c = camel(bare);
      return colon || names.has(c) ? c + (colon ?? '') : id;
    }),
  );
}

export function toSnakeCase(source: string): string {
  const names = knownNames();
  return mapCode(source, code =>
    code.replace(/(?<![\w$])[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+(?![\w$])(\s*:(?!:))?/g, (id, colon) => {
      const bare = colon ? id.slice(0, id.length - colon.length) : id;
      const s = snake(bare);
      const isKwarg = !!colon;
      return names.has(s) || isKwarg ? s + (colon ?? '') : id;
    }),
  );
}

/** Show the `yield*` that implicit mode inserts. */
export function toExplicitYield(source: string): string {
  const out = expandDialect(source, {...defaultCompileOptions, implicitYield: true}).code;
  // `expandDialect` also rewrites the import line; keep the user's original.
  const first = /^[ \t]*from\s+['"]?manim['"]?\s+import\s+\*[ \t]*$/m.exec(source);
  return first ? out.replace('// from manim import *', first[0]) : out;
}

/** Drop `yield*` in front of scene calls again. */
export function toImplicitYield(source: string): string {
  return mapCode(source, code => code.replace(/\byield\*\s+(?=(@|this\.)[A-Za-z_$])/g, ''));
}

/** `@play` ⇄ `self.play`. */
export function toSelf(source: string): string {
  return mapCode(source, code =>
    code
      .replace(/(?<![\w$.@])@(?=[A-Za-z_$])/g, 'self.')
      .replace(/^(\s+)(construct)\(\)\s*$/gm, '$1$2(self)'),
  );
}
export function toAt(source: string): string {
  return mapCode(source, code =>
    code.replace(/(?<![\w.$@])self\./g, '@').replace(/\(\s*self\s*\)/g, '()'),
  );
}
