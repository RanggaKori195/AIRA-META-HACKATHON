import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'fs'
import { TOTAL_FRAMES } from '../src/constants'
import { fixWords, CAPTION_FIXES } from '../src/caption-fixes'
import { buildTimeline } from '../src/data2'
import { takeToFrame } from '../src/timeline2'
import type { Take } from '../src/take'

const src = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('2:00 at 30 fps', () => assert.equal(TOTAL_FRAMES, 3600))

test('the demo plays the recording per segment, shows the speed-up badge, one Audio per clip; no drawn mascot', () => {
  const d = src('Demo.tsx')
  assert.match(d, /timeline\.segments\.map\(/)
  assert.match(d, /<OffthreadVideo/)
  assert.match(d, /playbackRate=\{s\.rate\}/)
  assert.match(d, /⏩/)
  assert.match(d, /take\.clips\.map\(/)
  assert.match(d, /<Audio/)
  for (const f of ['Demo.tsx', 'AiraDemo.tsx', 'Cards.tsx', 'Captions2.tsx']) assert.doesNotMatch(src(f), /mascot\//i, f)
  assert.match(src('AiraDemo.tsx'), /<IntroCard/)
  assert.match(src('AiraDemo.tsx'), /<OutroCard/)
  assert.match(src('AiraDemo.tsx'), /<Demo/)
})

test('every clip of the real take starts inside a 1× segment and the recording file exists', () => {
  const take = JSON.parse(src('take.json')) as Take
  const t = buildTimeline(take)
  for (const c of take.clips) {
    const f = takeToFrame(t, c.at)
    const s = t.segments.find((x) => f >= x.from && f < x.from + x.frames)!
    assert.equal(s.rate, 1, `${c.who} clip at ${c.at}`)
  }
  assert.ok(existsSync(new URL('../public/rec/demo.mp4', import.meta.url)))
})

test("captions use the app's own spelling of names; tags tell AIRA from You", () => {
  const w = (t: string[]) => t.map((text, i) => ({ text, start: i, end: i + 0.5 }))
  const fixed = fixWords(w(['Good', 'afternoon,', 'Ranga.', 'Two', 'boxes', 'of', 'Thin', 'Prep', 'PreserveSite', 'Vial']), CAPTION_FIXES)
  assert.deepEqual(fixed.map((x) => x.text), ['Good', 'afternoon,', 'Rangga.', 'Two', 'boxes', 'of', 'ThinPrep', 'PreservCyt', 'Vial'])
  assert.equal(fixed[6].start, 6)
  assert.equal(fixed[6].end, 7.5)
  const c = src('Captions2.tsx')
  assert.match(c, /#1f5bb8/i)
  assert.match(c, /'You'/)
  assert.match(c, /'AIRA'/)
})
