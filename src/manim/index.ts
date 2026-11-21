/**
 * The Manim-style layer: Manim's vocabulary (mobjects, animations, `Scene`)
 * implemented on Canvas Commons.
 *
 * `api` is the flat namespace scene files get from `from manim import *`.
 * Classes in it are callable without `new`, and every method has both a
 * camelCase and a snake_case spelling.
 */
import * as animation from './animation';
import * as constants from './constants';
import * as geometry from './geometry';
import * as graphing from './graphing';
import * as mobject from './mobject';
import * as rate from './rate_functions';
import * as scene from './scene';
import * as tex from './tex';
import * as text from './text';
import {
  aliasSnake,
  average_color,
  callable,
  camel,
  color_gradient,
  color_to_rgb,
  darker,
  interpolate_color,
  invert_color,
  lighter,
  ManimColor,
  rgb_to_color,
  snake,
} from './util';
import * as vec from './vec';

export * from './animation';
export * from './constants';
export * from './geometry';
export * from './graphing';
export * from './mobject';
export * from './rate_functions';
export * from './scene';
export * from './tex';
export * from './text';
export {__op} from './vec';
export type {Vec} from './vec';

graphing.ArrowRef.klass = geometry.Arrow;

/** A tiny numpy stand-in so ported scenes keep reading naturally. */
export const np = {
  pi: Math.PI,
  e: Math.E,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  arctan: Math.atan,
  arctan2: Math.atan2,
  arcsin: Math.asin,
  arccos: Math.acos,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  round: Math.round,
  power: Math.pow,
  radians: (deg: number) => (deg * Math.PI) / 180,
  degrees: (rad: number) => (rad * 180) / Math.PI,
  array: (a: number[]) => [...a],
  zeros: (n: number) => new Array(n).fill(0),
  ones: (n: number) => new Array(n).fill(1),
  max: (a: number[]) => Math.max(...a),
  min: (a: number[]) => Math.min(...a),
  sum: (a: number[]) => a.reduce((s, v) => s + v, 0),
  mean: (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length,
  argmin: (a: number[]) => a.reduce((best, v, i) => (v < a[best] ? i : best), 0),
  argmax: (a: number[]) => a.reduce((best, v, i) => (v > a[best] ? i : best), 0),
  cross: (a: vec.Vec, b: vec.Vec): vec.Vec => [
    a[1] * (b[2] ?? 0) - (a[2] ?? 0) * b[1],
    (a[2] ?? 0) * b[0] - a[0] * (b[2] ?? 0),
    a[0] * b[1] - a[1] * b[0],
  ],
  linspace: (a: number, b: number, n = 50) =>
    Array.from({length: n}, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1))),
  arange: (a: number, b?: number, step = 1) => {
    if (b === undefined) [a, b] = [0, a];
    const out: number[] = [];
    for (let x = a; step > 0 ? x < b - 1e-12 : x > b + 1e-12; x += step) out.push(x);
    return out;
  },
  linalg: {norm: vec.norm},
  dot: vec.dot,
};

/** Python's `range`. */
export function range(a: number, b?: number, step = 1): number[] {
  return np.arange(a, b, step);
}

/** Python's `len`: works on arrays, strings and mobjects. */
export function len(x: {length: number}): number {
  return x.length;
}

/**
 * Python's raw strings as a template tag, so TeX needs no doubled
 * backslashes: r`\frac{a}{b}` is Python's `r"\frac{a}{b}"`.
 */
export function r(strings: TemplateStringsArray, ...values: any[]): string {
  return String.raw(strings, ...values);
}

const helpers = {
  np,
  range,
  len,
  r,
  invert_color,
  average_color,
  color_to_rgb,
  rgb_to_color,
  lighter,
  darker,
  ManimColor,
  line_intersection: (a: [vec.Vec, vec.Vec], b: [vec.Vec, vec.Vec]) => {
    const d1 = vec.sub(a[1], a[0]);
    const d2 = vec.sub(b[1], b[0]);
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(det) < 1e-12) throw new Error('The lines are parallel, there is no unique intersection point.');
    const t = ((b[0][0] - a[0][0]) * d2[1] - (b[0][1] - a[0][1]) * d2[0]) / det;
    return [a[0][0] + d1[0] * t, a[0][1] + d1[1] * t, 0];
  },
  angle_between_vectors: (a: vec.Vec, b: vec.Vec) =>
    Math.acos(Math.max(-1, Math.min(1, vec.dot(vec.normalize(a), vec.normalize(b))))),
  interpolate: (a: any, b: any, t: number) =>
    Array.isArray(a) ? vec.lerp(a, b, t) : a + (b - a) * t,
  normalize: vec.normalize,
  rotate_vector: (v: vec.Vec, angle: number) => vec.rotate(v, angle),
  angle_of_vector: vec.angleOf,
  get_norm: vec.norm,
  midpoint: vec.midpoint,
  interpolate_color,
  color_gradient,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  abs: Math.abs,
};

function isClass(v: any): boolean {
  return typeof v === 'function' && /^class\s/.test(Function.prototype.toString.call(v));
}

function build(): Record<string, any> {
  const out: Record<string, any> = {};
  const modules: Record<string, any>[] = [constants, rate, mobject, geometry, text, tex, graphing, animation, scene, helpers];
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (name.startsWith('_') || name === 'MobNode' || name === 'ArrowRef') continue;
      let v = value;
      if (isClass(value)) {
        const proto = (value as any).prototype;
        const instantiable =
          proto instanceof mobject.Mobject ||
          value === mobject.Mobject ||
          proto instanceof animation.Animation ||
          value === animation.Animation;
        (value as any).displayName = name;
        // Every class gets snake_case spellings of the methods it introduces.
        aliasSnake(proto);
        if (instantiable) v = callable(value as any);
      }
      out[name] = v;
      // Function helpers get the other spelling too.
      if (typeof value === 'function' && !isClass(value)) {
        out[camel(name)] ??= v;
        out[snake(name)] ??= v;
      }
    }
  }
  out.__op = vec.__op;
  return out;
}

export const api: Record<string, any> = build();
export const apiNames: string[] = Object.keys(api).filter(n => /^[A-Za-z_$][\w$]*$/.test(n));
