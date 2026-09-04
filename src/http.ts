/**
 * Host HTTP routes for the Web GUI panel, mounted on the webServer service
 * (same-origin with the dsh web UI). All routes are JSON, all under
 * /mcp-manager/api/.
 */

import type { Context } from '@deepseek-ai/cordis'
import { RegistryError } from './registry.ts'
import type { McpManager } from './manager.ts'

/** Structural subset of node:http types these handlers touch. */
interface RequestLike {
  method?: string
  url?: string
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

interface ResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** Structural subset of the webServer service this plugin uses. */
interface WebServerService {
  register(options: { kind: 'exact'; path: string; handler: (request: RequestLike, response: ResponseLike) => void | Promise<void> }): () => void
}

const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response: ResponseLike, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request: RequestLike): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function statusOf(error: unknown): number {
  if (error instanceof RegistryError) {
    if (error.code === 'NOT_FOUND') return 404
    if (error.code === 'DUPLICATE_ID') return 409
  }
  return 400
}

/**
 * Mount the manager API routes. Call inside `ctx.inject(['webServer'], ...)`.
 */
export function mountManagerRoutes(ctx: Context, manager: McpManager): void {
  const webServer = (ctx as unknown as { webServer: WebServerService }).webServer

  type Handler = (body: unknown, url: URL) => Promise<unknown>
  const wrap = (handler: Handler) =>
    async (request: RequestLike, response: ResponseLike): Promise<void> => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (request.method !== 'GET' && request.method !== 'POST') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        const body = request.method === 'GET' ? undefined : await readJson(request)
        sendJson(response, 200, await handler(body, url))
      } catch (error) {
        sendJson(response, statusOf(error), {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

  webServer.register({
    kind: 'exact',
    path: '/mcp-manager/api/servers',
    handler: wrap(async () => ({ servers: manager.list() })),
  })
  webServer.register({
    kind: 'exact',
    path: '/mcp-manager/api/servers/add',
    handler: wrap(async body => ({ server: await manager.add(body) })),
  })
  webServer.register({
    kind: 'exact',
    path: '/mcp-manager/api/servers/update',
    handler: wrap(async body => ({ server: await manager.update(body) })),
  })
  webServer.register({
    kind: 'exact',
    path: '/mcp-manager/api/servers/enabled',
    handler: wrap(async body => {
      const { id, enabled } = (body ?? {}) as { id?: string; enabled?: boolean }
      if (typeof id !== 'string' || typeof enabled !== 'boolean') {
        throw new Error('id (string) and enabled (boolean) are required')
      }
      return { server: await manager.setEnabled(id, enabled) }
    }),
  })
  webServer.register({
    kind: 'exact',
    path: '/mcp-manager/api/servers/remove',
    handler: wrap(async body => {
      const { id } = (body ?? {}) as { id?: string }
      if (typeof id !== 'string') throw new Error('id (string) is required')
      await manager.remove(id)
      return { removed: id }
    }),
  })
  ctx.logger.info('mcp-manager: api routes mounted at /mcp-manager/api/servers')
}
