import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVirtual, planTutorial, type Chapter } from '../src/tutorial'
import type { Take } from '../src/take'

const take: Take = {
  duration: 100,
  clips: [{ who: 'aira', file: 'a.mp3', at: 10, duration: 5, words: [] }],
  events: [{ name: 'x', at: 60 }]
}
const tour: Take = { duration: 20, clips: [], events: [{ name: 'y', at: 5 }] }
const narr = { n1: { file: 'n1.mp3', duration: 4, words: [] }, n2: { file: 'n2.mp3', duration: 3, words: [] } }
const CH: Chapter[] = [
  { id: 'intro', title: 'Intro', badge: 'NEW', narration: 'n1' },
  { id: 'a', title: 'A', badge: 'NEW', narration: 'n2', slice: { source: 'take', from: 0, to: 70 } },
  { id: 'b', title: 'B', badge: 'NEW', narration: 'n2', slice: { source: 'tour', from: 0, to: 20 } },
  { id: 'c', title: 'C', badge: 'EXISTING', slice: { source: 'take', from: 70, to: 100 } }
]

test('the virtual timeline strings cards and slices in order, with shifted clips and events', () => {
  const v = buildVirtual(CH, { take, tour }, narr)
  for (let i = 1; i < v.pieces.length; i++) assert.equal(v.pieces[i].vFrom, v.pieces[i - 1].vTo)
  assert.deepEqual(v.pieces.map((p) => `${p.kind}:${p.chapter}`), ['card:intro', 'card:a', 'slice:a', 'card:b', 'slice:b', 'slice:c'])
  const sliceA = v.pieces[2]
  assert.ok(v.take.clips.some((c) => c.who === 'aira' && Math.abs(c.at - (sliceA.vFrom + 10)) < 1e-9))
  assert.ok(v.take.clips.some((c) => c.who === 'narrator' && c.file === 'n1.mp3'))
  assert.ok(v.take.events.some((e) => e.name === 'y' && Math.abs(e.at - (v.pieces[4].vFrom + 5)) < 1e-9))
})

test('exactly the frames asked for; no segment crosses a piece; cards play at 1×', () => {
  const t = planTutorial(CH, { take, tour }, narr, { totalFrames: 1800 })
  assert.equal(t.segments.reduce((n, s) => n + s.frames, 0), 1800)
  let f = 0
  for (const s of t.segments) {
    assert.equal(s.from, f)
    f += s.frames
    const p = t.pieces[s.piece]
    assert.ok(s.takeFrom >= p.vFrom - 1e-6 && s.takeTo <= p.vTo + 1e-6, `segment in piece ${s.piece}`)
    if (p.kind === 'card') assert.equal(s.rate, 1)
  }
})
