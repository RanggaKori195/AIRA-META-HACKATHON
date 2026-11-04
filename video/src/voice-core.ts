// Makes the voice for every script line and the word times for it, in one ElevenLabs call: text-to-speech with
// timestamps returns the time of every character in the audio it generated (the key has no forced_alignment
// permission — see the ledger ruling).
// The client is injected so tests/voice.test.ts runs without the network. Each line is cached under a key of
// voice + model + text, so an unchanged line is never sent again (credits) and an edited one never reuses old audio.
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Word } from './take'

export type Speaker = 'aira' | 'user' | 'narrator'
/** A line to voice. */
export interface ScriptLine {
  id: string
  speaker: Speaker
  text: string
}
/** A voiced line: its mp3 (relative to public/) and its word times. */
export interface AlignedLine {
  id: string
  speaker: Speaker
  file: string
  duration: number
  words: Word[]
}

export const MODEL = 'eleven_v4'
/** AIRA = Sarah (the app's voice); the user = Brian; the narrator = George. Premade voices, used by id (the key cannot list voices). */
export const VOICE: Record<Speaker, string> = { aira: 'EXAVITQu4vr4xnSDxMaL', user: 'nPczCjzI2devNBz1zQrb', narrator: 'JBFqnCBsd6RMkjVDRZzb' }
/** Tail kept after the last aligned word (the mp3 is not decoded here). */
const TAIL_SECONDS = 0.15

export interface VoiceClient {
  speak(voiceId: string, text: string): Promise<{ mp3: Uint8Array; words: AlignedLine['words'] }>
}

const ms = (s: number): number => Math.round(s * 1000) / 1000

/** Groups per-character times into words split on whitespace: a word runs from its first to its last character. */
export function wordsFromCharacters(chars: string[], starts: number[], ends: number[]): AlignedLine['words'] {
  const out: AlignedLine['words'] = []
  let cur: { text: string; start: number; end: number } | null = null
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) out.push(cur)
      cur = null
      return
    }
    if (!cur) cur = { text: '', start: ms(starts[i]), end: ms(ends[i]) }
    cur.text += c
    cur.end = ms(ends[i])
  })
  if (cur) out.push(cur)
  return out
}

export function cacheKey(voiceId: string, model: string, text: string): string {
  return createHash('sha1').update(`${voiceId}\n${model}\n${text}`).digest('hex').slice(0, 16)
}

export async function makeTimeline(lines: ScriptLine[], client: VoiceClient, dir: string, o: { force?: boolean } = {}): Promise<AlignedLine[]> {
  mkdirSync(join(dir, 'voice'), { recursive: true })
  const out: AlignedLine[] = []
  for (const l of lines) {
    const voiceId = VOICE[l.speaker]
    const key = cacheKey(voiceId, MODEL, l.text)
    const mp3Path = join(dir, 'voice', `${key}.mp3`)
    const alignPath = join(dir, 'voice', `${key}.json`)
    try {
      let words: AlignedLine['words']
      if (!o.force && existsSync(mp3Path) && existsSync(alignPath)) {
        words = JSON.parse(readFileSync(alignPath, 'utf8'))
      } else {
        const r = await client.speak(voiceId, l.text)
        if (r.words.length === 0) throw new Error('ElevenLabs returned no timestamps for this line.')
        words = r.words
        const mp3 = r.mp3
        writeFileSync(mp3Path, mp3)
        writeFileSync(alignPath, JSON.stringify(words))
      }
      const duration = (words.at(-1)?.end ?? 0) + TAIL_SECONDS
      out.push({ id: l.id, speaker: l.speaker, file: `voice/${key}.mp3`, duration, words })
    } catch (e) {
      throw new Error(`line ${l.id}: ${(e as Error).message}`)
    }
  }
  return out
}

/** Writes timeline.json only after every line succeeded — a refusal mid-run leaves the old file untouched. */
export async function writeTimeline(lines: ScriptLine[], client: VoiceClient, dir: string, outFile: string, o: { force?: boolean } = {}): Promise<AlignedLine[]> {
  const t = await makeTimeline(lines, client, dir, o)
  writeFileSync(outFile, JSON.stringify(t, null, 2))
  return t
}
