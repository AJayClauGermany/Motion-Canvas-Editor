/**
 * Cubic Bézier helpers. A VMobject stores its outline the way Manim Community
 * does: a flat list of points, four per cubic curve (anchor, handle, handle,
 * anchor). A new subpath starts wherever a curve does not begin at the
 * previous curve's end.
 */
import {Vec, lerp, eq, dist} from './vec';

export type Points = Vec[];

export function lineToCubic(a: Vec, b: Vec): Points {
  return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
}

/** Points for a polyline through `corners` (not closed automatically). */
export function cornersToPoints(corners: Vec[]): Points {
  const out: Points = [];
  for (let i = 0; i < corners.length - 1; i++) {
    out.push(...lineToCubic(corners[i], corners[i + 1]));
  }
  return out;
}

/** Bézier approximation of a circular arc, split into `n` cubic pieces. */
export function arcPoints(
  startAngle: number,
  angle: number,
  radius = 1,
  center: Vec = [0, 0, 0],
  n = 8,
): Points {
  const out: Points = [];
  const step = angle / n;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const a0 = startAngle + i * step;
    const a1 = a0 + step;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    out.push(
      [center[0] + radius * c0, center[1] + radius * s0, 0],
      [center[0] + radius * (c0 - k * s0), center[1] + radius * (s0 + k * c0), 0],
      [center[0] + radius * (c1 + k * s1), center[1] + radius * (s1 - k * c1), 0],
      [center[0] + radius * c1, center[1] + radius * s1, 0],
    );
  }
  return out;
}

/**
 * Handles for a smooth curve through `anchors` (Manim's
 * `get_smooth_cubic_bezier_handle_points`): a C2 cubic spline, natural at the
 * ends of an open path and periodic for a closed one. Returns cubic points.
 */
export function smoothPoints(anchors: Vec[]): Points {
  const n = anchors.length - 1;
  if (n < 1) return [];
  if (n === 1) return lineToCubic(anchors[0], anchors[1]);
  const closed = eq(anchors[0], anchors[n], 1e-9);
  const h1: Vec[] = new Array(n);
  const h2: Vec[] = new Array(n);
  for (let k = 0; k < 2; k++) {
    const P = (i: number) => anchors[i][k];
    let x: number[];
    if (closed && n > 2) {
      // Periodic system: x[i-1] + 4 x[i] + x[i+1] = 4 P[i] + 2 P[i+1].
      const rhs = new Array(n);
      for (let i = 0; i < n; i++) rhs[i] = 4 * P(i) + 2 * P(i + 1);
      x = solveCyclic(n, rhs);
    } else {
      // Natural spline, solved with the Thomas algorithm.
      const a = new Array(n).fill(1);
      const b = new Array(n).fill(4);
      const c = new Array(n).fill(1);
      const d = new Array(n);
      b[0] = 2;
      d[0] = P(0) + 2 * P(1);
      for (let i = 1; i < n - 1; i++) d[i] = 4 * P(i) + 2 * P(i + 1);
      a[n - 1] = 2;
      b[n - 1] = 7;
      d[n - 1] = 8 * P(n - 1) + P(n);
      x = solveTridiagonal(a, b, c, d);
    }
    for (let i = 0; i < n; i++) {
      (h1[i] ??= [0, 0, 0])[k] = x[i];
      const next = closed && n > 2 ? x[(i + 1) % n] : i < n - 1 ? x[i + 1] : NaN;
      (h2[i] ??= [0, 0, 0])[k] = Number.isNaN(next) ? (P(n) + x[n - 1]) / 2 : 2 * P(i + 1) - next;
    }
  }
  const out: Points = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = anchors[i];
    out[i * 4 + 1] = h1[i];
    out[i * 4 + 2] = h2[i];
    out[i * 4 + 3] = anchors[i + 1];
  }
  return out;
}

