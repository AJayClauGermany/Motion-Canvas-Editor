declare module 'chroma-js' {
  interface Color {
    rgb(): [number, number, number];
    hex(): string;
  }
  const chroma: (color: string | number | number[]) => Color;
  export default chroma;
}
