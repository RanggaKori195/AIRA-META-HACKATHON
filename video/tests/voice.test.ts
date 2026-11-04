import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cacheKey, makeTimeline, wordsFromCharacters, writeTimeline, VOICE, type VoiceClient } from '../src/voice-core'
import type { ScriptLine } from '../src/voice-core'

const LINES: ScriptLine[] = [
  { id: 'a', speaker: 'aira', text: 'Good morning, Rangga.' },
  { id: 'b', speaker: 'user', text: 'Check the reagents.' }
]
function fake(failOn?: string): VoiceClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async speak(voiceId, text) {
      calls.push(`${voiceId}:${text}`)
      if (text === failOn) throw new Error('quota exceeded')
      const w = text.split(' ')
      return { mp3: new TextEncoder().encode(`mp3:${text}`), words: w.map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 })) }
    }
  }
}
const tmp = (): string => mkdtempSync(join(tmpdir(), 'aira-voice-'))

test('the cache key changes with the text, the voice and the model', () => {
  const k = cacheKey('v', 'm', 't')
  assert.match(k, /^[0-9a-f]{16}$/)
  assert.notEqual(k, cacheKey('v', 'm', 't2'))
  assert.notEqual(k, cacheKey('v2', 'm', 't'))
  assert.notEqual(k, cacheKey('v', 'm2', 't'))
})

test('AIRA speaks as Sarah, the user as Brian; a second run sends nothing; --force re-makes all', async () => {
  const dir = tmp()
  try {
    const c = fake()
    const lines = await makeTimeline(LINES, c, dir)
    assert.deepEqual(c.calls, [`${VOICE.aira}:Good morning, Rangga.`, `${VOICE.user}:Check the reagents.`])
    assert.equal(lines[0].file, `voice/${cacheKey(VOICE.aira, 'eleven_v4', LINES[0].text)}.mp3`)
    assert.ok(lines[0].duration >= lines[0].words.at(-1)!.end)
    await makeTimeline(LINES, c, dir)
    assert.equal(c.calls.length, 2)
    await makeTimeline(LINES, c, dir, { force: true })
    assert.equal(c.calls.length, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refusal names the line and leaves no timeline behind', async () => {
  const dir = tmp()
  const out = join(dir, 'timeline.json')
  try {
    await assert.rejects(writeTimeline(LINES, fake('Check the reagents.'), dir, out), /line b: quota exceeded/)
    assert.equal(existsSync(out), false)
    await writeTimeline(LINES, fake(), dir, out)
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('character times from ElevenLabs become word times (first character start, last character end)', () => {
  const text = 'Hi, Rangga.  Four'
  const chars = text.split('')
  const starts = chars.map((_, i) => i * 0.1)
  const ends = chars.map((_, i) => i * 0.1 + 0.08)
  assert.deepEqual(wordsFromCharacters(chars, starts, ends), [
    { text: 'Hi,', start: 0, end: 0.28 },
    { text: 'Rangga.', start: 0.4, end: 1.08 },
    { text: 'Four', start: 1.3, end: 1.68 }
  ])
})
