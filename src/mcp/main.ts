#!/usr/bin/env bun
/**
 * MCP server for the Motion Canvas Editor.
 *
 *   bun run mcp            stdio, for agents that launch their MCP servers
 *   bun run mcp:http       Streamable HTTP on http://127.0.0.1:5275/mcp
 *
 * Either way the process also hosts (or joins) the hub the editor page
 * connects to. See docs/agents.md.
 */
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {DEFAULT_HUB_PORT} from './protocol';
import {autoLink, startHub} from './hub';
import {createMcpServer} from './server';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag('help')) {
  console.error(`Motion Canvas Editor MCP server

  bun run mcp [--port N]          serve MCP over stdio (what agent configs launch)
  bun run mcp --http [--port N]   serve MCP over HTTP at http://127.0.0.1:N/mcp

The editor connects to the same port when "Agent" is on in its top bar.
Environment: MCE_HUB_PORT (default ${DEFAULT_HUB_PORT}), MCE_EDITOR_ORIGINS (comma-separated extra editor origins).`);
  process.exit(0);
}

const port = Number(option('port') ?? process.env.MCE_HUB_PORT ?? DEFAULT_HUB_PORT);
const editorOrigins = (process.env.MCE_EDITOR_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
// stdout carries the MCP protocol in stdio mode: log to stderr only.
const log = (message: string) => console.error(`[mce-mcp] ${message}`);

if (flag('http')) {
  try {
    const hub = startHub({port, editorOrigins, log, createServer: () => createMcpServer(hub)});
    log(`MCP over HTTP at http://127.0.0.1:${hub.port}/mcp; the editor connects to ws://127.0.0.1:${hub.port}/editor`);
  } catch (e) {
    log(`could not listen on port ${port}: ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  const link = autoLink({port, editorOrigins, log, createServer: () => createMcpServer(link)});
  const server = createMcpServer(link);
  await server.connect(new StdioServerTransport());
  const shutdown = () => {
    link.stop();
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
