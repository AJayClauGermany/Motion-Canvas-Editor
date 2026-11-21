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

export function invert_color(color: any): string {
  const [r, g, b] = toRGB(color);
  return toHex([1 - r / 255, 1 - g / 255, 1 - b / 255]);
}
/** Blend toward white (`lighter`) or black (`darker`), like `ManimColor.lighter()`. */
export function lighter(color: any, blend = 0.2): string {
  const [r, g, b] = toRGB(color);
  const mix = (v: number) => (v + (255 - v) * blend) / 255;
  return toHex([mix(r), mix(g), mix(b)]);
}
export function darker(color: any, blend = 0.2): string {
  const [r, g, b] = toRGB(color);
  const mix = (v: number) => (v * (1 - blend)) / 255;
  return toHex([mix(r), mix(g), mix(b)]);
}
export function average_color(...colors: any[]): string {
  const list = colors.flat().map(toRGB);
  const mean = (i: number) => list.reduce((s, c) => s + c[i], 0) / list.length / 255;
  return toHex([mean(0), mean(1), mean(2)]);
}
/** `[r, g, b]` floats in 0..1, as Manim's `color_to_rgb`. */
export function color_to_rgb(color: any): number[] {
  const [r, g, b] = toRGB(color);
  return [r / 255, g / 255, b / 255];
}
export function rgb_to_color(rgb: number[]): string {
  return toHex(rgb);
}
/** `ManimColor("#ff0000")` or `ManimColor([1, 0, 0])` → the hex string used here. */
export function ManimColor(value: any): string {
  return toHex(value);
}

/**
 * Colours are plain hex strings in this implementation, so the handful of
 * `ManimColor` methods that scenes use (`BLUE.lighter()`, `RED.interpolate(...)`)
 * are provided as non-enumerable string methods.
 */
const colorMethods: Record<string, (this: string, ...args: any[]) => any> = {
  lighter(blend = 0.2) {
    return lighter(String(this), blend);
  },
  darker(blend = 0.2) {
    return darker(String(this), blend);
  },
  interpolate(other: any, alpha: number) {
    return lerpColor(String(this), other, alpha);
  },
  invert() {
    return invert_color(String(this));
  },
  to_hex() {
    return toHex(String(this));
  },
  to_rgb() {
    return color_to_rgb(String(this));
  },
};
for (const name of Object.keys(colorMethods)) {
  if (!(name in String.prototype)) {
    Object.defineProperty(String.prototype, name, {
      value: colorMethods[name],
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
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

/**
 * Give every camelCase method/accessor on a prototype a snake_case alias.
 *
 * Aliases dispatch by name at call time, so a subclass that overrides
 * `getEnd` also changes `get_end`. Method aliases come back bound to their
 * object: like a Python bound method, `dot.get_center` can be handed around
 * (`TracedPath(dot.get_center)`, `always(label.next_to, dot)`).
 */
export function aliasSnake(proto: object) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || !/[A-Z]/.test(name) || name.startsWith('_')) continue;
    const alias = snake(name);
    if (alias in proto) continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name)!;
    if (typeof desc.value === 'function') {
      Object.defineProperty(proto, alias, {
        get(this: any) {
          return this[name].bind(this);
        },
        set(this: any, value: any) {
          Object.defineProperty(this, alias, {value, writable: true, configurable: true, enumerable: true});
        },
        configurable: true,
      });
    } else if (desc.get || desc.set) {
      Object.defineProperty(proto, alias, {
        get(this: any) {
          return this[name];
        },
        set(this: any, value: any) {
          this[name] = value;
        },
        configurable: true,
      });
    }
  }
}

/** snake_case accessors for camelCase instance fields (`x_range` → `xRange`). */
export function aliasFields(proto: object, fields: string[]) {
  for (const field of fields) {
    const alias = snake(field);
    if (alias === field || alias in proto) continue;
    Object.defineProperty(proto, alias, {
      get(this: any) {
        return this[field];
      },
      set(this: any, value: any) {
        this[field] = value;
      },
      configurable: true,
    });
  }
}

/**
 * Wrap a class so it can be called without `new`, as in Python:
 * `Circle(radius: 2)` and `new Circle({radius: 2})` are equivalent.
 */
export function callable<T extends new (...args: any[]) => any>(klass: T): T & ((...args: ConstructorParameters<T>) => InstanceType<T>) {
  return new Proxy(klass, {
    apply(target, _this, args) {
      return isJsxCall(args) ? fromJsx(target, args[0]) : new target(...args);
    },
  }) as any;
}

/**
 * Canvas Commons' JSX runtime calls a non-node component as
 * `type({...props, ref, children, key})`, always with those three keys.
 */
function isJsxCall(args: any[]): boolean {
  const props = args[0];
  return args.length === 1 && isPlain(props) && 'ref' in props && 'children' in props && 'key' in props;
}

const isMobjectLike = (v: any) => !!v && typeof v === 'object' && typeof v.getFamily === 'function';

/**
 * `<Circle radius={2} color={BLUE} />` — attributes are the keyword
 * arguments. Children that are mobjects become submobjects; any other child
 * (text, a number) is a positional argument, so `<Text>Hi</Text>`
 * and `<MathTex>{"a"}{"+"}{"b"}</MathTex>` read naturally. `ref` receives the
 * instance, which makes Canvas Commons' `createRef` work.
 */
function fromJsx(target: new (...args: any[]) => any, jsxProps: Record<string, any>): any {
  const {ref, children, key: _key, ...props} = jsxProps;
  const kids = (Array.isArray(children) ? children.flat(Infinity) : [children]).filter(
    (c: any) => c !== undefined && c !== null && c !== false && c !== true,
  );
  const positional = kids
    .filter((c: any) => !isMobjectLike(c))
    .map((c: any) => (typeof c === 'string' ? c.trim() : c))
    .filter((c: any) => c !== '');
  const submobjects = kids.filter(isMobjectLike);
  for (const name of Object.keys(props)) if (props[name] === undefined) delete props[name];
  const instance = new target(...positional, props);
  if (submobjects.length) instance.add(...submobjects);
  if (typeof ref === 'function') ref(instance);
  return instance;
}

let sceneFrame = /scene-source\.js:(\d+)/;

/**
 * Tell `callerLine` how frames of the evaluated scene module look in a stack
 * trace. The default matches the `sourceURL` the editor gives scene code;
 * engines that ignore `sourceURL` get the URL the code was loaded from.
 */
export function setSceneSourceMarker(marker: string): void {
  sceneFrame = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`);
}

export const sceneFrameMarker = (): RegExp => sceneFrame;

/** Find the user's source line (in compiled scene code) for the current call. */
export function callerLine(): number | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const m = sceneFrame.exec(stack);
  return m ? parseInt(m[1], 10) : undefined;
}
