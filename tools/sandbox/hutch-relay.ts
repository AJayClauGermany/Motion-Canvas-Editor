// Localhost relay for Hutch inside the Claude Code cloud sandbox.
//
// Why: Hutch (Electrobun 2's Zig CLI) uses Zig std.http, which opens the
// HTTPS_PROXY CONNECT tunnel but then speaks plaintext inside it, so the
// sandbox egress proxy resets every request ("ReadFailed"). Bun's fetch uses
// the proxy correctly, so this relay accepts plain HTTP on 127.0.0.1 and
// re-fetches over HTTPS through the normal proxy (same network policy applies).
//
// URL shape: http://127.0.0.1:$PORT/<upstream-host>/<path>
// Only hosts in ALLOWED are relayed. Not needed on a normal dev machine.

const PORT = Number(process.env.HUTCH_RELAY_PORT ?? 47800);
const ALLOWED = new Set([
  "registry.npmjs.org",
  "github.com",
  "api.github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "hutch.blackboard.sh",
  "electrobun-artifacts.blackboard.sh",
  "artifacts.electrobun.dev",
]);
const BASE = `http://127.0.0.1:${PORT}`;

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const [, host, ...rest] = url.pathname.split("/");
    if (!ALLOWED.has(host)) return new Response(`host not relayed: ${host}\n`, { status: 403 });
    const upstream = `https://${host}/${rest.join("/")}${url.search}`;
    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.delete("accept-encoding"); // let Bun decode; avoid double-encoding mismatches
    const res = await fetch(upstream, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "follow",
    });
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    out.delete("transfer-encoding");
    // Rewrite absolute upstream URLs in JSON/text metadata so follow-up downloads also go via the relay.
    const type = res.headers.get("content-type") ?? "";
    if (/json|text|javascript/.test(type) || /\.(json|txt|sh)$/.test(url.pathname)) {
      let body = await res.text();
      for (const h of ALLOWED) body = body.replaceAll(`https://${h}/`, `${BASE}/${h}/`).replaceAll(`"https://${h}"`, `"${BASE}/${h}"`);
      return new Response(body, { status: res.status, headers: out });
    }
    return new Response(res.body, { status: res.status, headers: out });
  },
});
console.log(`hutch-relay listening on ${BASE}`);
