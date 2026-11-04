import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { routeRequest } from '../src/main/agent-voice/route'
import { matchByKeywords, allowedTargets } from '../src/shared/agent-actions'
import { parseCallName } from '../src/renderer/src/components/agent/name'

const src = (p: string): string => readFileSync(p, 'utf8')
const ALL = ['sales', 'masterdata', 'lab', 'reagent']

describe('review fix 1 — a refused menu gets the none line, never a chat', () => {
  test('Muse picks a menu the account may not open → none', async () => {
    const r = await routeRequest('open the TAT screen', { menu: ['sales'], current: 'general', complete: async () => '{"action":"open","screen":"lab"}' })
    assert.deepEqual(r.action, { action: 'none' })
  })
  test('keywords hit a refused menu → none (not "ask in the current menu")', async () => {
    assert.deepEqual(matchByKeywords('open sales', allowedTargets(['reagent'])), { action: 'none' })
    const r = await routeRequest('open the TAT screen', { menu: ['sales'], current: 'general', complete: async () => 'not json' })
    assert.deepEqual(r.action, { action: 'none' })
  })
})

describe("review fix 2 — Muse's none is respected (non-requests on the auto mic make no conversation)", () => {
  test('"nothing, thanks" with Muse answering none → none', async () => {
    const r = await routeRequest('nothing, thanks', { menu: ALL, current: 'general', complete: async () => '{"action":"none"}' })
    assert.deepEqual(r.action, { action: 'none' })
    assert.equal(r.source, 'muse')
  })
  test('the prompt sends general questions to the general menu and keeps none for non-requests', async () => {
    const { routePrompt } = await import('../src/main/agent-voice/route')
    const p = routePrompt('x', allowedTargets(ALL))
    assert.match(p, /general questions/i)
    assert.match(p, /"none"[^\n]*(thanks|not a request|background)/i)
  })
})

describe('review fixes 3 and 4 — App sends what the user said, and follow-ups stay in the open conversation', () => {
  const app = src('src/renderer/src/App.tsx')
  const h = app.slice(app.indexOf('const handleVoiceRequest'), app.indexOf('const handleStop'))
  test('the question sent is the transcript, not Muse\'s rewording', () => {
    assert.match(h, /handleSend\(text, a\.menu\)/)
    assert.doesNotMatch(h, /handleSend\(a\.question/)
  })
  test('same menu with an open conversation → added to it, no new conversation', () => {
    assert.match(h, /a\.menu === mode && activeSessionId/)
    assert.match(h, /void handleSend\(text\)/)
  })
})

describe('review fix 5 — no greeting or open mic while the window is hidden (tray autostart)', () => {
  test('Home starts the sequence only when the page is visible', () => {
    const home = src('src/renderer/src/views/Home.tsx')
    assert.match(home, /document\.visibilityState === 'visible'/)
    assert.match(home, /visibilitychange/)
  })
})

describe('review fix 6 — non-answers are not names', () => {
  test('pattern words alone, greetings, questions and "later" give null', () => {
    for (const t of ["I'm", 'I am', 'This is', 'My name', 'Good morning', 'Sorry?', 'What?', 'Hi there', 'Not now', 'Later', 'Rangga?']) {
      assert.equal(parseCallName(t), null, t)
    }
  })
  test('a curly apostrophe still reads the name', () => {
    assert.equal(parseCallName('I’m Rangga'), 'Rangga')
  })
})
