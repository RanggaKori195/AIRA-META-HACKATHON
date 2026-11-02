// Abstraction layer LLM — business logic tidak boleh tahu provider apa di baliknya.

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string dari model — divalidasi oleh orchestrator, bukan di sini. */
  arguments: string
}

/** Bagian isi pesan multimodal (teks + gambar) untuk model vision. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ChatTurn =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface StreamCallbacks {
  onReasoning: (delta: string) => void
  onContent: (delta: string) => void
}

export interface StreamResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  usage?: { promptTokens: number; completionTokens: number }
  /**
   * Kenapa model berhenti: `stop` (selesai sendiri), `length` (jatah token habis),
   * `tool_calls`, dsb. — apa adanya dari gateway.
   *
   * ⚠️ Dulu TIDAK direkam sama sekali, dan itu titik buta yang mahal: 8 Sep 2026
   * sebuah jawaban terbit KOSONG, dan tanpa `finish_reason` tidak ada cara
   * membedakan "jatah token habis" dari "model berhenti sendiri" — keduanya
   * terlihat sebagai run sukses tanpa isi. Ketiadaannya membuat diagnosis
   * pertama SALAH (dikira batas token; ternyata gateway tanpa batas —
   * `scripts/probe-token.mjs` mengukur 7.469 token dengan `finish_reason: stop`).
   *
   * Inilah gunanya: perbedaan yang tidak direkam akan ditebak, dan tebakan
   * tentang sebab kegagalan mengirim orang memperbaiki hal yang keliru.
   */
  finishReason?: string
}

export interface StreamOptions {
  model: string
  signal: AbortSignal
  tools?: Array<Record<string, unknown>>
  /** 'required' memaksa model memanggil tool — dipakai untuk memulihkan false refusal. */
  toolChoice?: 'auto' | 'required'
}

export interface LLMProvider {
  listModels(): Promise<string[]>
  streamChat(
    messages: ChatTurn[],
    options: StreamOptions,
    callbacks: StreamCallbacks
  ): Promise<StreamResult>
  /** Panggilan sekali jalan tanpa tool/stream — dipakai untuk OCR & tugas vision. */
  complete(messages: ChatTurn[], model: string, maxTokens?: number): Promise<string>
  embed(texts: string[], model: string): Promise<number[][]>
  /** Skor relevansi tiap dokumen terhadap query, urutan sama dengan input. */
  rerank(query: string, documents: string[], model: string): Promise<number[]>
  healthCheck(): Promise<boolean>
}

export class LLMError extends Error {
  constructor(
    public code:
      | 'LLM_UNREACHABLE'
      | 'LLM_AUTH_FAILED'
      | 'LLM_RATE_LIMITED'
      | 'LLM_BAD_RESPONSE'
      /** Percakapan melebihi context window model — bisa dipulihkan dengan memangkas riwayat. */
      | 'LLM_CONTEXT_OVERFLOW'
      | 'LLM_CANCELLED',
    message: string
  ) {
    super(message)
  }
}
