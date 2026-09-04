/**
 * Minimal MCP stdio server (no SDK): initialize, tools/list with one "echo"
 * tool, tools/call replying the text. Speaks newline-delimited JSON-RPC over
 * stdio. Used by test/drive.mjs.
 */
import { createInterface } from 'node:readline'

const PROTOCOL = '2025-06-18'
let initialized = false

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const TOOLS = [{
  name: 'echo',
  description: 'Echo the given text back.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}]

const readline = createInterface({ input: process.stdin })
readline.on('line', line => {
  if (line.trim() === '') return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) return // notifications ignored
  switch (msg.method) {
    case 'initialize':
      initialized = true
      result(msg.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'echo-test', version: '1.0.0' } })
      break
    case 'tools/list':
      result(msg.id, { tools: TOOLS })
      break
    case 'tools/call':
      result(msg.id, { content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text ?? ''}` }] })
      break
    case 'ping':
      result(msg.id, {})
      break
    default:
      if (initialized) error(msg.id, -32601, `method not found: ${msg.method}`)
      else result(msg.id, {})
  }
})
