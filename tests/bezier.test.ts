import {describe, expect, test} from 'bun:test';
import {
  alignPoints,
  arcPoints,
  bezierPoint,
  changeAnchorMode,
  cornersToPoints,
  curveLengths,
  insertCurves,
  lerpPoints,
  lineToCubic,
  partialBezier,
  partialPoints,
  pointAtProportion,
  Points,
  smoothPoints,
  splitSubpaths,
  svgPathToPoints,
} from '../src/manim/bezier';
import type {Vec} from '../src/manim/vec';

const close = (a: Vec, b: Vec, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
/** Sample every curve of an outline at a few parameters. */
const sample = (points: Points, per = 5): Vec[] => {
  const out: Vec[] = [];
  for (let i = 0; i < points.length; i += 4) {
    for (let k = 0; k <= per; k++) out.push(bezierPoint(points, i, k / per));
  }
  return out;
};
const square: Vec[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
];

describe('building outlines', () => {
  test('lineToCubic puts the handles at thirds', () => {
    const c = lineToCubic([0, 0, 0], [3, 6, 0]);
    expect(c).toEqual([
      [0, 0, 0],
      [1, 2, 0],
      [2, 4, 0],
      [3, 6, 0],
    ]);
  });

  test('cornersToPoints makes one cubic per segment and does not close', () => {
    const pts = cornersToPoints(square);
    expect(pts.length).toBe(16);
    expect(pts[0]).toEqual([1, 1, 0]);
    expect(pts[15]).toEqual([1, 1, 0]);
    expect(cornersToPoints([[0, 0, 0]])).toEqual([]);
  });

  test('arcPoints stays on the circle and ends where asked', () => {
    const pts = arcPoints(0, Math.PI / 2, 2, [1, 1, 0], 4);
    expect(pts.length).toBe(16);
    close(pts[0], [3, 1, 0]);
    close(pts[15], [1, 3, 0]);
    for (const p of sample(pts)) expect(Math.hypot(p[0] - 1, p[1] - 1)).toBeCloseTo(2, 4);
  });

  test('a negative angle goes clockwise', () => {
    const pts = arcPoints(0, -Math.PI / 2, 1);
    close(pts[pts.length - 1], [0, -1, 0]);
  });
});

describe('evaluating and cutting', () => {
  const curve: Points = [
    [0, 0, 0],
    [1, 2, 0],
    [3, 2, 0],
    [4, 0, 0],
  ];

  test('bezierPoint hits the anchors and the midpoint', () => {
    close(bezierPoint(curve, 0, 0), [0, 0, 0]);
    close(bezierPoint(curve, 0, 1), [4, 0, 0]);
    close(bezierPoint(curve, 0, 0.5), [2, 1.5, 0]);
  });

  test('partialBezier traces the same curve between the two parameters', () => {
    const part = partialBezier(curve, 0.25, 0.75);
    close(part[0], bezierPoint(curve, 0, 0.25));
    close(part[3], bezierPoint(curve, 0, 0.75));
    close(bezierPoint(part, 0, 0.5), bezierPoint(curve, 0, 0.5));
    expect(partialBezier(curve, 0, 1)).toEqual(curve);
  });

  test('partialPoints is uniform in curve index, like Manim', () => {
    const pts = cornersToPoints(square); // 4 curves
    const half = partialPoints(pts, 0, 0.5);
    expect(half.length).toBe(12); // two whole curves and a degenerate cut
    close(half[7], [-1, -1, 0]);
    const piece = partialPoints(pts, 0.125, 0.375);
    close(piece[0], [0, 1, 0]);
    close(piece[piece.length - 1], [-1, 0, 0]);
  });

  test('partialPoints returns the same array for the full range (keeps path caches valid)', () => {
    const pts = cornersToPoints(square);
    expect(partialPoints(pts, 0, 1)).toBe(pts);
    expect(partialPoints([], 0, 0.5)).toEqual([]);
  });

  test('an empty range collapses to a single point', () => {
    const pts = cornersToPoints(square);
    const dot = partialPoints(pts, 0.5, 0.5);
    expect(dot.length).toBe(4);
    for (const p of dot) close(p, [-1, -1, 0]);
  });

  test('splitSubpaths breaks where a curve does not continue the previous one', () => {
    const a = lineToCubic([0, 0, 0], [1, 0, 0]);
    const b = lineToCubic([1, 0, 0], [1, 1, 0]);
    const c = lineToCubic([5, 5, 0], [6, 5, 0]);
    const subs = splitSubpaths([...a, ...b, ...c]);
    expect(subs.map(s => s.length)).toEqual([8, 4]);
  });
});

describe('aligning outlines for transforms', () => {
  test('insertCurves adds curves without changing the shape', () => {
    const pts = cornersToPoints(square);
    const more = insertCurves(pts, 5);
    expect(more.length).toBe(pts.length + 20);
    // Every sampled point still lies on the square's boundary.
    for (const p of sample(more)) {
      expect(Math.max(Math.abs(p[0]), Math.abs(p[1]))).toBeCloseTo(1, 6);
    }
    close(more[0], pts[0]);
    close(more[more.length - 1], pts[pts.length - 1]);
    expect(insertCurves(pts, 0)).toBe(pts);
  });

  test('insertCurves splits long curves before short ones', () => {
    const pts = [...lineToCubic([0, 0, 0], [9, 0, 0]), ...lineToCubic([9, 0, 0], [10, 0, 0])];
    const more = insertCurves(pts, 2);
    // Both new curves come from the long segment.
    const anchors = more.filter((_, i) => i % 4 === 0).map(p => p[0]);
    expect(anchors).toEqual([0, 3, 6, 9]);
  });

  test('alignPoints gives both outlines the same structure', () => {
    const tri = cornersToPoints([
      [0, 1, 0],
      [-1, -1, 0],
      [1, -1, 0],
      [0, 1, 0],
    ]);
    const circle = arcPoints(0, 2 * Math.PI, 1, [0, 0, 0], 8);
    const [a, b] = alignPoints(tri, circle);
    expect(a.length).toBe(b.length);
    expect(b).toEqual(circle);
    expect(splitSubpaths(a).length).toBe(1);
  });

  test('alignPoints pads missing subpaths and empty outlines', () => {
    const one = lineToCubic([0, 0, 0], [1, 0, 0]);
    const two = [...one, ...lineToCubic([3, 3, 0], [4, 3, 0])];
    const [a, b] = alignPoints(one, two);
    expect(a.length).toBe(b.length);
    const [c, d] = alignPoints([], two);
    expect(c.length).toBe(d.length);
    expect(c.length).toBeGreaterThan(0);
  });

  test('aligned outlines are returned untouched', () => {
    const p = cornersToPoints(square);
    const q = cornersToPoints(square.map(v => [v[0] * 2, v[1] * 2, 0]));
    const [a, b] = alignPoints(p, q);
    expect(a).toBe(p);
    expect(b).toBe(q);
  });

  test('lerpPoints interpolates point by point', () => {
    const p = lineToCubic([0, 0, 0], [3, 0, 0]);
    const q = lineToCubic([0, 2, 0], [3, 4, 0]);
    const mid = lerpPoints(p, q, 0.5);
    close(mid[0], [0, 1, 0]);
    close(mid[3], [3, 2, 0]);
    expect(mid).not.toBe(p);
  });
});

describe('smooth curves', () => {
  const anchors: Vec[] = [
    [0, 0, 0],
    [1, 2, 0],
    [3, 3, 0],
    [4, 0, 0],
    [6, 1, 0],
  ];

  test('smoothPoints passes through every anchor', () => {
    const pts = smoothPoints(anchors);
    expect(pts.length).toBe((anchors.length - 1) * 4);
    anchors.slice(0, -1).forEach((a, i) => close(pts[i * 4], a));
    close(pts[pts.length - 1], anchors[anchors.length - 1]);
  });

  test('tangents are continuous at interior anchors', () => {
    const pts = smoothPoints(anchors);
    for (let i = 1; i < anchors.length - 1; i++) {
      const before = pts[i * 4 - 2]; // second handle of the previous curve
      const after = pts[i * 4 + 1]; // first handle of the next curve
      const a = anchors[i];
      close([a[0] - before[0], a[1] - before[1], 0], [after[0] - a[0], after[1] - a[1], 0]);
    }
  });

  test('collinear, evenly spaced anchors stay a straight line', () => {
    const pts = smoothPoints([
      [0, 0, 0],
      [1, 1, 0],
      [2, 2, 0],
      [3, 3, 0],
    ]);
    for (const p of sample(pts)) expect(p[1]).toBeCloseTo(p[0], 9);
  });

  test('a closed loop is smooth across its seam', () => {
    const loop: Vec[] = [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0],
      [1, 0, 0],
    ];
    const pts = smoothPoints(loop);
    const last = pts[pts.length - 2];
    const first = pts[1];
    close([1 - last[0], 0 - last[1], 0], [first[0] - 1, first[1] - 0, 0]);
    // A spline through four points of a circle is close to that circle.
    for (const p of sample(pts)) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(0.9);
    for (const p of sample(pts)) expect(Math.hypot(p[0], p[1])).toBeLessThan(1.1);
  });

  test('two anchors give a straight segment, one gives nothing', () => {
    expect(smoothPoints([[0, 0, 0], [3, 0, 0]])).toEqual(lineToCubic([0, 0, 0], [3, 0, 0]));
    expect(smoothPoints([[0, 0, 0]])).toEqual([]);
  });

  test('changeAnchorMode round-trips corners and keeps subpaths apart', () => {
    const two = [...cornersToPoints(anchors), ...lineToCubic([9, 9, 0], [10, 9, 0])];
    const smooth = changeAnchorMode(two, 'smooth');
    expect(smooth.length).toBe(two.length);
    expect(splitSubpaths(smooth).length).toBe(2);
    const jagged = changeAnchorMode(smooth, 'jagged');
    jagged.forEach((p, i) => close(p, two[i]));
  });
});

