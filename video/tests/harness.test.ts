import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { nextClip, trimClips } from '../src/harness-queue'

test('each queued voice clip plays once, in order, then the mic is silent', () => {
  let used = 0
  const got: (string | null)[] = []
  for (let i = 0; i < 5; i++) {
    const r = nextClip(['a', 'b', 'c'], used)
    got.push(r.clip)
    used = r.used
  }
  assert.deepEqual(got, ['a', 'b', 'c', null, null])
})

test('an AIRA clip ends at its stop, or where the next one starts', () => {
  assert.deepEqual(
    trimClips([
      { at: 0, duration: 5 },
      { at: 3, duration: 4, stop: 6 },
      { at: 10, duration: 2 }
    ]),
    [
      { at: 0, duration: 3 },
      { at: 3, duration: 3 },
      { at: 10, duration: 2 }
    ]
  )
})

test('the page harness hooks the mic, AIRA audio, the Windows fallback voice and screen changes', () => {
  const h = readFileSync(new URL('../scripts/harness.js', import.meta.url), 'utf8')
  assert.match(h, /navigator\.mediaDevices\.getUserMedia\s*=/)
  assert.match(h, /URL\.createObjectURL\s*=/)
  assert.match(h, /HTMLMediaElement\.prototype\.play\s*=/)
  assert.match(h, /speechSynthesis\.speak\s*=/)
  assert.match(h, /new MutationObserver\(/)
  assert.match(h, /'fallback-voice'/)
})

import { afterClip, clipWords, takeProblems } from '../src/harness-queue'

test('review I2: a clip the app cut short keeps only the words heard before the cut', () => {
  const w = [
    { text: 'one', start: 0, end: 0.4 },
    { text: 'two', start: 0.5, end: 1.2 },
    { text: 'three', start: 1.4, end: 1.8 }
  ]
  assert.deepEqual(clipWords(w, 1), [
    { text: 'one', start: 0, end: 0.4 },
    { text: 'two', start: 0.5, end: 1 }
  ])
})

test('review I3: a step only counts if its screen moment comes AFTER its own spoken request', () => {
  const ev = [
    { t: 1, kind: 'event', name: 'sales:answer' },
    { t: 5, kind: 'user-clip', id: 'user-sales' }
  ]
  assert.equal(afterClip(ev, 'user-sales', 'sales:answer'), false)
  assert.equal(afterClip([...ev, { t: 9, kind: 'event', name: 'sales:answer' }], 'user-sales', 'sales:answer'), true)
})

test('review I4: the Windows fallback voice or AIRA speaking without captured audio makes the take unusable', () => {
  assert.deepEqual(takeProblems([{ t: 1, kind: 'event', name: 'mascot:speaking' }, { t: 1.2, kind: 'aira-audio', id: 1 }]), [])
  assert.match(takeProblems([{ t: 1, kind: 'fallback-voice' }]).join(), /Windows fallback voice/)
  assert.match(takeProblems([{ t: 1000, kind: 'event', name: 'mascot:speaking' }]).join(), /spoke without ElevenLabs audio/)
})

test('review I3: the sales answer is recognised by the sales chat header, not the sidebar', () => {
  const h = readFileSync(new URL('../scripts/harness.js', import.meta.url), 'utf8')
  assert.match(h, /the numbers come straight from the database, not estimates/)
})

test('a speaking moment is only judged once its audio had time to arrive', () => {
  const ev = [{ t: 10_000, kind: 'event', name: 'mascot:speaking' }]
  assert.deepEqual(takeProblems(ev, 10_500), [])
  assert.equal(takeProblems(ev, 12_000).length, 1)
})
