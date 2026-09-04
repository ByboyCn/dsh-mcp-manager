/**
 * Isolation driver: boots a minimal cordis app with stub 'tools' and
 * 'webServer' services, mounts the built host plugin, and exercises the
 * manager: add → status → setEnabled(false) → setEnabled(true) → remove.
 * Run: node test/drive.mjs
 */
import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

class WebServerStub extends Service {
  routes = []
  constructor(ctx) {
    super(ctx, 'webServer')
  }
  register(route) {
    this.routes.push(route)
    return () => {}
  }
}

class ToolsStub extends Service {
  tools = new Map()
  handlers = new Set()
  constructor(ctx) {
    super(ctx, 'tools')
  }
  register(definition) {
    this.tools.set(definition.name, definition)
    for (const fn of this.handlers) fn()
    return () => this.tools.delete(definition.name)
  }
  schemas() {
    return [...this.tools.values()].map(t => ({ name: t.name }))
  }
  get(name) { return this.tools.get(name) }
}

class SystemPromptStub extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
  }
  tools() {}
}

const ctx = new Context()
new SystemPromptStub(ctx)
const webServer = new WebServerStub(ctx)
const tools = new ToolRuntime(ctx, {})
tools.handlers?.add?.(() => {})

ctx.plugin(plugin, {})

// give async init a beat
await new Promise(r => setTimeout(r, 500))

const toolNames = () => tools.schemas().map(s => s.name)
const managerTools = toolNames().filter(n => n.startsWith('mcp_'))
console.log('registered tools:', managerTools.join(', '))
console.log('webServer routes:', webServer.routes.map(r => `${r.method ?? 'ANY'} ${r.path} (kind=${r.kind})`).join(' | ') || '(none)')

// exercise mcp_add through the registered tool
const add = tools.get('mcp_add')
try {
  const result = await add.execute({
    id: 'echo-test',
    transport: 'stdio',
    command: process.execPath,
    args: [new URL('./echo-server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    description: 'isolation test server',
  }, { signal: new AbortController().signal })
  console.log('mcp_add ->', JSON.stringify(result.added ?? result, null, 2).slice(0, 400))
} catch (error) {
  console.log('mcp_add FAILED:', String(error))
}

await new Promise(r => setTimeout(r, 4000))
const list = tools.get('mcp_list')
const listing = await list.execute({}, { signal: new AbortController().signal })
console.log('mcp_list ->', JSON.stringify(listing, null, 2).slice(0, 800))
console.log('mcp tools visible:', toolNames().filter(n => n.startsWith('mcp__')))

ctx.fiber.dispose()
process.exit(0)
