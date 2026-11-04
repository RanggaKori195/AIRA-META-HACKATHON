// Fits the recording into the video: intro card, the demo, outro card = exactly totalFrames. Every moment with a
// voice or a logged event (± padSeconds) plays at 1×; the waits between them (Muse thinking, pages loading) share
// one speed-up factor so the total fits — shown on screen, never cut silently. Pure — tests/timeline2.test.ts.
import { FPS, TOTAL_FRAMES } from './constants'
import type { Take } from './take'

export interface Segment {
  /** Output frame the segment starts on. */
  from: number
  frames: number
  takeFrom: number
  takeTo: number
  /** 1 = real time, > 1 = sped-up wait, 0 = last frame held. */
  rate: number
}
export interface Timeline {
  factor: number
  segments: Segment[]
  demoFrom: number
  demoFrames: number
}

export function planTimeline(
  take: Take,
  o: { introFrames: number; outroFrames: number; totalFrames?: number; fps?: number; padSeconds?: number; maxFactor?: number }
): Timeline {
  const fps = o.fps ?? FPS
  const total = o.totalFrames ?? TOTAL_FRAMES
  const pad = o.padSeconds ?? 1
  const maxFactor = o.maxFactor ?? 8
  const demoFrom = o.introFrames
  const demoFrames = total - o.introFrames - o.outroFrames
  const slot = demoFrames / fps

  // 1× windows: every clip and every event, padded, merged where they touch.
  const spans = [
    ...take.clips.map((c) => [c.at - pad, c.at + c.duration + pad] as const),
    ...take.events.map((e) => [e.at - pad, e.at + pad] as const)
  ]
    .map(([a, b]) => [Math.max(0, a), Math.min(take.duration, b)] as [number, number])
    .sort((x, y) => x[0] - y[0])
  const windows: [number, number][] = []
  for (const s of spans) {
    const last = windows.at(-1)
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else windows.push([s[0], s[1]])
  }
  const oneX = windows.reduce((n, [a, b]) => n + (b - a), 0)
  const gaps = take.duration - oneX
  const room = slot - oneX
  let factor = 1
  if (oneX + gaps > slot) {
    factor = room > 0 ? gaps / room : Infinity
    if (factor > maxFactor)
      throw new Error(`The take does not fit ${slot.toFixed(1)} s even at ${maxFactor}× (${oneX.toFixed(1)} s must play in real time, ${gaps.toFixed(1)} s of waiting) — re-take or shorten.`)
  }

  // Pieces in take order, then integer frames built cumulatively so the total is exact.
  const pieces: { takeFrom: number; takeTo: number; rate: number }[] = []
  let t = 0
  for (const [a, b] of windows) {
    if (a > t) pieces.push({ takeFrom: t, takeTo: a, rate: factor })
    pieces.push({ takeFrom: a, takeTo: b, rate: 1 })
    t = b
  }
  if (t < take.duration) pieces.push({ takeFrom: t, takeTo: take.duration, rate: factor })

  const segments: Segment[] = []
  let outSeconds = 0
  let frame = demoFrom
  for (const p of pieces) {
    outSeconds += (p.takeTo - p.takeFrom) / p.rate
    const end = demoFrom + Math.round(outSeconds * fps)
    if (end > frame) segments.push({ from: frame, frames: end - frame, ...p })
    frame = end
  }
  const end = demoFrom + demoFrames
  if (frame < end) segments.push({ from: frame, frames: end - frame, takeFrom: take.duration, takeTo: take.duration, rate: 0 })
  else if (frame > end) segments[segments.length - 1].frames -= frame - end
  return { factor, segments, demoFrom, demoFrames }
}

/** Output frame of a moment in the take (seconds from its start). */
export function takeToFrame(t: Timeline, seconds: number): number {
  const s = t.segments.find((x) => seconds >= x.takeFrom && seconds < x.takeTo) ?? t.segments.filter((x) => x.rate !== 0).at(-1)!
  if (s.rate === 0) return s.from
  return s.from + Math.min(s.frames - 1, Math.round(((seconds - s.takeFrom) / s.rate) * FPS))
}
