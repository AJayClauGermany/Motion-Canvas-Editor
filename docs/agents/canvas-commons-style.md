# Writing Canvas Commons-style scenes

Canvas Commons is the community fork of Motion Canvas; its API is Motion
Canvas 3's. Import from `@canvas-commons/*` (`@motion-canvas/*` imports are
accepted as aliases). lookup_api gives the signals and methods of any node
class or flow function.

## Structure

```tsx
import {makeScene2D, Rect, Txt} from '@canvas-commons/2d';
import {all, createRef, waitFor, easeInOutCubic} from '@canvas-commons/core';

export default makeScene2D(function* (view) {
  const box = createRef<Rect>();
  const label = createRef<Txt>();
  view.add(
    <Rect ref={box} width={320} height={180} radius={16} fill="#1f3a4d">
      <Txt ref={label} text="Hello" fill="#ffffff" fontSize={48} />
    </Rect>,
  );
  yield* box().position.x(-400, 1, easeInOutCubic);
  yield* all(box().rotation(90, 0.8), label().opacity(0.3, 0.8));
  yield* waitFor(0.5);
});
```

The same in Civet: `makeScene2D (view) ->` with an indented body, `box :=
createRef<Rect>()`, `yield* box().position.x -400, 1, easeInOutCubic`.

## Rules

- The scene function must be a generator (`function*`; in Civet any function
  containing `yield` is one).
- **Each top-level `yield*` statement is one timeline step**, labelled with
  what it runs (`position.x`, `all`, `waitFor`) and tied to its line.
- Nodes are JSX. Keep handles with `createRef<T>()` and `ref={r}`, then call
  `r()` to get the node.
- Every property is a signal: `node().x()` reads, `node().x(100)` sets,
  `node().x(100, 1)` returns a 1-second tween that does nothing until you
  `yield*` it. `.to(v, s)` chains another tween.
- Signals accept functions to stay in sync: `<Txt text={() => `${count()}`} />`
  with `const count = createSignal(0)`.
- Flow: `all(...)` in parallel, `sequence(0.1, ...)` staggered, `chain(...)`
  one after another, `loop(n, i => …)`, `delay(s, task)`, `waitFor(s)`,
  `waitUntil('name')`.
- Units are pixels: the view is 1920 × 1080, origin at the centre, y down;
  rotation is in degrees, clockwise.
- Layout: give a parent `layout` and its children flow like flexbox
  (`direction`, `gap`, `padding`, `alignItems`).
- The scene is re-run from the start on every seek: no randomness without a
  seed (`useRandom()` is seeded), no state outside the scene function.

## Custom components

```tsx
import {Node, NodeProps, Rect, initial, signal} from '@canvas-commons/2d';
import {SignalValue, SimpleSignal} from '@canvas-commons/core';

export interface SwitchProps extends NodeProps {
  initialState?: SignalValue<boolean>;
}
export class Switch extends Node {
  @initial(false) @signal()
  declare public readonly isOn: SimpleSignal<boolean, this>;
  public constructor(props?: SwitchProps) {
    super({...props});
    this.add(<Rect width={100} height={50} fill={() => (this.isOn() ? '#68ABDF' : '#444')} />);
  }
}
```

In Civet, decorators are written `@@signal()`. See get_example
`cc-custom-component`.

## Mobjects in a native scene

`const m = useManim(view)` gives the scene Manim's `play`, `wait`, `add` and
camera; import the Manim names from `'manim'`. A mobject can also be the
child of a node (`<Rect><Circle radius={1} /></Rect>`), where its Manim
coordinates are relative to the node. read_docs topic `mixing`, example
`mix-mobjects-in-native`.
