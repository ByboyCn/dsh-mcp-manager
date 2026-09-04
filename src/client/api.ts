/**
 * Host API client for the MCP manager panel: fetch helpers against the
 * same-origin /mcp-manager/api routes plus the shared view types.
 */

/** Mirror of the host ServerView projection. */
export interface ServerView {
  id: string
  transport: 'stdio' | 'streamable-http'
  description?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  enabled: boolean
  addedAt: string
  updatedAt: string
  status: 'disabled' | 'starting' | 'ready' | 'error'
  toolNames: string[]
  error?: string
}

/** Resolve an API path against the page the UI is served from. */
export function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  return new URL(relative, document.baseURI).pathname
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(api(path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  if (!response.ok) {
    const message = (body as { error?: string }).error
    throw new Error(message ?? `${response.status} ${response.statusText}`)
  }
  return body
}

export async function fetchServers(): Promise<ServerView[]> {
  const body = await call('mcp-manager/api/servers') as { servers: ServerView[] }
  return body.servers
}

export async function addServer(entry: Record<string, unknown>): Promise<ServerView> {
  const body = await call('mcp-manager/api/servers/add', { method: 'POST', body: JSON.stringify(entry) }) as { server: ServerView }
  return body.server
}

export async function updateServer(patch: Record<string, unknown>): Promise<ServerView> {
  const body = await call('mcp-manager/api/servers/update', { method: 'POST', body: JSON.stringify(patch) }) as { server: ServerView }
  return body.server
}

export async function setServerEnabled(id: string, enabled: boolean): Promise<ServerView> {
  const body = await call('mcp-manager/api/servers/enabled', { method: 'POST', body: JSON.stringify({ id, enabled }) }) as { server: ServerView }
  return body.server
}

export async function removeServer(id: string): Promise<void> {
  await call('mcp-manager/api/servers/remove', { method: 'POST', body: JSON.stringify({ id }) })
}

/** Parse a JSON object/array field from form text; '' → undefined. */
export function parseJsonField(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return JSON.parse(trimmed)
}
