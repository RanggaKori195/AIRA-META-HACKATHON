import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeaker, type SpeakerDeps } from '../src/renderer/src/components/mascot/player'

// The mascot speaks with the ElevenLabs voice; the Windows voice is only the fallback when ElevenLabs cannot answer
// (offline, no key, quota), so AIRA never goes silent.

function deps(over: Partial<SpeakerDeps> = {}): SpeakerDeps & { log: string[] } {
  const log: string[] = []
  return {
    log,
    muted: () => false,
    synthesize: async (text) => ({ audio: new Uint8Array([text.length]) }),
    play: async (audio, onEnd) => {
      log.push(`play:${audio[0]}`)
      onEnd()
    },
    stopAudio: () => log.push('stopAudio'),
    fallback: (text) => log.push(`fallback:${text}`),
    stopFallback: () => log.push('stopFallback'),
    emit: (e) => log.push(e),
    ...over
  }
}

describe('mascot speaker', () => {
  test('speaks with the ElevenLabs audio and moves the mascot to speaking and back', async () => {
    const d = deps()
    await createSpeaker(d).speak('Hello.')
    assert.deepEqual(d.log, ['stopAudio', 'stopFallback', 'speakStart', 'play:6', 'speakEnd'])
  })

  test('falls back to the Windows voice when ElevenLabs fails', async () => {
    const d = deps({ synthesize: async () => ({ error: 'quota' }) })
    await createSpeaker(d).speak('Hello.')
    assert.ok(d.log.includes('fallback:Hello.'), d.log.join(' '))
    assert.ok(!d.log.some((l) => l.startsWith('play:')))
  })

  test('muted: nothing is fetched or played', async () => {
    let fetched = false
    const d = deps({ muted: () => true, synthesize: async () => ((fetched = true), { audio: new Uint8Array([1]) }) })
    await createSpeaker(d).speak('Hello.')
    assert.equal(fetched, false)
    assert.ok(!d.log.some((l) => l.startsWith('play') || l.startsWith('fallback')))
  })

  test('a newer reply or Stop wins: a slow older reply is never played', async () => {
    let release: () => void = () => {}
    const slow = new Promise<void>((r) => (release = r))
    let n = 0
    const d = deps({
      synthesize: async (text) => {
        if (n++ === 0) await slow
        return { audio: new Uint8Array([text.length]) }
      }
    })
    const s = createSpeaker(d)
    const first = s.speak('Old reply.')
    s.stop()
    release()
    await first
    assert.ok(!d.log.includes('play:10'), d.log.join(' '))
    assert.ok(d.log.includes('speakEnd'))
  })
})