function solveTridiagonal(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = d.length;
  const cp = new Array(n);
  const dp = new Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/** Solve the cyclic system with rows (1, 4, 1) via Sherman-Morrison. */
function solveCyclic(n: number, rhs: number[]): number[] {
  const gamma = -4;
  const a = new Array(n).fill(1);
  const b = new Array(n).fill(4);
  const c = new Array(n).fill(1);
  b[0] = 4 - gamma;
  b[n - 1] = 4 - 1 / gamma;
  const u = new Array(n).fill(0);
  u[0] = gamma;
  u[n - 1] = 1;
  const y = solveTridiagonal(a, b, c, rhs);
  const q = solveTridiagonal(a, b, c, u);
  const f = (y[0] + y[n - 1] / gamma) / (1 + q[0] + q[n - 1] / gamma);
  return y.map((v, i) => v - f * q[i]);
}

/** Re-flow every subpath's handles: smooth spline or straight segments. */
export function changeAnchorMode(points: Points, mode: 'smooth' | 'jagged'): Points {
  const out: Points = [];
  for (const sub of splitSubpaths(points)) {
    const anchors: Vec[] = [];
    for (let i = 0; i < sub.length; i += 4) anchors.push(sub[i]);
    anchors.push(sub[sub.length - 1]);
    const next = mode === 'smooth' ? smoothPoints(anchors) : cornersToPoints(anchors);
    for (const p of next) out.push(p);
  }
  return out;
}

const lengthCache = new WeakMap<Points, {lengths: number[]; total: number}>();

/** Approximate arc length of every curve (cached per points array). */
export function curveLengths(points: Points): {lengths: number[]; total: number} {
  let hit = lengthCache.get(points);
  if (hit) return hit;
  const n = points.length / 4;
  const lengths: number[] = new Array(n);
  let total = 0;
  const SAMPLES = 8;
  for (let i = 0; i < n; i++) {
    const p0 = points[i * 4];
    const p1 = points[i * 4 + 1];
    const p2 = points[i * 4 + 2];
    const p3 = points[i * 4 + 3];
    let px = p0[0];
    let py = p0[1];
    let l = 0;
    for (let k = 1; k <= SAMPLES; k++) {
      const t = k / SAMPLES;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      const x = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
      const y = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
      l += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    lengths[i] = l;
    total += l;
  }
  hit = {lengths, total};
  lengthCache.set(points, hit);
  return hit;
}

/** Point at arc-length proportion `alpha` along the whole outline. */
export function pointAtProportion(points: Points, alpha: number): Vec | null {
  const n = points.length / 4;
  if (n === 0) return null;
  const {lengths, total} = curveLengths(points);
  let target = Math.max(0, Math.min(1, alpha)) * total;
  for (let i = 0; i < n; i++) {
    if (target <= lengths[i] || i === n - 1) {
      return bezierPoint(points, i * 4, lengths[i] === 0 ? 0 : Math.min(1, target / lengths[i]));
    }
    target -= lengths[i];
  }
  return points[points.length - 1];
}

export function bezierPoint(c: Points, i: number, t: number): Vec {
  const p0 = c[i];
  const p1 = c[i + 1];
  const p2 = c[i + 2];
  const p3 = c[i + 3];
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * p0[0] + b * p1[0] + d * p2[0] + e * p3[0],
    a * p0[1] + b * p1[1] + d * p2[1] + e * p3[1],
    0,
  ];
}

/** The portion of one cubic curve between parameters `a` and `b`. */
export function partialBezier(c: Vec[], a: number, b: number): Points {
  if (a === 1) return [c[3], c[3], c[3], c[3]];
  // de Casteljau: cut at b, then at a/b of the first part.
  const split = (p: Vec[], t: number): [Vec[], Vec[]] => {
    const p01 = lerp(p[0], p[1], t);
    const p12 = lerp(p[1], p[2], t);
    const p23 = lerp(p[2], p[3], t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const mid = lerp(p012, p123, t);
    return [
      [p[0], p01, p012, mid],
      [mid, p123, p23, p[3]],
    ];
  };
  const [head] = split(c, b);
  if (a <= 0) return head;
  const [, tail] = split(head, b === 0 ? 0 : a / b);
  return tail;
}

/** Manim's `pointwise_become_partial`: uniform in curve index, not arc length. */
export function partialPoints(points: Points, a: number, b: number): Points {
  const n = points.length / 4;
  if (n === 0) return [];
  if (a <= 0 && b >= 1) return points;
  if (b <= a) {
    const i = Math.min(Math.floor(a * n), n - 1) * 4;
    const p = bezierPoint(points, i, Math.min(a * n - i / 4, 1));
    return [p, p, p, p];
  }
  const lowerIndex = Math.min(Math.floor(a * n), n - 1);
  const upperIndex = Math.min(Math.floor(b * n), n - 1);
  const lowerRes = a * n - lowerIndex;
  const upperRes = b >= 1 ? 1 : b * n - upperIndex;
  const curve = (i: number) => points.slice(i * 4, i * 4 + 4);
  if (lowerIndex === upperIndex) {
    return partialBezier(curve(lowerIndex), lowerRes, upperRes);
  }
  const out: Points = [];
  out.push(...partialBezier(curve(lowerIndex), lowerRes, 1));
  for (let i = lowerIndex + 1; i < upperIndex; i++) out.push(...curve(i));
  out.push(...partialBezier(curve(upperIndex), 0, upperRes));
  return out;
}

export function splitSubpaths(points: Points): Points[] {
  const out: Points[] = [];
  let current: Points = [];
  for (let i = 0; i < points.length; i += 4) {
    if (current.length && !eq(current[current.length - 1], points[i])) {
      out.push(current);
      current = [];
    }
    current.push(points[i], points[i + 1], points[i + 2], points[i + 3]);
  }
  if (current.length) out.push(current);
  return out;
}

/** Subdivide curves (longest first, proportionally) to add `n` more curves. */
export function insertCurves(points: Points, n: number): Points {
  const count = points.length / 4;
  if (n <= 0) return points;
  if (count === 0) return points;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const l = dist(points[i * 4], points[i * 4 + 3]);
    lengths.push(l);
    total += l;
  }
  // Distribute the target curve count over the existing curves.
  const target = count + n;
  const splits = new Array(count).fill(1);
  if (total < 1e-9) {
    for (let i = 0; i < n; i++) splits[i % count]++;
  } else {
    let assigned = count;
    const ideal = lengths.map(l => (l / total) * target);
    while (assigned < target) {
      let best = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < count; i++) {
        const score = ideal[i] - splits[i];
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      splits[best]++;
      assigned++;
    }
  }
  const out: Points = [];
  for (let i = 0; i < count; i++) {
    const c = points.slice(i * 4, i * 4 + 4);
    const k = splits[i];
    for (let j = 0; j < k; j++) out.push(...partialBezier(c, j / k, (j + 1) / k));
  }
  return out;
}

/** Make two outlines structurally identical so they can be interpolated. */
export function alignPoints(a: Points, b: Points): [Points, Points] {
  if (a.length === b.length && a.length > 0) {
    const sa = splitSubpaths(a);
    const sb = splitSubpaths(b);
    if (sa.length === sb.length && sa.every((s, i) => s.length === sb[i].length)) {
      return [a, b];
    }
  }
  const degenerate = (ref: Points): Points => {
    const p = ref.length ? ref[ref.length - 1] : [0, 0, 0];
    return [p, p, p, p];
  };
  if (a.length === 0) a = degenerate(b.length ? centroidPoints(b) : []);
  if (b.length === 0) b = degenerate(centroidPoints(a));
  const sa = splitSubpaths(a);
  const sb = splitSubpaths(b);
  const n = Math.max(sa.length, sb.length);
  const outA: Points = [];
  const outB: Points = [];
  for (let i = 0; i < n; i++) {
    let pa = sa[i] ?? degenerate(sa[sa.length - 1]);
    let pb = sb[i] ?? degenerate(sb[sb.length - 1]);
    const ca = pa.length / 4;
    const cb = pb.length / 4;
    if (ca < cb) pa = insertCurves(pa, cb - ca);
    else if (cb < ca) pb = insertCurves(pb, ca - cb);
    outA.push(...pa);
    outB.push(...pb);
  }
  return [outA, outB];
}

function centroidPoints(points: Points): Points {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const c = [x / points.length, y / points.length, 0];
  return [c, c, c, c];
}

export function lerpPoints(a: Points, b: Points, t: number): Points {
  const out: Points = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    out[i] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0];
  }
  return out;
}

