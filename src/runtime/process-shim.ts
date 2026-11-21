// Civet's ESM build reads `process.env` at load time; browsers have no `process`.
const g = globalThis as any;
g.process ??= {env: {}};
export {};
