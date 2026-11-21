/**
 * The DOM-free part of the bridge between Manim mobjects and Canvas Commons
 * nodes: unit conversions and the rule that decides which side of a wrapped
 * node is out of date. `interop.ts` has the classes.
 *
 * Manim space is in units with y up; Canvas Commons space is in pixels with y
 * down. Both have their origin at the centre of the frame.
 */
import {config} from './constants';
import type {Vec} from './vec';

/** Pixels → Manim units: `px(120)` is the length of 120 pixels. */
export function px(pixels: number): number {
  return pixels / config.unit;
}

/** Manim units → pixels: `units(2)` is the pixel length of 2 units. */
export function units(length: number): number {
  return length * config.unit;
}

/** A Manim point as a Canvas Commons `[x, y]` position (pixels, y down). */
export function to_pixels(point: Vec): [number, number] {
  // `0 - y` rather than `-y`, so the centre is [0, 0] and not [0, -0].
  return [point[0] * config.unit, 0 - point[1] * config.unit];
}

/** A Canvas Commons position (`[x, y]` or a `Vector2`) as a Manim point. */
export function to_units(position: ArrayLike<number> | {x: number; y: number}): Vec {
  const p = position as any;
  const x: number = typeof p.x === 'number' ? p.x : p[0];
  const y: number = typeof p.y === 'number' ? p.y : p[1];
  return [x / config.unit, 0 - y / config.unit, 0];
}

/** Manim angle (radians, counter-clockwise) → Canvas Commons rotation (degrees, clockwise on screen). */
export const toDegrees = (radians: number): number => (-radians * 180) / Math.PI;
/** Canvas Commons rotation → Manim angle. */
export const toRadians = (degrees: number): number => (-degrees * Math.PI) / 180;

const EPSILON = 1e-9;
export const differs = (a: number, b: number): boolean => Math.abs(a - b) > EPSILON;

export type SyncAction = 'pull' | 'push' | 'none';

/**
 * A wrapped node can be driven from both sides: Manim methods change the
 * mobject's state, Canvas Commons signals change the node. This decides, for
 * one value, which side is out of date.
 *
 * - The node no longer holds what it held after the last sync: the native
 *   side moved it, so the mobject takes the node's value (`pull`). The native
 *   side wins when both changed.
 * - Otherwise, if the mobject's state changed, the node takes it (`push`).
 * - Otherwise nothing, unless the mobject's value is `derived` from more than
 *   the node's own (a node inside a native container, whose place in the
 *   frame also depends on its parents): then it is read again.
 */
export function reconcile(nodeChanged: boolean, stateChanged: boolean, derived = false): SyncAction {
  if (nodeChanged) return 'pull';
  if (stateChanged) return 'push';
  return derived ? 'pull' : 'none';
}

/** A 2D similarity (rotation, uniform scale, translation) read off a matrix. */
export interface Similarity {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** Uniform scale factor (the geometric mean when the matrix is not a similarity). */
  scale: number;
  /** Rotation in degrees, Canvas Commons convention. */
  rotation: number;
}

export function similarity(m: {a: number; b: number; c: number; d: number; e: number; f: number}): Similarity {
  return {
    a: m.a,
    b: m.b,
    c: m.c,
    d: m.d,
    e: m.e,
    f: m.f,
    scale: Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1,
    rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
  };
}

/** Map a point through a matrix. */
export function applyMatrix(m: Similarity, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** Map a point through the inverse of a matrix. */
export function applyInverse(m: Similarity, x: number, y: number): [number, number] {
  const det = m.a * m.d - m.b * m.c || 1;
  const dx = x - m.e;
  const dy = y - m.f;
  return [(m.d * dx - m.c * dy) / det, (m.a * dy - m.b * dx) / det];
}
