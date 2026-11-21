import {describe, expect, test} from 'bun:test';
import {callable} from '../src/manim/util';

/** Stand-in with the two things `callable` relies on: a constructor and `add`. */
class Fake {
  public args: unknown[];
  public submobjects: Fake[] = [];
  public constructor(...args: unknown[]) {
    this.args = args;
  }
  public add(...mobs: Fake[]) {
    this.submobjects.push(...mobs);
    return this;
  }
  public getFamily() {
    return [this, ...this.submobjects];
  }
}
const Shape = callable(Fake);
/** What Canvas Commons' JSX runtime passes to a non-node component. */
const jsx = (props: Record<string, unknown>, children?: unknown, ref?: unknown) =>
  (Shape as any)({...props, ref, children, key: undefined});

describe('mobjects as JSX', () => {
  test('a plain call is unchanged', () => {
    const m = (Shape as any)(2, {color: 'red'});
    expect(m).toBeInstanceOf(Fake);
    expect(m.args).toEqual([2, {color: 'red'}]);
  });

  test('attributes become keyword arguments', () => {
    expect(jsx({radius: 2, color: 'red'}).args).toEqual([{radius: 2, color: 'red'}]);
  });

  test('undefined attributes are dropped so defaults apply', () => {
    expect(jsx({radius: undefined, color: 'red'}).args).toEqual([{color: 'red'}]);
  });

  test('mobject children become submobjects, including nested lists', () => {
    const a = new Fake();
    const b = new Fake();
    const c = new Fake();
    const group = jsx({}, [a, [b, [c]], null, false]);
    expect(group.submobjects).toEqual([a, b, c]);
    expect(group.args).toEqual([{}]);
  });

  test('other children are positional arguments', () => {
    expect(jsx({font_size: 40}, '  Hello  ').args).toEqual(['Hello', {font_size: 40}]);
    expect(jsx({}, ['a^2', '+', 'b^2']).args).toEqual(['a^2', '+', 'b^2', {}]);
  });

  test('ref receives the instance', () => {
    let seen: unknown;
    const m = jsx({}, undefined, (value: unknown) => (seen = value));
    expect(seen).toBe(m);
  });
});
