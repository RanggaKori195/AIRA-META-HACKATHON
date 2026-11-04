// How the mascot speaks: the ElevenLabs voice (mp3 made in the main process), with the Windows voice only as the
// fallback when ElevenLabs cannot answer (offline, no key, quota) — AIRA never goes silent. Pure: the browser parts
// are injected, so tests/mascot-player.test.ts drives it without audio.
import type { MascotEvent } from './state'

export interface SpeakerDeps {
  muted: () => boolean
  synthesize: (text: string) => Promise<{ audio: Uint8Array } | { error: string }>
  /** Plays the mp3; calls `onEnd` when it finishes or fails. */
  play: (audio: Uint8Array, onEnd: () => void) => Promise<void>
  stopAudio: () => void
  /** Windows voice (speechSynthesis): emits its own speakStart/speakEnd. */
  fallback: (text: string) => void
  stopFallback: () => void
  emit: (e: Extract<MascotEvent, { t: 'speakStart' | 'speakEnd' }>['t']) => void
}

export interface Speaker {
  speak: (text: string) => Promise<void>
  stop: () => void
}

export function createSpeaker(d: SpeakerDeps): Speaker {
  // Each speak/stop takes a new turn number: a slow reply from an older turn is dropped, never played over a newer one.
  let turn = 0
  const silence = (): void => {
    d.stopAudio()
    d.stopFallback()
  }
  return {
    async speak(text) {
      if (d.muted()) return
      const mine = ++turn
      silence()
      const r = await d.synthesize(text).catch((e: unknown) => ({ error: String(e) }))
      if (mine !== turn) return
      if ('error' in r) {
        d.fallback(text)
        return
      }
      d.emit('speakStart')
      await d.play(r.audio, () => {
        if (mine === turn) d.emit('speakEnd')
      })
    },
    stop() {
      turn++
      silence()
      d.emit('speakEnd')
    }
  }
}
