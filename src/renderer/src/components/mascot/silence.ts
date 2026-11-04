// When an automatic voice turn stops by itself. Pure — tested in tests/silence.test.ts. A microphone opened without
// a click must close without one: 1.5 s after the user stops talking, quietly after 6 s of nothing, at most 12 s.

export type SilenceVerdict = 'listening' | 'done' | 'nothing'

export interface SilenceOptions {
  /** RMS above this counts as speech (16 kHz mono, echo cancellation and noise suppression on). */
  threshold?: number
  silenceMs?: number
  noSpeechMs?: number
  maxMs?: number
}

export function createSilenceDetector(o: SilenceOptions = {}): { feed(rms: number, dtMs: number): SilenceVerdict } {
  const threshold = o.threshold ?? 0.015
  const silenceMs = o.silenceMs ?? 1500
  const noSpeechMs = o.noSpeechMs ?? 6000
  const maxMs = o.maxMs ?? 12000
  let elapsed = 0
  let heard = false
  let quiet = 0
  return {
    feed(rms, dtMs) {
      elapsed += dtMs
      if (rms >= threshold) {
        heard = true
        quiet = 0
      } else quiet += dtMs
      if (heard && (quiet >= silenceMs || elapsed >= maxMs)) return 'done'
      if (!heard && elapsed >= noSpeechMs) return 'nothing'
      return 'listening'
    }
  }
}

export function rmsOf(block: Float32Array): number {
  if (block.length === 0) return 0
  let sum = 0
  for (const v of block) sum += v * v
  return Math.sqrt(sum / block.length)
}