/** Parse SVG path data into Manim-style cubic points (y kept as given). */
export function svgPathToPoints(d: string): Points {
  const out: Points = [];
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let cur: Vec = [0, 0, 0];
  let start: Vec = [0, 0, 0];
  let lastCtrl: Vec | null = null;
  let lastCmd = '';
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = (): Vec => {
      const x = num();
      const y = num();
      return rel ? [cur[0] + x, cur[1] + y, 0] : [x, y, 0];
    };
    switch (C) {
      case 'M': {
        cur = pt();
        start = cur;
        cmd = rel ? 'l' : 'L';
        lastCtrl = null;
        break;
      }
      case 'L': {
        const p = pt();
        out.push(...lineToCubic(cur, p));
        cur = p;
        break;
      }
      case 'H': {
        const x = num();
        const p: Vec = [rel ? cur[0] + x : x, cur[1], 0];
        out.push(...lineToCubic(cur, p));
        cur = p;
        break;
      }
      case 'V': {
        const y = num();
        const p: Vec = [cur[0], rel ? cur[1] + y : y, 0];
        out.push(...lineToCubic(cur, p));
        cur = p;
        break;
      }
      case 'C': {
        const c1 = pt();
        const c2 = pt();
        const p = pt();
        out.push(cur, c1, c2, p);
        lastCtrl = c2;
        cur = p;
        break;
      }
      case 'S': {
        const c1: Vec =
          lastCtrl && 'CS'.includes(lastCmd)
            ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1], 0]
            : cur;
        const c2 = pt();
        const p = pt();
        out.push(cur, c1, c2, p);
        lastCtrl = c2;
        cur = p;
        break;
      }
      case 'Q': {
        const q = pt();
        const p = pt();
        out.push(cur, lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastCtrl = q;
        cur = p;
        break;
      }
      case 'T': {
        const q: Vec =
          lastCtrl && 'QT'.includes(lastCmd)
            ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1], 0]
            : cur;
        const p = pt();
        out.push(cur, lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastCtrl = q;
        cur = p;
        break;
      }
      case 'Z': {
        if (!eq(cur, start)) out.push(...lineToCubic(cur, start));
        cur = start;
        break;
      }
      default:
        // Arcs are not produced by MathJax; skip their arguments safely.
        while (isNum()) i++;
    }
    lastCmd = C;
  }
  return out;
}
