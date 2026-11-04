// The 3:00 tutorial as chapters: each chapter is a narrator card (optional) followed by a slice of one recording.
// buildVirtual strings them into ONE virtual take (cards are narrator clips at 1×, slices keep their own clips and
// moments, shifted), planTimeline fits that into exactly totalFrames, and segments are split where a card meets a
// slice so each renders from one source. Pure — tests/tutorial.test.ts.
import { planTimeline, type Segment } from './timeline2'
import type { Clip, Take, Word } from './take'

export type Source = 'take' | 'tour'
export interface Chapter {
  id: string
  title: string
  /** NEW = built during the event; EXISTING = already in AIRA 0.5.0 (shown with what is new about it). */
  badge: 'NEW' | 'EXISTING'
  /** What is new when the badge is EXISTING. */
  newPart?: string
  narration?: string
  slice?: { source: Source; from: number; to: number }
}
export interface Piece {
  kind: 'card' | 'slice'
  chapter: string
  vFrom: number
  vTo: number
  source?: Source
  /** Take time at vFrom (slices). */
  from?: number
}
export interface Narr {
  file: string
  duration: number
  words: Word[]
}

export const CARD_LEAD = 0.3
export const CARD_TAIL = 0.5

export function buildVirtual(chapters: Chapter[], takes: Record<Source, Take>, narr: Record<string, Narr>): { take: Take; pieces: Piece[] } {
  const pieces: Piece[] = []
  const clips: Clip[] = []
  const events: Take['events'] = []
  let v = 0
  for (const ch of chapters) {
    if (ch.narration) {
      const n = narr[ch.narration]
      if (!n) throw new Error(`Narration ${ch.narration} is missing from voices.json — run npm run voices.`)
      const len = CARD_LEAD + n.duration + CARD_TAIL
      pieces.push({ kind: 'card', chapter: ch.id, vFrom: v, vTo: v + len })
      clips.push({ who: 'narrator', file: n.file, at: v + CARD_LEAD, duration: n.duration, words: n.words })
      v += len
    }
    if (ch.slice) {
      const { source, from, to } = ch.slice
      const t = takes[source]
      pieces.push({ kind: 'slice', chapter: ch.id, vFrom: v, vTo: v + (to - from), source, from })
      for (const c of t.clips) if (c.at >= from && c.at < to) clips.push({ ...c, at: v + (c.at - from) })
      for (const e of t.events) if (e.at >= from && e.at < to) events.push({ name: e.name, at: v + (e.at - from) })
      v += to - from
    }
  }
  return { take: { duration: v, clips, events }, pieces }
}

export interface TutorialSegment extends Segment {
  piece: number
}
export interface Tutorial {
  factor: number
  pieces: Piece[]
  take: Take
  segments: TutorialSegment[]
}

export function planTutorial(
  chapters: Chapter[],
  takes: Record<Source, Take>,
  narr: Record<string, Narr>,
  o: { totalFrames: number; fps?: number; padSeconds?: number; maxFactor?: number; extraEvents?: (t: Take) => Take['events'] }
): Tutorial {
  const fps = o.fps ?? 30
  const { take, pieces } = buildVirtual(chapters, takes, narr)
  // Cards always play at 1×: one "event" per second across each card keeps the whole card inside a 1× window.
  const cardEvents = pieces.filter((p) => p.kind === 'card').flatMap((p) => Array.from({ length: Math.ceil(p.vTo - p.vFrom) + 1 }, (_, i) => ({ name: 'card', at: Math.min(p.vTo, p.vFrom + i) })))
  const planned = planTimeline(
    { ...take, events: [...(o.extraEvents ? o.extraEvents(take) : take.events), ...cardEvents] },
    { introFrames: 0, outroFrames: 0, totalFrames: o.totalFrames, fps, padSeconds: o.padSeconds ?? 0.4, maxFactor: o.maxFactor ?? 8 }
  )
  // Split segments at piece boundaries; frames are shared out cumulatively so the total stays exact.
  const segments: TutorialSegment[] = []
  for (const s of planned.segments) {
    if (s.rate === 0) {
      segments.push({ ...s, piece: pieces.length - 1 })
      continue
    }
    const cuts = [s.takeFrom, ...pieces.map((p) => p.vTo).filter((b) => b > s.takeFrom + 1e-9 && b < s.takeTo - 1e-9), s.takeTo]
    let frame = s.from
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]
      const b = cuts[i + 1]
      const end = i + 2 === cuts.length ? s.from + s.frames : s.from + Math.round(((b - s.takeFrom) / (s.takeTo - s.takeFrom)) * s.frames)
      if (end > frame) {
        const piece = pieces.findIndex((p) => a >= p.vFrom - 1e-9 && a < p.vTo - 1e-9)
        segments.push({ from: frame, frames: end - frame, takeFrom: a, takeTo: b, rate: s.rate, piece })
      }
      frame = end
    }
  }
  return { factor: planned.factor, pieces, take, segments }
}
