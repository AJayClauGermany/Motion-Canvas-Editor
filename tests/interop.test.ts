import {describe, expect, test} from 'bun:test';
import {config, UP} from '../src/manim/constants';
import {
  applyInverse,
  applyMatrix,
  differs,
  px,
  reconcile,
  similarity,
  to_pixels,
  to_units,
  toDegrees,
  toRadians,
  units,
} from '../src/manim/interop_math';
import {callable, hooks, isThread} from '../src/manim/util';

describe('unit conversions', () => {
  test('one unit is the frame height in pixels over the frame height in units', () => {
    expect(config.unit).toBe(135);
    expect(units(1)).toBe(135);
    expect(px(135)).toBe(1);
    expect(px(units(2.5))).toBeCloseTo(2.5);
  });

  test('to_pixels flips y and keeps the origin at the frame centre', () => {
    expect(to_pixels([0, 0, 0])).toEqual([0, 0]);
    expect(to_pixels([2, 1, 0])).toEqual([270, -135]);
    expect(to_pixels(UP)).toEqual([0, -135]);
  });

  test('to_units accepts [x, y] and Vector2-like objects', () => {
    expect(to_units([270, -135])).toEqual([2, 1, 0]);
    expect(to_units({x: -135, y: 270})).toEqual([-1, -2, 0]);
  });

  test('round trip', () => {
    const p = [-3.25, 1.5, 0];
    const back = to_units(to_pixels(p));
    expect(back[0]).toBeCloseTo(p[0]);
    expect(back[1]).toBeCloseTo(p[1]);
    expect(back[2]).toBe(0);
  });

  test('angles: radians counter-clockwise ⇄ degrees clockwise', () => {
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(-90);
    expect(toRadians(30)).toBeCloseTo(-Math.PI / 6);
    expect(toRadians(toDegrees(1.234))).toBeCloseTo(1.234);
  });
});

describe('which side of a wrapped node is out of date', () => {
  test('nothing changed', () => {
    expect(reconcile(false, false)).toBe('none');
  });
  test('the mobject changed: push to the node', () => {
    expect(reconcile(false, true)).toBe('push');
  });
  test('the node changed: pull into the mobject', () => {
    expect(reconcile(true, false)).toBe('pull');
  });
  test('both changed: the native side wins', () => {
    expect(reconcile(true, true)).toBe('pull');
  });
  test('a value that also depends on parent transforms is re-read when idle', () => {
    expect(reconcile(false, false, true)).toBe('pull');
    expect(reconcile(false, true, true)).toBe('push');
  });
  test('differs ignores rounding noise', () => {
    expect(differs(0.1 + 0.2, 0.3)).toBe(false);
    expect(differs(1, 1.001)).toBe(true);
  });
});

describe('parent transforms', () => {
  // Rotate by 90°, scale by 2, translate by (10, 20): the DOMMatrix a..f fields.
  const m = similarity({a: 0, b: 2, c: -2, d: 0, e: 10, f: 20});

  test('scale and rotation are read off the matrix', () => {
    expect(m.scale).toBeCloseTo(2);
    expect(m.rotation).toBeCloseTo(90);
  });

  test('points map forward and back', () => {
    const [x, y] = applyMatrix(m, 3, 4);
    expect([x, y]).toEqual([2, 26]);
    const [bx, by] = applyInverse(m, x, y);
    expect(bx).toBeCloseTo(3);
    expect(by).toBeCloseTo(4);
  });
});

describe('hooks the bridge fills in', () => {
  test('constructor arguments pass through toMobject', () => {
    class Group {
      public constructor(public a: unknown, public b: unknown) {}
    }
    const G = callable(Group);
    const node = {native: true};
    const wrapped = {wrapped: node};
    const before = hooks.toMobject;
    hooks.toMobject = x => (x === node ? wrapped : x);
    try {
      expect((G as any)(node, 2).a).toBe(wrapped);
      expect(new G(1, node).b).toBe(wrapped);
    } finally {
      hooks.toMobject = before;
    }
    expect(new G(node, 1).a).toBe(node);
  });

  test('isThread tells generators from animations and .animate builders', () => {
    function* tween() {
      yield;
    }
    expect(isThread(tween())).toBe(true);
    expect(isThread({runTime: 1})).toBe(false);
    expect(isThread(null)).toBe(false);
    const builder = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === '__builder') return {};
        throw new Error(`no method ${String(prop)}`);
      },
    });
    expect(isThread(builder)).toBe(false);
  });
});
