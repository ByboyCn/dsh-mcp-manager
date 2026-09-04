/**
 * McpManager: owns the server registry and the runtime mounts.
 *
 * Each enabled registry entry is mounted as a dsh-mcp-client child fiber via
 * cordis `ctx.plugin()`; disabling or removing an entry disposes the fiber,
 * which unregisters that server's tools. Status is derived from the tools
 * registry: a server whose `mcp__<id>__*` tools are visible is "ready".
 */

import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import {
  loadRegistry,
  registryPath,
  saveRegistry,
  toMcpConfig,
  validateEntryInput,
  RegistryError,
  type McpClientConfig,
  type ServerEntry,
} from './registry.ts'

/** Derived status of one managed server. */
export type ServerStatus = 'disabled' | 'starting' | 'ready' | 'error'

/** Registry entry + live status projection returned by list/status. */
export interface ServerView extends ServerEntry {
  status: ServerStatus
  toolNames: string[]
  error?: string
}

/** Minimal structural typing of the fiber handle ctx.plugin() returns. */
interface FiberLike extends Promise<unknown> {
  dispose(): void | Promise<void>
}

export class McpManager {
  private readonly ctx: Context
  private readonly path: string
  private entries: ServerEntry[] = []
  private readonly fibers = new Map<string, FiberLike>()
  private readonly mountErrors = new Map<string, string>()
  private readonly toolNames = new Map<string, string[]>()
  private rescanTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context) {
    this.ctx = ctx
    this.path = registryPath()
    ctx.on('tools/change', () => this.scheduleRescan())
  }

  /** Load the registry and mount every enabled entry. */
  async init(): Promise<void> {
    this.entries = await loadRegistry(this.path)
    for (const entry of [...this.entries]) {
      if (entry.enabled) await this.mount(entry)
    }
    this.rescan()
  }

  /** All servers with live status. */
  list(): ServerView[] {
    return this.entries.map(entry => this.viewOf(entry))
  }

  /** One server's detailed view, or undefined. */
  get(id: string): ServerView | undefined {
    const entry = this.entries.find(e => e.id === id)
    return entry === undefined ? undefined : this.viewOf(entry)
  }

  /** Add a server; mounts it immediately unless disabled. */
  async add(input: unknown): Promise<ServerView> {
    const clean = validateEntryInput(input)
    if (this.entries.some(e => e.id === clean.id)) {
      throw new RegistryError('DUPLICATE_ID', `server ${clean.id} already exists`)
    }
    const now = new Date().toISOString()
    const entry: ServerEntry = { ...clean, enabled: clean.enabled ?? true, addedAt: now, updatedAt: now }
    this.entries.push(entry)
    await this.persist()
    if (entry.enabled) await this.mount(entry)
    return this.viewOf(entry)
  }

  /** Patch a server's config; remounts it when enabled or config changed. */
  async update(input: unknown): Promise<ServerView> {
    if (typeof input !== 'object' || input === null) {
      throw new RegistryError('INVALID_ENTRY', 'update must be an object with id')
    }
    const raw = input as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : ''
    const entry = this.entries.find(e => e.id === id)
    if (entry === undefined) {
      throw new RegistryError('NOT_FOUND', `server ${id || JSON.stringify(raw.id)} does not exist`)
    }
    // Validate the PATCH (id/transport immutable over update for simplicity).
    const patchInput = { ...raw, id: entry.id, transport: raw.transport === undefined ? entry.transport : raw.transport }
    const clean = validateEntryInput(patchInput)
    const next: ServerEntry = {
      ...entry,
      ...clean,
      enabled: clean.enabled ?? entry.enabled,
      updatedAt: new Date().toISOString(),
    }
    const changedMountRelevant = JSON.stringify(toMcpConfig(entry)) !== JSON.stringify(toMcpConfig(next))
    const index = this.entries.indexOf(entry)
    this.entries[index] = next
    await this.persist()
    if (changedMountRelevant || clean.enabled !== undefined) {
      await this.unmount(next.id)
      if (next.enabled) await this.mount(next)
    }
    return this.viewOf(next)
  }

  /** Enable/disable without touching config. */
  async setEnabled(id: string, enabled: boolean): Promise<ServerView> {
    const entry = this.entries.find(e => e.id === id)
    if (entry === undefined) throw new RegistryError('NOT_FOUND', `server ${id} does not exist`)
    if (typeof enabled !== 'boolean') throw new RegistryError('INVALID_ENTRY', 'enabled must be a boolean')
    if (entry.enabled === enabled) return this.viewOf(entry)
    entry.enabled = enabled
    entry.updatedAt = new Date().toISOString()
    await this.persist()
    if (enabled) {
      await this.mount(entry)
    } else {
      await this.unmount(id)
    }
    return this.viewOf(entry)
  }

  /** Remove a server and unmount it. */
  async remove(id: string): Promise<void> {
    const entry = this.entries.find(e => e.id === id)
    if (entry === undefined) throw new RegistryError('NOT_FOUND', `server ${id} does not exist`)
    await this.unmount(id)
    this.entries.splice(this.entries.indexOf(entry), 1)
    await this.persist()
  }

  private viewOf(entry: ServerEntry): ServerView {
    const tools = entry.enabled ? (this.toolNames.get(entry.id) ?? []) : []
    const error = this.mountErrors.get(entry.id)
    const status: ServerStatus = !entry.enabled
      ? 'disabled'
      : error !== undefined ? 'error'
        : tools.length > 0 ? 'ready' : 'starting'
    const view: ServerView = { ...entry, status, toolNames: tools }
    if (error !== undefined) view.error = error
    if (view.env !== undefined) view.env = redact(view.env)
    if (view.headers !== undefined) view.headers = redact(view.headers)
    return view
  }

  private async mount(entry: ServerEntry): Promise<void> {
    await this.unmount(entry.id)
    this.mountErrors.delete(entry.id)
    this.toolNames.delete(entry.id)
    const config = toMcpConfig(entry)
    this.ctx.logger.info(`mcp-manager: mounting server %C as %s`, entry.id, config.transport)
    try {
      const fiber = this.ctx.plugin(mcpClient as unknown as Parameters<Context['plugin']>[0], config as McpClientConfig) as unknown as FiberLike
      this.fibers.set(entry.id, fiber)
      void Promise.resolve(fiber).then(() => {
        this.scheduleRescan()
      }, (error: unknown) => {
        this.mountErrors.set(entry.id, String(error))
        this.ctx.logger.error(`mcp-manager: server %C failed to start: %s`, entry.id, String(error))
        this.scheduleRescan()
      })
    } catch (error) {
      this.mountErrors.set(entry.id, String(error))
      this.ctx.logger.error(`mcp-manager: server %C failed to mount: %s`, entry.id, String(error))
    }
  }

  private async unmount(id: string): Promise<void> {
    const fiber = this.fibers.get(id)
    if (fiber === undefined) return
    this.fibers.delete(id)
    try {
      await fiber.dispose()
    } catch (error) {
      this.ctx.logger.warn(`mcp-manager: unmounting server %C failed: %s`, id, String(error))
    }
    this.toolNames.delete(id)
  }

  /** Recompute per-server tool lists from the global tools registry. */
  private rescan(): void {
    const names: string[] = []
    try {
      const schemas = this.ctx.tools.schemas() as Array<{ name?: string }>
      for (const schema of schemas) {
        if (typeof schema.name === 'string' && schema.name.startsWith('mcp__')) names.push(schema.name)
      }
    } catch {
      // tools service not available in this composition
      return
    }
    const byServer = new Map<string, string[]>()
    for (const name of names) {
      const parts = name.split('__')
      const server = parts[1]
      if (server === undefined) continue
      const list = byServer.get(server)
      if (list === undefined) byServer.set(server, [name])
      else list.push(name)
    }
    for (const id of this.fibers.keys()) {
      this.toolNames.set(id, byServer.get(id) ?? [])
    }
    // A server that regained tools cleared its startup error state.
    for (const [id, tools] of byServer) {
      if (tools.length > 0) this.mountErrors.delete(id)
    }
  }

  private scheduleRescan(): void {
    if (this.rescanTimer !== undefined) return
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = undefined
      try {
        this.rescan()
      } catch {
        // never let a rescan kill the event loop
      }
    }, 500)
  }

  private async persist(): Promise<void> {
    await saveRegistry(this.path, this.entries)
  }
}

/** Mask secret-shaped values for projections (GUI, model output). */
function redact(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = /KEY|PASSWORD|SECRET|TOKEN/i.test(key) ? `${'*'.repeat(8)} (set)` : value
  }
  return out
}