describe('arc length', () => {
  test('a circle is 2πr long', () => {
    const circle = arcPoints(0, 2 * Math.PI, 2, [0, 0, 0], 8);
    expect(curveLengths(circle).total).toBeCloseTo(4 * Math.PI, 1);
    expect(curveLengths(circle)).toBe(curveLengths(circle)); // cached per array
  });

  test('pointAtProportion walks by distance, not by curve index', () => {
    const pts = [...lineToCubic([0, 0, 0], [9, 0, 0]), ...lineToCubic([9, 0, 0], [10, 0, 0])];
    close(pointAtProportion(pts, 0.5)!, [5, 0, 0], 4);
    close(pointAtProportion(pts, 0)!, [0, 0, 0]);
    close(pointAtProportion(pts, 1)!, [10, 0, 0]);
    close(pointAtProportion(pts, 2)!, [10, 0, 0]); // clamped
    expect(pointAtProportion([], 0.5)).toBeNull();
  });

  test('a quarter of the way round a circle', () => {
    const circle = arcPoints(0, 2 * Math.PI, 1, [0, 0, 0], 8);
    close(pointAtProportion(circle, 0.25)!, [0, 1, 0], 3);
    close(pointAtProportion(circle, 0.5)!, [-1, 0, 0], 3);
  });
});

