import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { emitAgent, onAgent, takePending } from '../src/renderer/src/components/agent/bus'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('agent bus', () => {
  test('a command sent before its screen is mounted is kept until taken, once', () => {
    emitAgent({ kind: 'reagent', step: 'run' })
    assert.equal(takePending('brief'), null)
    assert.deepEqual(takePending('reagent'), { kind: 'reagent', step: 'run' })
    assert.equal(takePending('reagent'), null)
  })

  test('a listening screen receives it and nothing stays pending', () => {
    const got: unknown[] = []
    const off = onAgent('reagent', (c) => got.push(c))
    emitAgent({ kind: 'reagent', step: 'reorder' })
    off()
    assert.deepEqual(got, [{ kind: 'reagent', step: 'reorder' }])
    assert.equal(takePending('reagent'), null)
  })

  test("Home listening for the briefing does not swallow a reagent command meant for a screen not yet mounted", () => {
    const off = onAgent('brief', () => assert.fail('wrong listener'))
    emitAgent({ kind: 'reagent', step: 'run' })
    off()
    assert.deepEqual(takePending('reagent'), { kind: 'reagent', step: 'run' })
  })
})

describe('voice requests go to the agent; typed text does not', () => {
  const mascot = src('src/renderer/src/components/mascot/Mascot.tsx')
  const app = src('src/renderer/src/App.tsx')

  test('the mascot hands a voice turn to onVoiceRequest after the Cancel window', () => {
    assert.match(mascot, /onVoiceRequestRef\.current\(/)
    assert.doesNotMatch(mascot, /onSendRef/)
    assert.match(app, /<Mascot[\s\S]{0,300}onVoiceRequest=/)
  })

  test('automatic turns stop on silence, never start when muted or busy, and close quietly', () => {
    assert.match(mascot, /createSilenceDetector\(/)
    assert.match(mascot, /if \(o\.auto && \(busyRef\.current \|\| isMuted\(\)\)\)/)
    assert.match(mascot, /I'm here when you need me — click me to talk\./)
  })

  test('App routes the request, speaks the code-written line, re-checks the permission, asks in the right menu', () => {
    const h = app.slice(app.indexOf('const handleVoiceRequest'), app.indexOf('const handleVoiceRequest') + 3000)
    assert.match(h, /window\.aira\.agentRoute\(/)
    assert.match(h, /speakAgent\(/)
    assert.match(h, /menuPermitted\(/)
    // The transcript as said, never Muse's rewording (review fix 3).
    assert.match(h, /handleSend\(text, a\.menu\)/)
    assert.match(h, /emitAgent\(\{ kind: 'reagent', step: a\.step \}\)/)
  })

  test('Reagent Check and Home take their commands', () => {
    const r = src('src/renderer/src/views/ReagentHome.tsx')
    assert.match(r, /takePending\('reagent'\)/)
    assert.match(r, /onAgent\(/)
    assert.match(r, /Choose the reagent folder first\./)
    assert.match(src('src/renderer/src/views/Home.tsx'), /takePending\('brief'\)/)
  })

  test('typed questions keep today\'s path', () => {
    for (const f of ['src/renderer/src/views/Chat.tsx', 'src/renderer/src/views/Home.tsx']) assert.doesNotMatch(src(f), /agentRoute/, f)
  })

  test('agent speech is not cut to three sentences', () => {
    const v = src('src/renderer/src/components/mascot/voice.ts')
    const s = v.slice(v.indexOf('export function speakAgent'))
    assert.ok(s.length > 0, 'speakAgent exists')
    assert.doesNotMatch(s.slice(0, s.indexOf('\n}')), /speechText\(/)
  })
})
