declare module 'virtual:examples' {
  const examples: {
    slug: string;
    code: string;
    python?: string;
    meta: {
      title?: string;
      description?: string;
      style?: 'manim' | 'canvas-commons';
      source?: string;
      order?: number;
    };
  }[];
  export default examples;
}
