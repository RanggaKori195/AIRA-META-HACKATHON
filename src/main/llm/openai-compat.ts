import type {
  ChatTurn,
  LLMProvider,
  StreamCallbacks,
  StreamOptions,
  StreamResult,
  ToolCall
} from './provider'
import { LLMError } from './provider'
import { logger } from '../logger'
import { isContextOverflow, ringkasPesanError } from '../agent/context-limit'


// Provider untuk endpoint OpenAI-compatible (vLLM, Ollama, LM Studio, gateway internal).
// Reasoning model (Qwen3 via vLLM) mengirim delta di field `reasoning_content`;
// tool call streaming datang bertahap di delta.tool_calls dengan index.
export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private endpoint: string,
    private apiKey: string
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetchOrThrow(`${this.endpoint}/v1/models`, { headers: this.headers() })
    const body = (await res.json()) as { data?: Array<{ id: string }> }
    if (!Array.isArray(body.data)) throw new LLMError('LLM_BAD_RESPONSE', 'unexpected /v1/models body')
    return body.data.map((m) => m.id)
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.listModels()
      return true
    } catch {
      return false
    }
  }

  async complete(messages: ChatTurn[], model: string, maxTokens = 4000): Promise<string> {
    const res = await this.fetchOrThrow(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, messages, max_tokens: maxTokens })
    })
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return body.choices?.[0]?.message?.content ?? ''
  }

  async rerank(query: string, documents: string[], model: string): Promise<number[]> {
    const res = await this.fetchOrThrow(`${this.endpoint}/v1/rerank`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, query, documents })
    })
    const body = (await res.json()) as {
      results?: Array<{ index?: number; relevance_score?: number }>
    }
    if (!Array.isArray(body.results)) throw new LLMError('LLM_BAD_RESPONSE', 'unexpected /v1/rerank body')
    const scores = new Array<number>(documents.length).fill(0)
    for (const r of body.results) {
      if (typeof r.index === 'number' && r.index < scores.length) {
        scores[r.index] = r.relevance_score ?? 0
      }
    }
    return scores
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const res = await this.fetchOrThrow(`${this.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input: texts })
    })
    const body = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> }
    if (!Array.isArray(body.data) || body.data.length !== texts.length) {
      throw new LLMError('LLM_BAD_RESPONSE', 'unexpected /v1/embeddings body')
    }
    // Urutkan by index — beberapa server tidak menjamin urutan.
    return body.data
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding ?? [])
  }

  async streamChat(
    messages: ChatTurn[],
    options: StreamOptions,
    callbacks: StreamCallbacks
  ): Promise<StreamResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    }
    if (options.tools?.length) {
      body.tools = options.tools
      body.tool_choice = options.toolChoice ?? 'auto'
    }

    const res = await this.fetchOrThrow(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: options.signal,
      body: JSON.stringify(body)
    })

    if (!res.body) throw new LLMError('LLM_BAD_RESPONSE', 'empty response body')

    const result: StreamResult = { content: '', reasoning: '', toolCalls: [] }
    const partialCalls = new Map<number, { id: string; name: string; arguments: string }>()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE: event dipisah newline, payload di baris "data: {...}"
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') continue
          let json: any
          try {
            json = JSON.parse(payload)
          } catch {
            logger().warn('malformed SSE chunk skipped')
            continue
          }
          const delta = json.choices?.[0]?.delta
          if (delta?.reasoning_content) {
            result.reasoning += delta.reasoning_content
            callbacks.onReasoning(delta.reasoning_content)
          }
          if (delta?.content) {
            result.content += delta.content
            callbacks.onContent(delta.content)
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              const partial = partialCalls.get(index) ?? { id: '', name: '', arguments: '' }
              if (tc.id) partial.id = tc.id
              if (tc.function?.name) partial.name = tc.function.name
              if (tc.function?.arguments) partial.arguments += tc.function.arguments
              partialCalls.set(index, partial)
            }
          }
          // Alasan berhenti datang di chunk terakhir, di luar `delta`.
          // Direkam supaya "jawaban kosong" bisa dibedakan antara jatah token
          // habis (`length`) dan model yang memang selesai (`stop`).
          const alasan = json.choices?.[0]?.finish_reason
          if (alasan) result.finishReason = alasan
          if (json.usage) {
            result.usage = {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new LLMError('LLM_CANCELLED', 'request cancelled')
      throw err
    }

    result.toolCalls = [...partialCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c], i): ToolCall => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments }))

    return result
  }

  private async fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new LLMError('LLM_CANCELLED', 'request cancelled')
      throw new LLMError('LLM_UNREACHABLE', `cannot reach LLM endpoint: ${err?.message ?? err}`)
    }
    if (res.status === 401 || res.status === 403)
      throw new LLMError('LLM_AUTH_FAILED', 'API key rejected by gateway')
    if (res.status === 429) throw new LLMError('LLM_RATE_LIMITED', 'rate limit exceeded')
    if (!res.ok) {
      // Body-nya WAJIB dibaca. Dulu langsung dibuang, sehingga context overflow —
      // penyebab HTTP 400 yang paling sering — tidak bisa dibedakan dari kesalahan
      // lain, dan user cuma melihat "LLM returned HTTP 400" tanpa jalan keluar.
      const body = await res.text().catch(() => '')
      if (isContextOverflow(res.status, body)) {
        throw new LLMError('LLM_CONTEXT_OVERFLOW', ringkasPesanError(body) || 'context window terlampaui')
      }
      throw new LLMError(
        'LLM_BAD_RESPONSE',
        `LLM returned HTTP ${res.status}${body ? `: ${ringkasPesanError(body)}` : ''}`
      )
    }
    return res
  }
}
