import {describe, expect, test} from 'bun:test';
import * as rate from '../src/manim/rate_functions';

describe('rate functions', () => {
  const eased = Object.entries(rate).filter(
    ([name, fn]) => typeof fn === 'function' && fn.length === 1 && !['squish_rate_func', 'not_quite_there'].includes(name),
  ) as [string, (t: number) => number][];

  test('there are plenty of them', () => {
    expect(eased.length).toBeGreaterThan(30);
  });

  test.each(eased.filter(([name]) => !/there_and_back|wiggle|lingering|exponential_decay/.test(name)))('%s runs from 0 to 1', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0, 6);
    expect(fn(1)).toBeCloseTo(1, 6);
    for (let t = 0; t <= 1; t += 0.05) expect(Number.isFinite(fn(t))).toBe(true);
  });

  test('smooth is symmetric and monotonic', () => {
    expect(rate.smooth(0.5)).toBeCloseTo(0.5, 9);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = rate.smooth(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(rate.smooth(0.25) + rate.smooth(0.75)).toBeCloseTo(1, 9);
  });

  test('there_and_back returns to the start', () => {
    expect(rate.there_and_back(0)).toBeCloseTo(0);
    expect(rate.there_and_back(0.5)).toBeCloseTo(1);
    expect(rate.there_and_back(1)).toBeCloseTo(0);
    expect(rate.there_and_back_with_pause(0.5)).toBe(1);
  });

  test('squish_rate_func compresses a function into a window', () => {
    const f = rate.squish_rate_func(rate.linear, 0.25, 0.75);
    expect(f(0.1)).toBe(0);
    expect(f(0.5)).toBeCloseTo(0.5);
    expect(f(0.9)).toBe(1);
  });

  test('running_start dips below zero first', () => {
    expect(rate.running_start(0.2)).toBeLessThan(0);
    expect(rate.running_start(1)).toBeCloseTo(1);
  });
});
