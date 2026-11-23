#!/usr/bin/env bun
/**
 * Minimal MCP client for trying the editor's MCP server by hand or in tests.
 *
 *   bun tools/mcp-client.ts list                       # tools, prompts, resources
 *   bun tools/mcp-client.ts call <tool> '<json args>'  # call a tool, print text, save images
 *   MCE_MCP_URL=http://127.0.0.1:5275/mcp bun tools/mcp-client.ts …   # over HTTP instead of stdio
 *
 * Images are written to artifacts/mcp/<tool>-<n>.png.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dir, '..');
const [command = 'list', name, rawArgs] = process.argv.slice(2);
const client = new Client({name: 'mce-test-client', version: '0.0.1'});
const url = process.env.MCE_MCP_URL;
const transport = url
  ? new StreamableHTTPClientTransport(new URL(url))
  : // The SDK passes only a safe subset of the environment by default; MCE_* settings must reach the server.
    new StdioClientTransport({command: 'bun', args: [join(root, 'src/mcp/main.ts')], stderr: 'inherit', env: process.env as Record<string, string>});
await client.connect(transport);

if (command === 'list') {
  const info = client.getInstructions();
  if (info) console.log(`Instructions:\n${info}\n`);
  for (const t of (await client.listTools()).tools) console.log(`tool ${t.name}: ${t.description?.split('. ')[0]}`);
  for (const p of (await client.listPrompts()).prompts) console.log(`prompt ${p.name}: ${p.description}`);
  for (const r of (await client.listResources()).resources) console.log(`resource ${r.uri}`);
} else if (command === 'call' && name) {
  const result = await client.callTool({name, arguments: rawArgs ? JSON.parse(rawArgs) : {}});
  let n = 0;
  for (const part of result.content as any[]) {
    if (part.type === 'text') console.log(part.text);
    else if (part.type === 'image') {
      const dir = join(root, 'artifacts', 'mcp');
      mkdirSync(dir, {recursive: true});
      const file = join(dir, `${name}-${n++}.png`);
      writeFileSync(file, Buffer.from(part.data, 'base64'));
      console.log(`[image saved to ${file}]`);
    }
  }
  if (result.isError) process.exitCode = 1;
} else {
  console.error('usage: bun tools/mcp-client.ts list | call <tool> [json]');
  process.exitCode = 2;
}
await client.close();
