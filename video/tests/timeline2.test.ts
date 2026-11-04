import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTimeline, takeToFrame } from '../src/timeline2'
import type { Take } from '../src/take'

const clip = (at: number, duration: number) => ({ who: 'aira' as const, file: 'a.mp3', at, duration, words: [] })
const TAKE: Take = { duration: 60, clips: [clip(2, 6), clip(20, 5)], events: [{ name: 'x', at: 30 }, { name: 'y', at: 50 }] }
const O = { introFrames: 360, outroFrames: 360, totalFrames: 3600, fps: 30 }

test('segments are contiguous, cover the whole take, and the video is exactly 3600 frames', () => {
  const t = planTimeline(TAKE, { ...O, totalFrames: 1800 })
  assert.equal(t.demoFrom, 360)
  assert.equal(360 + t.demoFrames + 360, 1800)
  let f = t.demoFrom
  let take = 0
  for (const s of t.segments) {
    assert.equal(s.from, f)
    assert.ok(Math.abs(s.takeFrom - take) < 1e-9)
    f += s.frames
    take = s.takeTo
  }
  assert.equal(f, t.demoFrom + t.demoFrames)
  assert.ok(Math.abs(take - 60) < 1e-9)
})

test('every clip (±1 s) plays at 1×; gaps share one factor between 1 and 8', () => {
  const t = planTimeline(TAKE, { ...O, totalFrames: 1800 })
  for (const c of TAKE.clips) {
    const s = t.segments.find((x) => x.takeFrom <= c.at - 1 + 1e-9 && x.takeTo >= c.at + c.duration + 1 - 1e-9)
    assert.ok(s && s.rate === 1, `clip at ${c.at}`)
  }
  assert.ok(t.factor >= 1 && t.factor <= 8)
  for (const s of t.segments) assert.ok(s.rate === 1 || s.rate === t.factor || s.rate === 0)
})

test('take time maps to frames monotonically; a clip starts on its 1× frame', () => {
  const t = planTimeline(TAKE, { ...O, totalFrames: 1800 })
  let prev = -1
  for (let s = 0; s <= 60; s += 0.5) {
    const f = takeToFrame(t, s)
    assert.ok(f >= prev)
    prev = f
  }
  const s1 = t.segments.find((x) => x.rate === 1 && x.takeFrom <= 2 && x.takeTo >= 2)!
  assert.equal(takeToFrame(t, 2), s1.from + Math.round((2 - s1.takeFrom) * 30))
})

test('a take that cannot fit even at 8× throws', () => {
  const long: Take = { duration: 300, clips: [clip(0, 50), clip(100, 50)], events: [] }
  assert.throws(() => planTimeline(long, { ...O, totalFrames: 3600 }), /does not fit .* even at 8×/)
})

test('a short take keeps 1× and holds its last frame for the rest of the slot', () => {
  const t = planTimeline({ duration: 20, clips: [clip(2, 5)], events: [] }, O)
  assert.equal(t.factor, 1)
  assert.equal(t.segments.at(-1)!.rate, 0)
  assert.equal(360 + t.demoFrames + 360, 3600)
})
