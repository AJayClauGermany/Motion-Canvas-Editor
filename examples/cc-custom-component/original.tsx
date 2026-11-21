import {
  Circle,
  Node,
  NodeProps,
  Rect,
  colorSignal,
  initial,
  makeScene2D,
  signal,
} from '@canvas-commons/2d';
import {
  Color,
  ColorSignal,
  PossibleColor,
  SignalValue,
  SimpleSignal,
  all,
  createRef,
  createSignal,
  easeInOutCubic,
  tween,
  waitFor,
} from '@canvas-commons/core';

export interface SwitchProps extends NodeProps {
  initialState?: SignalValue<boolean>;
  accent?: SignalValue<PossibleColor>;
}

export class Switch extends Node {
  @initial(false)
  @signal()
  declare public readonly initialState: SimpleSignal<boolean, this>;

  @initial('#68ABDF')
  @colorSignal()
  declare public readonly accent: ColorSignal<this>;

  private isOn: boolean;
  private readonly indicatorPosition = createSignal(0);
  private readonly offColor = new Color('#242424');
  private readonly indicator = createRef<Circle>();
  private readonly container = createRef<Rect>();

  public constructor(props?: SwitchProps) {
    super({
      ...props,
    });

    this.isOn = this.initialState();
    this.indicatorPosition(this.isOn ? 50 : -50);

    this.add(
      <Rect
        ref={this.container}
        fill={this.isOn ? this.accent() : this.offColor}
        size={[200, 100]}
        radius={100}
      >
        <Circle
          x={() => this.indicatorPosition()}
          ref={this.indicator}
          size={[80, 80]}
          fill="#ffffff"
        />
      </Rect>,
    );
  }

  public *toggle(duration: number) {
    yield* all(
      tween(duration, value => {
        const oldColor = this.isOn ? this.accent() : this.offColor;
        const newColor = this.isOn ? this.offColor : this.accent();

        this.container().fill(
          Color.lerp(oldColor, newColor, easeInOutCubic(value)),
        );
      }),

      tween(duration, value => {
        const currentPos = this.indicator().position();

        this.indicatorPosition(
          easeInOutCubic(value, currentPos.x, this.isOn ? -50 : 50),
        );
      }),
    );
    this.isOn = !this.isOn;
  }
}

export default makeScene2D(function* (view) {
  const switchRef = createRef<Switch>();

  view.add(<Switch ref={switchRef} initialState={true} />);

  yield* switchRef().toggle(0.6);
  yield* waitFor(1);
  yield* switchRef().toggle(0.6);
  yield* waitFor(1);
});
