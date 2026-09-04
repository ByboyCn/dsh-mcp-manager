/**
 * MCP server registry: the persisted list of managed MCP servers plus the
 * mapping from a registry entry to a dsh-mcp-client plugin config.
 *
 * Storage: <dshHome>/mcp-manager/servers.json (shared across profiles; each
 * running profile mounts its own fibers from the same list). Writes are
 * atomic (tmp + rename) and best-effort chmod 0600 for secret-bearing env
 * blocks.
 */

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Supported MCP transports (mirrors dsh-mcp-client). */
export type Transport = 'stdio' | 'streamable-http'

/** One managed MCP server entry as persisted in servers.json. */
export interface ServerEntry {
  /** Server namespace; tools appear as mcp__<id>__<tool>. */
  id: string
  transport: Transport
  /** Human-facing note shown in the GUI / tool output. */
  description?: string
  /** stdio: executable to spawn. */
  command?: string
  /** stdio: argv passed to the command. */
  args?: string[]
  /** stdio: extra environment merged over the scrubbed parent env. */
  env?: Record<string, string>
  /** stdio: working directory. */
  cwd?: string
  /** streamable-http: endpoint URL. */
  url?: string
  /** streamable-http: extra request headers. */
  headers?: Record<string, string>
  /** Per tools/call timeout in ms (default 60000 in dsh-mcp-client). */
  toolCallTimeoutMs?: number
  /** Disabled entries stay persisted but are not mounted. */
  enabled: boolean
  addedAt: string
  updatedAt: string
}

/** Validation constraint mirrored from dsh-mcp-client's serverName rule. */
export const SERVER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/

/** Registry file location under the harness home. */
export function registryPath(): string {
  return join(resolveDshHome(), 'mcp-manager', 'servers.json')
}

/** Registry error with a stable machine-readable code. */
export class RegistryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}

function asStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw new RegistryError('INVALID_ENTRY', `${where} must be an array of strings`)
  }
  return [...value]
}

function asStringRecord(value: unknown, where: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.entries(value).some(([, v]) => typeof v !== 'string')) {
    throw new RegistryError('INVALID_ENTRY', `${where} must be an object with string values`)
  }
  return { ...(value as Record<string, string>) }
}

/**
 * Validate and normalize a (partial) server entry from an untrusted caller
 * (model tool arguments or HTTP body). Returns the sanitized fields.
 */
export function validateEntryInput(input: unknown): Omit<ServerEntry, 'addedAt' | 'updatedAt' | 'enabled'> & { enabled?: boolean } {
  if (typeof input !== 'object' || input === null) {
    throw new RegistryError('INVALID_ENTRY', 'entry must be an object')
  }
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!SERVER_ID_RE.test(id)) {
    throw new RegistryError('INVALID_ID', `id must match ${SERVER_ID_RE} (got ${JSON.stringify(id)})`)
  }
  const transport = raw.transport
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    throw new RegistryError('INVALID_ENTRY', "transport must be 'stdio' or 'streamable-http'")
  }
  const out: ReturnType<typeof validateEntryInput> = { id, transport }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') throw new RegistryError('INVALID_ENTRY', 'description must be a string')
    out.description = raw.description
  }
  if (raw.command !== undefined) {
    if (typeof raw.command !== 'string' || raw.command === '') throw new RegistryError('INVALID_ENTRY', 'command must be a non-empty string')
    out.command = raw.command
  }
  if (raw.args !== undefined) out.args = asStringArray(raw.args, 'args')
  if (raw.env !== undefined) out.env = asStringRecord(raw.env, 'env')
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== 'string') throw new RegistryError('INVALID_ENTRY', 'cwd must be a string')
    out.cwd = raw.cwd
  }
  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string' || !/^https?:\/\//i.test(raw.url)) throw new RegistryError('INVALID_ENTRY', 'url must be an http(s) URL')
    out.url = raw.url
  }
  if (raw.headers !== undefined) out.headers = asStringRecord(raw.headers, 'headers')
  if (raw.toolCallTimeoutMs !== undefined) {
    if (typeof raw.toolCallTimeoutMs !== 'number' || !Number.isInteger(raw.toolCallTimeoutMs) || raw.toolCallTimeoutMs <= 0) {
      throw new RegistryError('INVALID_ENTRY', 'toolCallTimeoutMs must be a positive integer')
    }
    out.toolCallTimeoutMs = raw.toolCallTimeoutMs
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') throw new RegistryError('INVALID_ENTRY', 'enabled must be a boolean')
    out.enabled = raw.enabled
  }
  // transport-specific required fields
  if (transport === 'stdio' && out.command === undefined) {
    throw new RegistryError('INVALID_ENTRY', 'stdio servers require command')
  }
  if (transport === 'streamable-http' && out.url === undefined) {
    throw new RegistryError('INVALID_ENTRY', 'streamable-http servers require url')
  }
  return out
}

/** Config shape accepted by dsh-mcp-client's plugin (subset we forward). */
export interface McpClientConfig {
  serverName: string
  transport: Transport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  failOnStartupError: boolean
}

/** Map a registry entry to the dsh-mcp-client plugin config. */
export function toMcpConfig(entry: ServerEntry): McpClientConfig {
  const config: McpClientConfig = {
    serverName: entry.id,
    transport: entry.transport,
    failOnStartupError: false,
  }
  if (entry.command !== undefined) config.command = entry.command
  if (entry.args !== undefined) config.args = entry.args
  if (entry.env !== undefined) config.env = entry.env
  if (entry.cwd !== undefined) config.cwd = entry.cwd
  if (entry.url !== undefined) config.url = entry.url
  if (entry.headers !== undefined) config.headers = entry.headers
  if (entry.toolCallTimeoutMs !== undefined) config.toolCallTimeoutMs = entry.toolCallTimeoutMs
  return config
}

/** Load the registry; a missing or corrupt file yields an empty list. */
export async function loadRegistry(path: string): Promise<ServerEntry[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RegistryError('CORRUPT_REGISTRY', `registry file ${path} is not valid JSON`)
  }
  const servers = (parsed as { servers?: unknown }).servers
  if (!Array.isArray(servers)) {
    throw new RegistryError('CORRUPT_REGISTRY', `registry file ${path} must hold { servers: [...] }`)
  }
  // Re-validate each entry defensively; skip entries that fail.
  const entries: ServerEntry[] = []
  for (const item of servers) {
    try {
      const clean = validateEntryInput(item)
      entries.push({
        ...clean,
        enabled: clean.enabled ?? true,
        addedAt: typeof (item as ServerEntry).addedAt === 'string' ? (item as ServerEntry).addedAt : new Date().toISOString(),
        updatedAt: typeof (item as ServerEntry).updatedAt === 'string' ? (item as ServerEntry).updatedAt : new Date().toISOString(),
      })
    } catch {
      // skip malformed entry rather than failing the whole registry
    }
  }
  return entries
}

/** Atomically persist the registry. */
export async function saveRegistry(path: string, servers: ServerEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  const body = JSON.stringify({ version: 1, servers }, null, 2) + '\n'
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
  try {
    await chmod(tmp, 0o600)
  } catch {
    // Windows / unusual filesystems: mode is best-effort
  }
  await rename(tmp, path)
}
