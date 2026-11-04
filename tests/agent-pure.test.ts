import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseCallName } from '../src/renderer/src/components/agent/name'
import { startupSteps, greetingText } from '../src/renderer/src/components/agent/startup'
import { AgentActionSchema, allowedTargets, isAllowed, sayFor, matchByKeywords } from '../src/shared/agent-actions'

describe('reading the name the user says', () => {
  test('the usual ways of saying a name', () => {
    assert.equal(parseCallName('Call me Rangga.'), 'Rangga')
    assert.equal(parseCallName('my name is rangga kori'), 'Rangga Kori')
    assert.equal(parseCallName("I'm Ana"), 'Ana')
    assert.equal(parseCallName('uh, Budi please'), 'Budi')
    assert.equal(parseCallName('Rangga'), 'Rangga')
  })

  test('things that are not a name give null — AIRA goes on without one', () => {
    for (const t of ['yes', 'AIRA', 'my name is', '12', 'I would like to know the sales', '', 'no thanks']) {
      assert.equal(parseCallName(t), null, t)
    }
    assert.equal(parseCallName('Call me ' + 'A'.repeat(30)), null)
  })
})

describe('startup steps', () => {
  test('muted: shown as text only — nothing spoken, no microphone', () => {
    assert.deepEqual(startupSteps({ nameKnown: false, briefedToday: false, muted: true }), ['showText'])
  })
  test('first start with no name: ask, greet, brief, listen', () => {
    assert.deepEqual(startupSteps({ nameKnown: false, briefedToday: false, muted: false }), ['askName', 'greet', 'brief', 'listen'])
  })
  test('later start the same day: greet and listen, no briefing', () => {
    assert.deepEqual(startupSteps({ nameKnown: true, briefedToday: true, muted: false }), ['greet', 'listen'])
  })
})

describe('greeting text', () => {
  test('time of day and name', () => {
    assert.match(greetingText({ name: 'Rangga', hour: 8, briefing: null }), /^Good morning, Rangga\./)
    assert.match(greetingText({ name: 'Rangga', hour: 14, briefing: null }), /^Good afternoon, Rangga\./)
    assert.match(greetingText({ name: 'Rangga', hour: 20, briefing: null }), /^Good evening, Rangga\./)
    assert.match(greetingText({ name: null, hour: 8, briefing: null }), /^Good morning\./)
  })

  test('briefing in the middle, the question at the end', () => {
    const t = greetingText({ name: 'Rangga', hour: 8, briefing: 'Order 4 boxes of KRAS today.' })
    assert.equal(t, 'Good morning, Rangga. Order 4 boxes of KRAS today. What can I help you with?')
  })

  test('a long briefing is cut at a sentence end and the whole stays within 600 characters', () => {
    const briefing = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about the reagent stock.`).join(' ')
    const t = greetingText({ name: 'Rangga', hour: 8, briefing })
    assert.ok(t.length <= 600, String(t.length))
    assert.ok(t.endsWith('What can I help you with?'))
    assert.match(t, /stock\. What can I help you with\?$/)
  })
})

describe('agent action list', () => {
  const allowed = allowedTargets(['sales', 'reagent'])

  test('the schema accepts the five actions and nothing else', () => {
    for (const a of [
      { action: 'open', screen: 'home' },
      { action: 'ask', menu: 'sales', question: 'What were sales last month?' },
      { action: 'reagent', step: 'run' },
      { action: 'brief' },
      { action: 'none' }
    ]) {
      assert.ok(AgentActionSchema.safeParse(a).success, JSON.stringify(a))
    }
    assert.equal(AgentActionSchema.safeParse({ action: 'export' }).success, false)
    assert.equal(AgentActionSchema.safeParse({ action: 'ask', menu: 'sales', question: '' }).success, false)
    assert.equal(AgentActionSchema.safeParse({ action: 'open', screen: 'settings' }).success, false)
  })

  test('only permitted data menus are allowed', () => {
    assert.deepEqual(allowed.menus, ['sales', 'reagent'])
    assert.ok(allowed.screens.includes('home') && allowed.screens.includes('guide'))
    assert.equal(isAllowed({ action: 'open', screen: 'lab' }, allowed), false)
    assert.equal(isAllowed({ action: 'ask', menu: 'masterdata', question: 'x' }, allowed), false)
    assert.equal(isAllowed({ action: 'ask', menu: 'general', question: 'x' }, allowed), true)
    assert.equal(isAllowed({ action: 'reagent', step: 'run' }, allowedTargets(['sales'])), false)
  })

  test('what AIRA says before acting is written by code', () => {
    assert.equal(sayFor({ action: 'reagent', step: 'run' }), "Opening Reagent Check and running this month's check.")
    assert.equal(sayFor({ action: 'open', screen: 'sales' }), 'Opening Ask Sales Data.')
    assert.match(sayFor({ action: 'none' }), /sales, master data, sample TAT or the reagent check/)
    assert.match(sayFor({ action: 'ask', menu: 'sales', question: 'What were sales last month?' }), /^Asking Ask Sales Data: What were sales last month\?/)
  })

  test('keyword fallback reads the demo phrases', () => {
    const all = allowedTargets(['sales', 'masterdata', 'lab', 'reagent'])
    assert.deepEqual(matchByKeywords('check the reagents for this month', all), { action: 'reagent', step: 'run' })
    assert.deepEqual(matchByKeywords('show me the reorder list', all), { action: 'reagent', step: 'reorder' })
    assert.deepEqual(matchByKeywords('open sales', all), { action: 'open', screen: 'sales' })
    assert.deepEqual(matchByKeywords('What were sales last month?', all), { action: 'ask', menu: 'sales', question: 'What were sales last month?' })
    assert.deepEqual(matchByKeywords('play my briefing', all), { action: 'brief' })
    assert.deepEqual(matchByKeywords('open the guide', all), { action: 'open', screen: 'guide' })
    assert.equal(matchByKeywords('sing a song', all), null)
    // Refused, not "no match": a refused menu must never become a question somewhere else (review fix 1).
    assert.deepEqual(matchByKeywords('open sales', allowedTargets(['reagent'])), { action: 'none' })
  })
})
