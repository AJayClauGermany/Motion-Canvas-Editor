/** Manim rate functions: map progress in [0, 1] to eased progress. */
export type RateFunc = (t: number) => number;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const linear: RateFunc = t => t;

export function smooth(t: number, inflection = 10): number {
  const error = sigmoid(-inflection / 2);
  return Math.min(
    Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0),
    1,
  );
}
export const smoothstep: RateFunc = t => (t <= 0 ? 0 : t >= 1 ? 1 : 3 * t * t - 2 * t * t * t);
export const smootherstep: RateFunc = t =>
  t <= 0 ? 0 : t >= 1 ? 1 : 6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3;
export const rush_into: RateFunc = t => 2 * smooth(t / 2);
export const rush_from: RateFunc = t => 2 * smooth(t / 2 + 0.5) - 1;
export const slow_into: RateFunc = t => Math.sqrt(1 - (1 - t) * (1 - t));
export const double_smooth: RateFunc = t =>
  t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1));
export const there_and_back: RateFunc = t => smooth(t < 0.5 ? 2 * t : 2 * (1 - t));
export function there_and_back_with_pause(t: number, pauseRatio = 1 / 3): number {
  const a = 1 / pauseRatio;
  if (t < 0.5 - pauseRatio / 2) return smooth(a * t);
  if (t < 0.5 + pauseRatio / 2) return 1;
  return smooth(a - a * t);
}
export const running_start = (t: number, pullFactor = -0.5): number => {
  // bezier([0, 0, pull, pull, 1, 1, 1])
  const pts = [0, 0, pullFactor, pullFactor, 1, 1, 1];
  const n = pts.length - 1;
  let out = 0;
  let c = 1;
  for (let k = 0; k <= n; k++) {
    out += c * (1 - t) ** (n - k) * t ** k * pts[k];
    c = (c * (n - k)) / (k + 1);
  }
  return out;
};
export const wiggle = (t: number, wiggles = 2): number =>
  there_and_back(t) * Math.sin(wiggles * Math.PI * t);
export const lingering: RateFunc = t => squish_rate_func(x => x, 0, 0.8)(t);
export const exponential_decay = (t: number, halfLife = 0.1): number =>
  1 - Math.exp(-t / halfLife);
export function squish_rate_func(func: RateFunc, a = 0.4, b = 0.6): RateFunc {
  return t => {
    if (a === b) return a;
    if (t < a) return func(0);
    if (t > b) return func(1);
    return func((t - a) / (b - a));
  };
}
export const not_quite_there =
  (func: RateFunc = smooth, proportion = 0.7): RateFunc =>
  t =>
    proportion * func(t);

export const ease_in_sine: RateFunc = t => 1 - Math.cos((t * Math.PI) / 2);
export const ease_out_sine: RateFunc = t => Math.sin((t * Math.PI) / 2);
export const ease_in_out_sine: RateFunc = t => -(Math.cos(Math.PI * t) - 1) / 2;
export const ease_in_quad: RateFunc = t => t * t;
export const ease_out_quad: RateFunc = t => 1 - (1 - t) * (1 - t);
export const ease_in_out_quad: RateFunc = t =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export const ease_in_cubic: RateFunc = t => t ** 3;
export const ease_out_cubic: RateFunc = t => 1 - (1 - t) ** 3;
export const ease_in_out_cubic: RateFunc = t =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export const ease_in_expo: RateFunc = t => (t === 0 ? 0 : 2 ** (10 * t - 10));
export const ease_out_expo: RateFunc = t => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
export const ease_out_back: RateFunc = t => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const ease_in_back: RateFunc = t => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t ** 3 - c1 * t * t;
};
export const ease_out_bounce: RateFunc = t => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
export const ease_out_elastic: RateFunc = t => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
