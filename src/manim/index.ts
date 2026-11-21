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
import {callable, camel, color_gradient, interpolate_color, snake} from './util';
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
  array: (a: number[]) => [...a],
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

const helpers = {
  np,
  range,
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
