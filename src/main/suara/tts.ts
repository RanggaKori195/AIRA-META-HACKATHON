// AIRA's voice: ElevenLabs text-to-speech in the MAIN process. The key never reaches the renderer: it comes from
// `.env.local` at build (ELEVENLABS_API_KEY → `__BUNDLED_ELEVENLABS_KEY__`) and is put in the environment, where the
// SDK reads it. The renderer sends only the sentence to say and gets mp3 bytes back. Tested in tests/tts.test.ts.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js'

declare const __BUNDLED_ELEVENLABS_KEY__: string
declare const __BUNDLED_ELEVENLABS_VOICE__: string

/** Highest-quality ElevenLabs model (natural, expressive). */
export const TTS_MODEL = 'eleven_v4'
/** Sarah — warm, clear female voice from the ElevenLabs default library. `ELEVENLABS_VOICE_ID` in .env.local overrides. */
export const AIRA_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
/** The mascot reads a ≤3-sentence summary (speech.ts caps it at 400); this is the hard stop for credits. */
export const MAX_TTS_CHARS = 600
const CACHE_SIZE = 30

export function ttsRequest(text: string): ElevenLabs.BodyTextToSpeechFull {
  return {
    text: text.trim().slice(0, MAX_TTS_CHARS),
    modelId: TTS_MODEL,
    languageCode: 'en',
    // "Order 4 boxes", "19.9 tests" → spoken words, not digits.
    applyTextNormalization: 'on',
    outputFormat: 'mp3_44100_128',
    // Eleven v4 takes only these two: steady enough for numbers, still warm.
    voiceSettings: { stability: 0.55, similarityBoost: 0.8 }
  }
}

type Convert = (voiceId: string, request: ElevenLabs.BodyTextToSpeechFull) => Promise<ReadableStream<Uint8Array>>

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parts.push(value)
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Text → mp3 bytes. The same sentence (Brief me replay) is served from memory, not paid for again. */
export function createTts(convert: Convert, voiceId = AIRA_VOICE_ID): (text: string) => Promise<Uint8Array> {
  const cache = new Map<string, Uint8Array>()
  return async (text) => {
    const req = ttsRequest(text)
    if (!req.text) throw new Error('Nothing to say.')
    const hit = cache.get(req.text)
    if (hit) return hit
    const audio = await readAll(await convert(voiceId, req))
    cache.set(req.text, audio)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    return audio
  }
}

/** ElevenLabs errors as the fix the user needs (rule 55), never the raw response. */
export function explainTtsError(err: unknown): string {
  const e = err as { statusCode?: number; body?: { detail?: { message?: string } } }
  const detail = e?.body?.detail?.message ?? ''
  if (e?.statusCode === 401) {
    const perm = /missing the permission (\w+)/.exec(detail)
    return perm
      ? `The ElevenLabs key is missing the ${perm[1]} permission — turn it on for the key in the ElevenLabs dashboard.`
      : 'The ElevenLabs key was refused — check ELEVENLABS_API_KEY in .env.local.'
  }
  if (e?.statusCode === 429) return 'ElevenLabs usage limit or quota reached — the Windows voice is used for now.'
  if (err instanceof TypeError) return 'Could not reach ElevenLabs (network) — the Windows voice is used for now.'
  return `ElevenLabs could not make the speech: ${detail || (err instanceof Error ? err.message : String(err))}`
}

let tts: ((text: string) => Promise<Uint8Array>) | null = null

/** The app's speaker, created on first use. Null = no key configured (the renderer falls back to Windows voices). */
export function airaTts(): ((text: string) => Promise<Uint8Array>) | null {
  if (tts) return tts
  const bundled = typeof __BUNDLED_ELEVENLABS_KEY__ !== 'undefined' ? __BUNDLED_ELEVENLABS_KEY__ : ''
  if (!process.env.ELEVENLABS_API_KEY && bundled) process.env.ELEVENLABS_API_KEY = bundled
  if (!process.env.ELEVENLABS_API_KEY) return null
  const voice = (typeof __BUNDLED_ELEVENLABS_VOICE__ !== 'undefined' && __BUNDLED_ELEVENLABS_VOICE__) || AIRA_VOICE_ID
  const client = new ElevenLabsClient()
  tts = createTts((voiceId, req) => client.textToSpeech.convert(voiceId, req), voice)
  return tts
}