describe('svgPathToPoints', () => {
  test('absolute lines and close', () => {
    const pts = svgPathToPoints('M0 0 L2 0 L2 2 Z');
    expect(pts.length).toBe(12);
    close(pts[0], [0, 0, 0]);
    close(pts[7], [2, 2, 0]);
    close(pts[11], [0, 0, 0]);
  });

  test('relative commands, H/V and implicit repeats', () => {
    const pts = svgPathToPoints('m1 1 h2 v3 l-1,-1 -1 -1');
    const ends = pts.filter((_, i) => i % 4 === 3);
    expect(ends).toEqual([
      [3, 1, 0],
      [3, 4, 0],
      [2, 3, 0],
      [1, 2, 0],
    ]);
  });

  test('cubics keep their control points, quadratics are raised', () => {
    const cubic = svgPathToPoints('M0 0 C1 2 3 2 4 0');
    expect(cubic).toEqual([
      [0, 0, 0],
      [1, 2, 0],
      [3, 2, 0],
      [4, 0, 0],
    ]);
    const quad = svgPathToPoints('M0 0 Q2 2 4 0');
    close(bezierPoint(quad, 0, 0.5), [2, 1, 0]);
  });

  test('smooth cubic reflects the previous control point', () => {
    const pts = svgPathToPoints('M0 0 C0 1 1 1 2 0 S4 -1 4 0');
    close(pts[5], [3, -1, 0]);
  });

  test('compact number formats: exponents and signs without separators', () => {
    const pts = svgPathToPoints('M0 0l1e1-2.5.5.5');
    const ends = pts.filter((_, i) => i % 4 === 3);
    close(ends[0], [10, -2.5, 0]);
    close(ends[1], [10.5, -2, 0]);
  });

  test('a new M starts a new subpath', () => {
    const pts = svgPathToPoints('M0 0 L1 0 M5 5 L6 5');
    expect(splitSubpaths(pts).length).toBe(2);
  });
});
