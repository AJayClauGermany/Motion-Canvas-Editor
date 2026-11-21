/** Example scenes bundled with the editor (the `examples/` directory). */
export interface Example {
  slug: string;
  title: string;
  description: string;
  style: 'manim' | 'canvas-commons';
  source?: string;
  order: number;
  code: string;
  python?: string;
}

import raw from 'virtual:examples';

export const examples: Example[] = raw
  .map(({slug, code, python, meta}) => ({
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? '',
    style: meta.style ?? 'manim',
    source: meta.source,
    order: meta.order ?? 500,
    code,
    python,
  }))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export const BLANK_MANIM = `from manim import *

class MyScene extends Scene
  construct()
    title := Text "Hello!"
    @play Write title
    @wait()
`;
