import chroma from 'chroma-js';

export type RGB = [number, number, number];

const colorCache = new Map<string, RGB>();

export function toRGB(color: any): RGB {
  if (Array.isArray(color)) {
    // Manim rgb arrays are 0..1 floats.
    return [color[0] * 255, color[1] * 255, color[2] * 255];
  }
  const key = String(color);
  let rgb = colorCache.get(key);
  if (!rgb) {
    try {
      const [r, g, b] = chroma(key).rgb();
      rgb = [r, g, b];
    } catch {
      rgb = [255, 255, 255];
    }
    colorCache.set(key, rgb);
  }
  return rgb;
}

export function toHex(color: any): string {
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  const [r, g, b] = toRGB(color);
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function lerpColor(a: any, b: any, t: number): string {
  if (a === b) return a;
  const x = toRGB(a);
  const y = toRGB(b);
  // Manim interpolates colours through squared RGB.
  const mix = (i: number) => Math.sqrt((1 - t) * x[i] * x[i] + t * y[i] * y[i]);
  return toHex([mix(0) / 255, mix(1) / 255, mix(2) / 255]);
}

export function rgba(color: any, opacity: number): string {
  const [r, g, b] = toRGB(color);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${opacity})`;
}

/** Manim's `interpolate_color` and friends as free functions. */
export const interpolate_color = lerpColor;
export function color_gradient(colors: any[], n: number): string[] {
  if (n <= 1) return [toHex(colors[0])];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (colors.length - 1);
    const k = Math.min(Math.floor(x), colors.length - 2);
    out.push(lerpColor(colors[k], colors[k + 1], x - k));
  }
  return out;
}

export function isPlain(v: any): v is Record<string, any> {
  return (
    v !== null &&
    typeof v === 'object' &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
export const snake = (s: string) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

export function camelKeys(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k in o) out[camel(k)] = o[k];
  return out;
}

/**
 * Python-style argument parsing: positional values fill `names` in order and
 * a trailing plain object supplies keyword arguments (snake_case or camelCase).
 */
export function kw<T extends Record<string, any>>(
  args: any[],
  names: string[],
  defaults: T = {} as T,
): T & Record<string, any> {
  const out: Record<string, any> = {...defaults};
  let n = args.length;
  if (n > 0 && isPlain(args[n - 1])) {
    Object.assign(out, camelKeys(args[n - 1]));
    n--;
  }
  for (let i = 0; i < n && i < names.length; i++) {
    if (args[i] !== undefined) out[names[i]] = args[i];
  }
  return out as T & Record<string, any>;
}

/** Split `[...positional, {kwargs}]`. */
export function splitKw(args: any[]): [any[], Record<string, any>] {
  if (args.length && isPlain(args[args.length - 1])) {
    return [args.slice(0, -1), camelKeys(args[args.length - 1])];
  }
  return [args, {}];
}

/** Give every camelCase method/accessor on a prototype a snake_case alias. */
export function aliasSnake(proto: object) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || !/[A-Z]/.test(name) || name.startsWith('_')) continue;
    const alias = snake(name);
    if (alias in proto) continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name)!;
    Object.defineProperty(proto, alias, desc);
  }
}

/**
 * Wrap a class so it can be called without `new`, as in Python:
 * `Circle(radius: 2)` and `new Circle({radius: 2})` are equivalent.
 */
export function callable<T extends new (...args: any[]) => any>(klass: T): T & ((...args: ConstructorParameters<T>) => InstanceType<T>) {
  return new Proxy(klass, {
    apply(target, _this, args) {
      return new target(...args);
    },
  }) as any;
}

/** Find the user's source line (in compiled scene code) for the current call. */
export function callerLine(): number | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const m = /scene-source\.js:(\d+)/.exec(stack);
  return m ? parseInt(m[1], 10) : undefined;
}
