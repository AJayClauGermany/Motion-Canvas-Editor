import {describe, expect, test} from 'bun:test';
import {
  __op,
  add,
  angleOf,
  dist,
  dot,
  eq,
  lerp,
  midpoint,
  mul,
  neg,
  norm,
  normalize,
  rotate,
  sub,
  vec,
} from '../src/manim/vec';

const UP = [0, 1, 0];
const RIGHT = [1, 0, 0];
const LEFT = [-1, 0, 0];

describe('vector helpers', () => {
  test('arithmetic returns new 3-vectors', () => {
    const a = [1, 2, 3];
    expect(add(a, [1, 1, 1])).toEqual([2, 3, 4]);
    expect(sub(a, [1, 1, 1])).toEqual([0, 1, 2]);
    expect(mul(a, 2)).toEqual([2, 4, 6]);
    expect(neg(a)).toEqual([-1, -2, -3]);
    expect(a).toEqual([1, 2, 3]);
  });

  test('2-vectors are treated as z = 0', () => {
    expect(add([1, 2], [3, 4])).toEqual([4, 6, 0]);
    expect(norm([3, 4])).toBe(5);
    expect(dot([1, 2], [3, 4, 5])).toBe(11);
  });

  test('vec() defaults to the origin', () => {
    expect(vec()).toEqual([0, 0, 0]);
    expect(vec(1, 2)).toEqual([1, 2, 0]);
  });

  test('norm, dist and normalize', () => {
    expect(norm([3, 4, 12])).toBe(13);
    expect(dist([1, 1, 0], [4, 5, 0])).toBe(5);
    expect(normalize([0, 5, 0])).toEqual([0, 1, 0]);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test('lerp and midpoint', () => {
    expect(lerp([0, 0, 0], [2, 4, 6], 0.25)).toEqual([0.5, 1, 1.5]);
    expect(midpoint(LEFT, RIGHT)).toEqual([0, 0, 0]);
  });

  test('rotate is counter-clockwise with y up', () => {
    const r = rotate(RIGHT, Math.PI / 2);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
    const about = rotate([2, 0, 0], Math.PI, [1, 0, 0]);
    expect(about[0]).toBeCloseTo(0);
    expect(about[1]).toBeCloseTo(0);
  });

  test('angleOf', () => {
    expect(angleOf(UP)).toBeCloseTo(Math.PI / 2);
    expect(angleOf(LEFT)).toBeCloseTo(Math.PI);
    expect(angleOf([1, -1, 0])).toBeCloseTo(-Math.PI / 4);
  });

  test('eq compares x and y within a tolerance', () => {
    expect(eq([1, 2, 0], [1 + 1e-9, 2, 0])).toBe(true);
    expect(eq([1, 2, 0], [1.01, 2, 0])).toBe(false);
    expect(eq([1, 2, 0], [1.01, 2, 0], 0.1)).toBe(true);
  });
});

describe('operator overloading runtime', () => {
  test('plain numbers keep native semantics', () => {
    expect(__op.add(1, 2)).toBe(3);
    expect(__op.sub(1, 2)).toBe(-1);
    expect(__op.mul(3, 4)).toBe(12);
    expect(__op.div(1, 4)).toBe(0.25);
    expect(__op.neg(5)).toBe(-5);
  });

  test('2 * UP + LEFT', () => {
    expect(__op.add(__op.mul(2, UP), LEFT)).toEqual([-1, 2, 0]);
  });

  test('scalars broadcast on either side', () => {
    expect(__op.mul(UP, 3)).toEqual([0, 3, 0]);
    expect(__op.div(UP, 2)).toEqual([0, 0.5, 0]);
    expect(__op.sub(1, [1, 2, 3])).toEqual([0, -1, -2]);
    expect(__op.add([1, 2, 3], 1)).toEqual([2, 3, 4]);
    expect(__op.div(6, [1, 2, 3])).toEqual([6, 3, 2]);
  });

  test('vectors combine element-wise', () => {
    expect(__op.sub([4, 3, 0], [1, 1, 0])).toEqual([3, 2, 0]);
    expect(__op.mul([1, 2, 3], [2, 2, 2])).toEqual([2, 4, 6]);
    expect(__op.neg(UP)).toEqual([-0, -1, -0]);
  });

  test('shorter vectors are padded with zeros', () => {
    expect(__op.add([1, 2], [1, 1, 1])).toEqual([2, 3, 1]);
  });

  test('nested arrays broadcast like numpy', () => {
    expect(__op.mul([[1, 2], [3, 4]], 2)).toEqual([[2, 4], [6, 8]]);
    expect(__op.add([[1, 2], [3, 4]], [[1, 1], [1, 1]])).toEqual([[2, 3], [4, 5]]);
  });

  test('strings concatenate as in JavaScript', () => {
    expect(__op.add('a', 'b')).toBe('ab');
    expect(__op.add('n = ', 3)).toBe('n = 3');
    expect(__op.add('p: ', [1, 2])).toBe('p: 1,2');
  });

  test('operands are not mutated', () => {
    const a = [1, 2, 3];
    __op.add(a, a);
    __op.mul(a, 5);
    expect(a).toEqual([1, 2, 3]);
  });
});
