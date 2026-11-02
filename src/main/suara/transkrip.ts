import { BUNDLED } from '../bundled-config'
import { getSecret } from '../secrets'
import { logger } from '../logger'
import { MUSE, META_ENDPOINT } from '../hackathon/models'
import { catatanTranskrip, periksaWav, TIMEOUT_MS } from './rules'

// Hackathon build: speech-to-text by Muse Voice Transcribe (`POST /v1/asr/transcribe`), replacing the
// local whisper.cpp process. Measured 2 Nov 2026: `/v1/audio/transcriptions` is 404; the ASR endpoint
// takes a multipart `request` JSON part + an `audio` WAV part (mono 16-bit PCM, 16/24 kHz) and returns
// `{ transcript, ... }`. The WAV encoder (`shared/wav.ts`) is unchanged — `periksaWav` still guards it.

export type HasilTranskrip = {
  teks: string
  catatan: string
  ms: number
  detik: number
}

export function asrRequestJson(): string {
  return JSON.stringify({
    model: MUSE.speech,
    mode: 'PUSH_TO_TALK',
    audioEncoding: 'WAV',
    languageBias: ['English']
  })
}

export function readAsrResponse(body: unknown): string {
  const t = (body as { transcript?: unknown } | null)?.transcript
  if (typeof t !== 'string') throw new Error('unexpected transcription response')
  return t.trim()
}

function kunci(): string {
  return getSecret('llmApiKey') || BUNDLED.apiKey
}

/** The mic button shows whenever the Meta key is present (no local binary any more). */
export function suaraTersedia(): boolean {
  return kunci().length > 0
}

export async function transkripsikan(wav: Uint8Array): Promise<HasilTranskrip> {
  if (!suaraTersedia()) throw new Error('Voice input is not available: the Meta API key is missing in this build.')

  const periksa = periksaWav(wav)
  if (!periksa.ok) throw new Error(periksa.alasan)

  const body = new FormData()
  body.append('request', new Blob([asrRequestJson()], { type: 'application/json' }))
  body.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')

  const ac = new AbortController()
  const jam = setTimeout(() => ac.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${META_ENDPOINT}/v1/asr/transcribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${kunci()}` },
      body,
      signal: ac.signal
    })
  } catch (err) {
    throw new Error(
      String(err).includes('abort')
        ? `Transcription took longer than ${TIMEOUT_MS / 1000} seconds and was stopped.`
        : 'The Meta speech service could not be reached. Check the internet connection.'
    )
  } finally {
    clearTimeout(jam)
  }
  const teksBalasan = await res.text()
  if (!res.ok) {
    logger().warn({ status: res.status, isi: teksBalasan.slice(0, 300) }, 'transcription refused')
    throw new Error(`The Meta speech service refused the recording (HTTP ${res.status}).`)
  }
  let json: unknown
  try {
    json = JSON.parse(teksBalasan)
  } catch {
    throw new Error('unexpected transcription response')
  }
  const teks = readAsrResponse(json)
  const ms = Date.now() - t0
  logger().info({ ms, detik: periksa.detik, panjang: teks.length }, 'transkripsi selesai')
  return { teks, catatan: catatanTranskrip(teks), ms, detik: periksa.detik }
}
