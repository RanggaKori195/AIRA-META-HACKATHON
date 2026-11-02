import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConfig, type McpServerConfig } from '../config'
import { getSecret } from '../secrets'
import { ToolError } from '../tools/types'
import { logger } from '../logger'

// MCP client manager — setiap external MCP server dianggap untrusted dependency:
// koneksi di-timeout, hasil tool dipotong, dan error tidak boleh menjatuhkan agent.

export interface McpToolInfo {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requireApproval: boolean
}

export interface McpServerStatus {
  name: string
  ok: boolean
  toolCount: number
  error?: string
}

const CONNECT_TIMEOUT_MS = 15_000
const MAX_RESULT_CHARS = 8_000

const clients = new Map<string, Client>()
const statusCache = new Map<string, McpServerStatus>()

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ToolError(`${label} timeout setelah ${ms / 1000}s`)), ms)
    )
  ])
}

function serverHeaders(name: string): Record<string, string> {
  const raw = getSecret(`mcp:${name}:headers`)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function connect(cfg: McpServerConfig): Promise<Client> {
  const existing = clients.get(cfg.name)
  if (existing) return existing
  const client = new Client({ name: 'aira-desktop', version: '0.1.0' })
  const headers = serverHeaders(cfg.name)
  const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: Object.keys(headers).length ? { headers } : undefined
  })
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `koneksi MCP "${cfg.name}"`)
  clients.set(cfg.name, client)
  return client
}

export function invalidate(name: string): void {
  const client = clients.get(name)
  clients.delete(name)
  statusCache.delete(name)
  if (client) void client.close().catch(() => undefined)
}

/** Probe satu server (connect + listTools). Dipakai saat menambah server & untuk status UI. */
export async function probeServer(cfg: McpServerConfig): Promise<McpServerStatus> {
  try {
    const client = await connect(cfg)
    const result = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools')
    const status: McpServerStatus = { name: cfg.name, ok: true, toolCount: result.tools.length }
    statusCache.set(cfg.name, status)
    return status
  } catch (err: any) {
    invalidate(cfg.name)
    const status: McpServerStatus = {
      name: cfg.name,
      ok: false,
      toolCount: 0,
      error: String(err?.message ?? err).slice(0, 200)
    }
    statusCache.set(cfg.name, status)
    return status
  }
}

export function cachedStatus(name: string): McpServerStatus | undefined {
  return statusCache.get(name)
}

/** Semua tool dari semua server aktif. Server yang gagal di-skip, bukan menjatuhkan run. */
export async function listAllTools(): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = []
  for (const cfg of loadConfig().mcpServers) {
    if (!cfg.enabled) continue
    try {
      const client = await connect(cfg)
      const result = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools')
      for (const tool of result.tools) {
        tools.push({
          server: cfg.name,
          name: tool.name,
          // Deskripsi dipangkas: daftar tool yang bengkak menurunkan akurasi
          // pemilihan tool pada model lokal.
          description: (tool.description ?? '').slice(0, 220),
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object' },
          requireApproval: cfg.requireApproval
        })
      }
      statusCache.set(cfg.name, { name: cfg.name, ok: true, toolCount: result.tools.length })
    } catch (err: any) {
      logger().warn({ server: cfg.name, err: String(err) }, 'MCP server unreachable, skipped')
      invalidate(cfg.name)
      statusCache.set(cfg.name, {
        name: cfg.name,
        ok: false,
        toolCount: 0,
        error: String(err?.message ?? err).slice(0, 200)
      })
    }
  }
  return tools
}

export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<string> {
  const cfg = loadConfig().mcpServers.find((s) => s.name === serverName)
  if (!cfg || !cfg.enabled) throw new ToolError(`MCP server "${serverName}" tidak tersedia`)
  let client: Client
  try {
    client = await connect(cfg)
  } catch (err) {
    invalidate(serverName)
    throw err
  }
  let result: any
  try {
    result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      timeoutMs,
      `tool MCP "${toolName}"`
    )
  } catch (err) {
    // Koneksi bisa basi (server restart) — invalidate supaya pemanggilan berikut reconnect.
    invalidate(serverName)
    throw err instanceof ToolError ? err : new ToolError(`MCP error: ${String(err).slice(0, 200)}`)
  }
  const parts: string[] = []
  for (const item of result?.content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    else if (item?.type) parts.push(`[konten ${item.type} dilewati]`)
  }
  const text = parts.join('\n').slice(0, MAX_RESULT_CHARS)
  if (result?.isError) throw new ToolError(text.slice(0, 300) || 'tool MCP mengembalikan error')
  return JSON.stringify({ source: `mcp:${serverName}`, note: 'data eksternal untrusted', result: text })
}
