// Markdown imported as text (`import doc from './x.md' with {type: 'text'}`), a Bun feature.
declare module '*.md' {
  const text: string;
  export default text;
}
