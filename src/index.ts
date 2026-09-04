/**
 * dsh-mcp-manager host entry: owns the MCP server registry, mounts each
 * enabled server as a dsh-mcp-client child fiber, exposes management tools
 * on ctx.tools and JSON routes on webServer for the Web GUI panel.
 */

import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpManager } from './manager.ts'
import { registerManagerTools } from './tools.ts'
import { mountManagerRoutes } from './http.ts'

export const name = 'dsh-mcp-manager'
export const inject = ['tools']

/** Optional cordis.yml configuration (currently unused; reserved). */
export interface Config {}

function trace(tag: string, detail?: unknown): void {
  const dir = process.env.DSH_MCP_MANAGER_TRACE
  if (dir === undefined || dir === '') return
  try {
    appendFileSync(join(dir, '.mcp-manager-trace.log'),
      `${new Date().toISOString()} [${tag}] ${detail === undefined ? '' : String(detail)}\n`)
  } catch { /* trace is best-effort */ }
}

export function apply(ctx: Context, _config: Config = {}): void {
  trace('apply:start')
  try {
    const manager = new McpManager(ctx)
    registerManagerTools(ctx, manager)
    trace('tools:registered')

    // The web GUI routes only exist on hosts that compose a webServer
    // (web / desktop profiles); nested inject keeps headless/sdk working.
    ctx.inject(['webServer'], (webCtx: Context) => {
      trace('webServer:inject-fired')
      try {
        mountManagerRoutes(webCtx, manager)
        trace('routes:mounted')
      } catch (error) {
        trace('routes:error', error)
        throw error
      }
    })

    // Mount persisted servers once the plugin tree is up; failures are logged
    // per server and never block the host (dsh-mcp-client keeps
    // failOnStartupError: false).
    void manager.init().then(
      () => trace('init:done'),
      error => {
        trace('init:error', error)
        ctx.logger.error(`mcp-manager: failed to load registry: %s`, String(error))
      },
    )
  } catch (error) {
    trace('apply:error', error)
    throw error
  }
}
