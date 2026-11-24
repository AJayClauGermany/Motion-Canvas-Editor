/**
 * The harness page (`harness.html?agent`) in a hidden iframe: a second engine
 * next to the editor's own. Agent checks and exports run there, so the user's
 * preview, playhead and selection never move, and it keeps working while the
 * editor tab is in the background.
 */
export interface Harness {
  frame: HTMLIFrameElement;
  /** `window.harnessAgent` of the page (see src/harness.ts). */
  agent: any;
  dispose(): void;
}

export function loadHarness(query: Record<string, string | number> = {}): Promise<Harness> {
  const frame = document.createElement('iframe');
  const params = new URLSearchParams({agent: '1'});
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  frame.src = new URL(`harness.html?${params}`, location.href).href;
  frame.title = 'Preview sandbox';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off-screen but rendered: a `display: none` frame gets no canvas updates in some engines.
  Object.assign(frame.style, {position: 'fixed', left: '-10000px', top: '0', width: '960px', height: '540px', border: '0', opacity: '0', pointerEvents: 'none'});
  document.body.append(frame);
  const dispose = () => frame.remove();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      const agent = (frame.contentWindow as any)?.harnessAgent;
      if (agent) return resolve({frame, agent, dispose});
      if (performance.now() - started > 30_000) {
        dispose();
        return reject(new Error('The preview sandbox (harness.html) did not load. The single-file build does not include it.'));
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}
