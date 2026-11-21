/**
 * Minimal numpy-flavoured vector helpers. Points are plain `[x, y, z]` arrays,
 * as in Manim, so `UP`, `get_center()` and friends interoperate with user math.
 */
export type Vec = number[];

export const vec = (x = 0, y = 0, z = 0): Vec => [x, y, z];

export function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], (a[2] ?? 0) + (b[2] ?? 0)];
}
export function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)];
}
export function mul(a: Vec, s: number): Vec {
  return [a[0] * s, a[1] * s, (a[2] ?? 0) * s];
}
export function neg(a: Vec): Vec {
  return [-a[0], -a[1], -(a[2] ?? 0)];
}
export function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + (a[2] ?? 0) * (b[2] ?? 0);
}
export function norm(a: Vec): number {
  return Math.hypot(a[0], a[1], a[2] ?? 0);
}
export function normalize(a: Vec): Vec {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : mul(a, 1 / n);
}
export function lerp(a: Vec, b: Vec, t: number): Vec {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t,
  ];
}
export function dist(a: Vec, b: Vec): number {
  return norm(sub(a, b));
}
export function eq(a: Vec, b: Vec, tol = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
}
/** Rotate counter-clockwise (Manim convention, y up) about the z axis. */
export function rotate(a: Vec, angle: number, about: Vec = [0, 0, 0]): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = a[0] - about[0];
  const y = a[1] - about[1];
  return [about[0] + x * c - y * s, about[1] + x * s + y * c, a[2] ?? 0];
}
export function angleOf(a: Vec): number {
  return Math.atan2(a[1], a[0]);
}
export function midpoint(a: Vec, b: Vec): Vec {
  return lerp(a, b, 0.5);
}

/* ------------------------------------------------------------------ *
 * Operator overloading runtime.
 *
 * The scene compiler can rewrite `a + b` into `__op.add(a, b)` so that
 * `2 * UP + LEFT` works the way it does with numpy in Manim. Numbers take the
 * native fast path. Arrays broadcast element-wise.
 * ------------------------------------------------------------------ */
type Operand = number | Vec | string | {__add?: Function} | any;

function broadcast(
  a: Operand,
  b: Operand,
  fn: (x: number, y: number) => number,
): any {
  const aa = Array.isArray(a);
  const ba = Array.isArray(b);
  if (aa && ba) {
    const n = Math.max(a.length, b.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = broadcast(a[i] ?? 0, b[i] ?? 0, fn);
    return out;
  }
  if (aa) return a.map((x: any) => broadcast(x, b, fn));
  if (ba) return b.map((y: any) => broadcast(a, y, fn));
  return fn(a, b);
}

export const __op = {
  add(a: any, b: any) {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (Array.isArray(a) || Array.isArray(b)) {
      // string + array keeps JS semantics (template building, debugging)
      if (typeof a === 'string' || typeof b === 'string') return a + b;
      return broadcast(a, b, (x, y) => x + y);
    }
    return a + b;
  },
  sub(a: any, b: any) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (Array.isArray(a) || Array.isArray(b))
      return broadcast(a, b, (x, y) => x - y);
    return a - b;
  },
  mul(a: any, b: any) {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    if (Array.isArray(a) || Array.isArray(b))
      return broadcast(a, b, (x, y) => x * y);
    return a * b;
  },
  div(a: any, b: any) {
    if (typeof a === 'number' && typeof b === 'number') return a / b;
    if (Array.isArray(a) || Array.isArray(b))
      return broadcast(a, b, (x, y) => x / y);
    return a / b;
  },
  neg(a: any): any {
    if (Array.isArray(a)) return a.map((x: any) => __op.neg(x));
    return -a;
  },
};
