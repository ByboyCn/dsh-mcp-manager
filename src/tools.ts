/**
 * Model-facing management tools: mcp_list / mcp_status / mcp_add /
 * mcp_update / mcp_remove / mcp_set_enabled. Registered on the tools
 * registry so every agent in this process can manage MCP servers.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RegistryError } from './registry.ts'
import type { McpManager, ServerView } from './manager.ts'

/** Project a server view for model output (compact, stable field order). */
function project(server: ServerView): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: server.id,
    transport: server.transport,
    enabled: server.enabled,
    status: server.status,
    toolCount: server.toolNames.length,
    tools: server.toolNames,
  }
  if (server.description !== undefined) out.description = server.description
  if (server.command !== undefined) {
    out.command = server.command
    if (server.args !== undefined) out.args = server.args
  }
  if (server.url !== undefined) out.url = server.url
  if (server.error !== undefined) out.error = server.error
  return out
}

const idParam = { type: 'string' as const, required: true as const, description: 'Server id (namespace); tools appear as mcp__<id>__<tool>. [A-Za-z0-9_-]{1,32}' }

const entryParams = {
  id: idParam,
  transport: { type: 'string' as const, required: true as const, description: "'stdio' (local command) or 'streamable-http' (HTTP endpoint)" },
  command: { type: 'string' as const, description: 'stdio: executable to spawn, e.g. npx. Required for stdio.' },
  args: { type: 'array' as const, items: { type: 'string' as const }, description: 'stdio: arguments passed to the command.' },
  env: { type: 'object' as const, additionalProperties: true, description: 'stdio: extra environment variables (string values), e.g. API tokens.' },
  cwd: { type: 'string' as const, description: 'stdio: working directory.' },
  url: { type: 'string' as const, description: 'streamable-http: endpoint URL. Required for streamable-http.' },
  headers: { type: 'object' as const, additionalProperties: true, description: 'streamable-http: extra request headers (string values).' },
  toolCallTimeoutMs: { type: 'integer' as const, description: 'Per tool-call timeout in ms (default 60000).' },
  description: { type: 'string' as const, description: 'Optional human-facing note about this server.' },
}

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

/** Canonicalize any projection into plain JSON for the tool value. */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value))
}

/** Register the management tools; call inside `ctx.inject(['tools'], ...)`. */
export function registerManagerTools(ctx: Context, manager: McpManager): void {
  const wrap = <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<any> => {
      try {
        return await fn(args)
      } catch (error) {
        const code = error instanceof RegistryError ? ` (${error.code})` : ''
        throw new Error(`${error instanceof Error ? error.message : String(error)}${code}`)
      }
    }

  ctx.tools.register(defineTool({
    name: 'mcp_list',
    description: 'List all managed MCP servers with live status (enabled/disabled, ready/starting/error) and the tools each server currently provides. Use this before other mcp_* tools.',
    parameters: {},
    output: jsonOutput,
    execute: wrap(async () => ({ servers: manager.list().map(project) })),
  }))

  ctx.tools.register(defineTool({
    name: 'mcp_status',
    description: 'Show one managed MCP server in detail: config (secrets redacted), status, and discovered tool names. Pass no id to get every server.',
    parameters: {
      id: { type: 'string', description: 'Optional server id; omit for all servers.' },
    },
    output: jsonOutput,
    execute: wrap(async (args: { id?: string }) => {
      if (args.id === undefined || args.id === '') {
        return { servers: manager.list().map(project) }
      }
      const server = manager.get(args.id)
      if (server === undefined) throw new Error(`server ${args.id} does not exist (NOT_FOUND)`)
      return { server: project(server) }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'mcp_add',
    description: 'Add and mount a new MCP server. stdio servers need command (e.g. npx with args like ["-y","@modelcontextprotocol/server-filesystem","/tmp"]); streamable-http servers need url. The server connects immediately and its tools appear as mcp__<id>__<tool>.',
    parameters: entryParams,
    output: jsonOutput,
    execute: wrap(async (args: Record<string, unknown>) => ({ added: project(await manager.add(args)) })),
  }))

  ctx.tools.register(defineTool({
    name: 'mcp_update',
    description: 'Update an existing MCP server\'s config (command/args/env/url/headers/description/enabled...). The server is remounted with the new config; secrets previously set via env/headers are redacted in output, resend full env/headers to replace them.',
    parameters: {
      id: { ...idParam, description: 'Id of the server to update.' },
      command: entryParams.command,
      args: entryParams.args,
      env: entryParams.env,
      cwd: entryParams.cwd,
      url: entryParams.url,
      headers: entryParams.headers,
      toolCallTimeoutMs: entryParams.toolCallTimeoutMs,
      description: entryParams.description,
    },
    output: jsonOutput,
    execute: wrap(async (args: Record<string, unknown>) => ({ updated: project(await manager.update(args)) })),
  }))

  ctx.tools.register(defineTool({
    name: 'mcp_remove',
    description: 'Remove an MCP server: unmounts it (its tools disappear) and deletes it from the persisted registry.',
    parameters: { id: idParam },
    output: jsonOutput,
    execute: wrap(async (args: { id: string }) => {
      await manager.remove(args.id)
      return { removed: args.id }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'mcp_set_enabled',
    description: 'Enable or disable an MCP server without deleting it. Disabled servers stay configured but are unmounted (tools disappear); enabling remounts them.',
    parameters: {
      id: idParam,
      enabled: { type: 'boolean', required: true, description: 'true to mount, false to unmount.' },
    },
    output: jsonOutput,
    execute: wrap(async (args: { id: string; enabled: boolean }) => ({ server: project(await manager.setEnabled(args.id, args.enabled)) })),
  }))
}
