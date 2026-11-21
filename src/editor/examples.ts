/** Example scenes bundled with the editor (the `examples/` directory). */
export interface Example {
  slug: string;
  title: string;
  description: string;
  style: 'manim' | 'canvas-commons';
  source?: string;
  order: number;
  code: string;
  /** The Manim (Python) original, for Manim-style examples. */
  python?: string;
  /** The Motion Canvas / Canvas Commons TSX original, for native examples. */
  tsx?: string;
}

import raw from 'virtual:examples';

export const examples: Example[] = raw
  .map(({slug, code, python, tsx, meta}) => ({
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? '',
    style: meta.style ?? 'manim',
    source: meta.source,
    order: meta.order ?? 500,
    code,
    python,
    tsx,
  }))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export const BLANK_MANIM = `from manim import *

class MyScene extends Scene
  construct()
    title := Text "Hello!"
    @play Write title
    @wait()
`;

export const BLANK_NATIVE = `import { makeScene2D, Circle } from "@canvas-commons/2d"
import { createRef } from "@canvas-commons/core"

export default makeScene2D (view) ->
  circle := createRef<Circle>()
  view.add <Circle ref={circle} size={240} fill="#58c4dd" />

  yield* circle().scale 2, 1
  yield* circle().scale 1, 1
`;

export const BLANK_NATIVE_TSX = `import {makeScene2D, Circle} from '@canvas-commons/2d';
import {createRef} from '@canvas-commons/core';

export default makeScene2D(function* (view) {
  const circle = createRef<Circle>();
  view.add(<Circle ref={circle} size={240} fill="#58c4dd" />);

  yield* circle().scale(2, 1);
  yield* circle().scale(1, 1);
});
`;
