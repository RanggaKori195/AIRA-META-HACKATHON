import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL, next, artFor, type Mascot } from '../src/renderer/src/components/mascot/state'
import { routeChatEvent } from '../src/renderer/src/components/mascot/route'
import { autoSendAction, canStartVoiceTurn } from '../src/renderer/src/components/mascot/turn'

const at = (state: Mascot['state'], extra: Partial<Mascot> = {}): Mascot => ({ ...INITIAL, state, ...extra })

describe('mascot state machine', () => {
  test('starts idle', () => {
    assert.deepEqual(INITIAL, { state: 'idle', label: null, transcript: null })
  })

  test('mic start listens', () => {
    assert.equal(next(INITIAL, { t: 'micStart' }).state, 'listening')
  })

  test('a transcript waits for confirmation', () => {
    const m = next(at('listening'), { t: 'transcript', text: 'hi' })
    assert.equal(m.state, 'confirming')
    assert.equal(m.transcript, 'hi')
  })

  test('nothing heard goes back to idle', () => {
    assert.deepEqual(next(at('listening'), { t: 'transcript', text: '' }), INITIAL)
    assert.deepEqual(next(at('listening'), { t: 'transcript', text: '   ' }), INITIAL)
  })

  test('cancel drops the transcript', () => {
    assert.deepEqual(next(at('confirming', { transcript: 'hi' }), { t: 'cancel' }), INITIAL)
  })

  test('send thinks', () => {
    assert.equal(next(at('confirming', { transcript: 'hi' }), { t: 'send' }).state, 'thinking')
  })

  test('any run start thinks', () => {
    for (const s of ['idle', 'speaking', 'confirming'] as const) {
      assert.equal(next(at(s), { t: 'runStart' }).state, 'thinking', s)
    }
  })

  test('a step shows its label while thinking', () => {
    assert.equal(next(at('thinking'), { t: 'step', label: 'Checking stock' }).label, 'Checking stock')
  })

  test('run done clears the label', () => {
    assert.deepEqual(next(at('thinking', { label: 'x' }), { t: 'runDone' }), INITIAL)
  })

  test('speaking and back', () => {
    assert.equal(next(INITIAL, { t: 'speakStart' }).state, 'speaking')
    assert.deepEqual(next(at('speaking'), { t: 'speakEnd' }), INITIAL)
  })

  test('the user can interrupt speech with the mic', () => {
    assert.equal(next(at('speaking'), { t: 'micStart' }).state, 'listening')
  })

  test('error always returns to idle', () => {
    for (const s of ['listening', 'confirming', 'thinking', 'speaking'] as const) {
      assert.deepEqual(next(at(s, { label: 'x', transcript: 'y' }), { t: 'error' }), INITIAL, s)
    }
  })

  test('confirming uses the listening art', () => {
    assert.equal(artFor('confirming'), 'listening')
    assert.equal(artFor('thinking'), 'thinking')
  })
})

describe('mascot state machine: a finished run never clobbers a voice turn', () => {
  test('runDone only clears thinking — listening, confirming and speaking are kept', () => {
    for (const s of ['listening', 'confirming', 'speaking'] as const) {
      const m = at(s, { transcript: 'y' })
      assert.deepEqual(next(m, { t: 'runDone' }), m, s)
    }
  })
})

describe('routeChatEvent: the mascot follows the run it started, not the open screen', () => {
  const ctx = { activeSessionId: 'A', trackedMessageId: 'm1' }
  const ev = (type: string, o: Record<string, unknown> = {}) => ({ type, messageId: 'm1', sessionId: 'A', ...o })

  test('done of the tracked run ends thinking even when the user left that session', () => {
    const r = routeChatEvent(ev('done', { sessionId: 'B' }), ctx)
    assert.deepEqual(r.mascot, [{ t: 'runDone' }])
    assert.equal(r.clearTracked, true)
  })

  test('done with no session open (Home) still ends the tracked run', () => {
    const r = routeChatEvent(ev('done'), { activeSessionId: null, trackedMessageId: 'm1' })
    assert.deepEqual(r.mascot, [{ t: 'runDone' }])
  })

  test('error of the tracked run returns the mascot to idle from any screen', () => {
    const r = routeChatEvent(ev('error', { sessionId: 'B' }), ctx)
    assert.deepEqual(r.mascot, [{ t: 'error' }])
    assert.equal(r.clearTracked, true)
  })

  test('the answer is only spoken when its session is the one on screen', () => {
    assert.equal(routeChatEvent(ev('done'), ctx).speak, true)
    assert.equal(routeChatEvent(ev('done', { sessionId: 'B' }), ctx).speak, false)
  })

  test('steps are shown only for the session on screen', () => {
    const activity = { argsSummary: 'Checking stock', label: 'l', name: 'n' }
    assert.deepEqual(routeChatEvent(ev('tool_start', { activity }), ctx).mascot, [{ t: 'step', label: 'Checking stock' }])
    assert.deepEqual(routeChatEvent(ev('tool_start', { activity, sessionId: 'B' }), ctx).mascot, [])
  })

  test('another run finishing does not touch the mascot or the tracked run', () => {
    const r = routeChatEvent(ev('done', { messageId: 'other', sessionId: 'B' }), ctx)
    assert.deepEqual(r.mascot, [])
    assert.equal(r.clearTracked, false)
    assert.equal(r.speak, false)
  })

  test('content/reasoning events do nothing for the mascot', () => {
    assert.deepEqual(routeChatEvent(ev('content', { delta: 'x' }), ctx).mascot, [])
  })
})

describe('voice turn rules', () => {
  test('a new voice turn starts only from idle or speaking, and never while a run is busy', () => {
    assert.equal(canStartVoiceTurn(false, 'idle'), true)
    assert.equal(canStartVoiceTurn(false, 'speaking'), true)
    assert.equal(canStartVoiceTurn(true, 'idle'), false)
    for (const s of ['thinking', 'confirming', 'listening'] as const) {
      assert.equal(canStartVoiceTurn(false, s), false, s)
    }
  })

  test('the 2 s auto-send is skipped while a run is busy', () => {
    assert.equal(autoSendAction(false), 'send')
    assert.equal(autoSendAction(true), 'skip')
  })
})
