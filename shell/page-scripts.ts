// JavaScript source strings that the shell runs inside the webview. They are
// plain strings (not bundled modules) so the web build stays untouched, and
// they must not assume anything about the page they run in.

/**
 * Preload: forwards uncaught errors, unhandled rejections and failed
 * script/style/image loads to the main process. Electrobun only forwards
 * `console.*` (and only in dev builds), which misses all three.
 */
export const pageErrorReporter = `(() => {
  const send = (detail) => {
    const msg = Object.assign({type: 'shell:page-error', url: location.href}, detail);
    try {
      window.__electrobunSendToHost(msg);
    } catch {
      console.error('[shell:page-error]', JSON.stringify(msg));
    }
  };
  const describe = (reason) =>
    reason instanceof Error ? {message: reason.name + ': ' + reason.message, stack: reason.stack} : {message: String(reason)};
  window.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (el && el !== window && el.tagName) {
        send({kind: 'resource', message: 'failed to load <' + el.tagName.toLowerCase() + '> ' + (el.src || el.href || '')});
      } else {
        send(Object.assign({kind: 'error', source: e.filename + ':' + e.lineno + ':' + e.colno}, describe(e.error ?? e.message)));
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    send(Object.assign({kind: 'unhandledrejection'}, describe(e.reason)));
  });
})();`;

/**
 * Checks the web platform features the editor relies on and reports the
 * result to the main process. Only run on request (MCE_SHELL_PROBE=1).
 */
export const capabilityProbe = `(() => {
  const attempt = (fn) => {
    try {
      return fn();
    } catch (err) {
      return 'threw ' + err;
    }
  };
  const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => c.width + 'x' + c.height);
  window.__electrobunSendToHost({
    type: 'shell:probe',
    url: location.href,
    userAgent: navigator.userAgent,
    newFunction: attempt(() => new Function('a', 'b', 'return a + b')(2, 3) === 5),
    eval: attempt(() => (0, eval)('6 * 7') === 42),
    secureContext: window.isSecureContext,
    cryptoSubtle: attempt(() => !!crypto.subtle),
    clipboard: attempt(() => !!navigator.clipboard),
    canvas2d: attempt(() => !!document.createElement('canvas').getContext('2d')),
    localStorage: attempt(() => {
      localStorage.setItem('__shell_probe', '1');
      const ok = localStorage.getItem('__shell_probe') === '1';
      localStorage.removeItem('__shell_probe');
      return ok;
    }),
    mediaRecorder: attempt(() => typeof MediaRecorder === 'function'),
    mediaRecorderTypes: attempt(() =>
      ['video/webm', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4', 'video/mp4;codecs=avc1.42E01E'].filter((t) =>
        MediaRecorder.isTypeSupported(t),
      ),
    ),
    captureStream: attempt(() => typeof HTMLCanvasElement.prototype.captureStream === 'function'),
    canvases,
    harness: typeof window.harness,
    bodyText: (document.body.innerText || '').slice(0, 200),
  });
})();`;
