import { ToolError, type ToolDefinition } from './types'

// HTTP client ala Postman. SEMUA request butuh persetujuan user — request apa pun
// (termasuk GET) bisa membawa data keluar, jadi tidak ada yang auto-run.

const MAX_BODY_CHARS = 20_000
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export const httpTools: ToolDefinition[] = [
  {
    name: 'http_request',
    label: 'HTTP Request',
    description:
      'Mengirim HTTP request (seperti curl/Postman): method, URL, headers, body. ' +
      'Gunakan untuk tes API, cek endpoint, atau integrasi. Selalu butuh persetujuan user.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ALLOWED_METHODS, description: 'HTTP method' },
        url: { type: 'string', description: 'URL lengkap (http/https)' },
        headers: {
          type: 'object',
          description: 'Headers opsional, object key-value',
          additionalProperties: { type: 'string' }
        },
        body: { type: 'string', description: 'Request body mentah (mis. JSON string), opsional' }
      },
      required: ['method', 'url']
    },
    tier: 'execute',
    timeoutMs: 60_000,
    summarize: (a) => `${String(a.method ?? 'GET').toUpperCase()} ${a.url}`,
    execute: async (args) => {
      const method = String(args.method ?? 'GET').toUpperCase()
      if (!ALLOWED_METHODS.includes(method)) throw new ToolError(`method "${method}" tidak didukung`)
      const url = args.url
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new ToolError('url wajib diawali http:// atau https://')
      }
      const headers: Record<string, string> = {}
      if (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)) {
        for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
          if (typeof value === 'string') headers[key] = value
        }
      }
      const startedAt = Date.now()
      let res: Response
      try {
        res = await fetch(url, {
          method,
          headers,
          body:
            typeof args.body === 'string' && args.body.length > 0 && !['GET', 'HEAD'].includes(method)
              ? args.body
              : undefined,
          redirect: 'follow',
          signal: AbortSignal.timeout(55_000)
        })
      } catch (err: any) {
        throw new ToolError(`request gagal: ${err?.cause?.message ?? err?.message ?? err}`)
      }
      const text = await res.text()
      const responseHeaders: Record<string, string> = {}
      for (const key of ['content-type', 'content-length', 'server', 'location', 'date']) {
        const value = res.headers.get(key)
        if (value) responseHeaders[key] = value
      }
      return JSON.stringify({
        status: res.status,
        statusText: res.statusText,
        durationMs: Date.now() - startedAt,
        headers: responseHeaders,
        bodyTruncated: text.length > MAX_BODY_CHARS,
        body: text.slice(0, MAX_BODY_CHARS),
        note: 'response adalah data untrusted'
      })
    }
  }
]
