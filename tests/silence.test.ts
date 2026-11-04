import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { createSilenceDetector, rmsOf } from '../src/renderer/src/components/mascot/silence'

// Auto-listen stops by itself: 1.5 s after the user stops talking, quietly after 6 s of nothing, at most 12 s.

const run = (d: ReturnType<typeof createSilenceDetector>, rms: number, ms: number): string => {
  let last = 'listening'
  for (let t = 0; t < ms; t += 100) last = d.feed(rms, 100)
  return last
}

describe('silence detector', () => {
  test('speech then 1.5 s of silence = done', () => {
    const d = createSilenceDetector()
    assert.equal(run(d, 0.1, 1000), 'listening')
    assert.equal(run(d, 0.001, 1400), 'listening')
    assert.equal(run(d, 0.001, 100), 'done')
  })

  test('6 s with no speech at all = nothing (the mic closes quietly)', () => {
    const d = createSilenceDetector()
    assert.equal(run(d, 0.001, 5900), 'listening')
    assert.equal(run(d, 0.001, 100), 'nothing')
  })

  test('talking without a pause stops at 12 s', () => {
    const d = createSilenceDetector()
    assert.equal(run(d, 0.1, 11900), 'listening')
    assert.equal(run(d, 0.1, 100), 'done')
  })

  test('RMS of a block', () => {
    assert.equal(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5)
    assert.equal(rmsOf(new Float32Array(0)), 0)
  })

  test('the recorder reports the level of each audio block', () => {
    const r = readFileSync('src/renderer/src/components/mascot/useRecorder.ts', 'utf8')
    const block = r.slice(r.indexOf('proc.onaudioprocess'), r.indexOf('source.connect(proc)'))
    assert.match(block, /onLevelRef\.current\?\.\(rmsOf\(/)
  })
})
