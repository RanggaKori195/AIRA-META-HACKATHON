import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NARRATION, USER_TURNS } from '../src/lines'
import { TERMS } from '../../scripts/scrub-check'
import { allowedTargets, matchByKeywords } from '../../src/shared/agent-actions'

const ALL = allowedTargets(['sales', 'masterdata', 'lab', 'reagent'])

test("each spoken request maps to the intended action with the app's own keyword router", () => {
  const got = Object.fromEntries(USER_TURNS.map((u) => [u.id, matchByKeywords(u.text, ALL)]))
  assert.deepEqual(got.reagent, { action: 'reagent', step: 'run' })
  assert.deepEqual(got.summary, { action: 'reagent', step: 'summary' })
  assert.deepEqual(got.sales, { action: 'ask', menu: 'sales', question: USER_TURNS.find((u) => u.id === 'sales')!.text })
})

test('English, no employer identity, narration at most 60 words', () => {
  for (const l of [...USER_TURNS, ...NARRATION]) {
    assert.doesNotMatch(l.text, TERMS, l.id)
    assert.match(l.text, /^[\x20-\x7E—’]+$/, l.id)
  }
  const words = NARRATION.flatMap((n) => n.text.split(/\s+/).filter(Boolean)).length
  assert.ok(words <= 60, String(words))
})
