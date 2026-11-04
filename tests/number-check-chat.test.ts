import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { numberCheckForRun } from '../src/main/agent/number-check-run'
import { NumberCheckStrip } from '../src/renderer/src/components/NumberMarks'
import { checkNumbers } from '../src/shared/number-check'

;(globalThis as { React?: unknown }).React = React
const src = (p: string): string => readFileSync(p, 'utf8')

const FACT = 'reagent_actions: {"reorder":[{"itemCode":"RGT-KRAS","orderPacks":4},{"itemCode":"LBC-VIAL","orderPacks":2}]}'

describe('number check on Reagent Check chat answers', () => {
  test('a Reagent Check answer is checked against the reagent tool results of the turn', () => {
    const r = numberCheckForRun('reagent', [FACT], 'Order 4 boxes of KRAS and 12 boxes of LBC.')
    assert.ok(r)
    assert.equal(r!.matched, 1)
    assert.deepEqual(r!.hits.filter((h) => !h.ok).map((h) => h.raw), ['12'])
  })

  test('other menus are not checked', () => {
    for (const mode of ['general', 'sales', 'lab', 'masterdata', 'onedrive']) {
      assert.equal(numberCheckForRun(mode, [FACT], 'Order 12 boxes.'), null, mode)
    }
  })

  test('no reagent tool result or no numbers in the answer = no strip (nothing was checked)', () => {
    assert.equal(numberCheckForRun('reagent', [], 'Order 12 boxes.'), null)
    assert.equal(numberCheckForRun('reagent', [FACT], 'Hello, ask me about the reagent check.'), null)
  })

  test('the orchestrator collects reagent results, runs the check and stores it with the message', () => {
    const o = src('src/main/agent/orchestrator.ts')
    assert.match(o, /call\.name\.startsWith\('reagent_'\)/)
    assert.match(o, /numberCheckForRun\(mode, runState\.reagentFacts \?\? \[\], content\)/)
    assert.match(o, /db\.setMessageNumberCheck\(messageId, /)
    assert.match(o, /type: 'number_check'/)
    const d = src('src/main/db.ts')
    assert.match(d, /ALTER TABLE messages ADD COLUMN number_check TEXT/)
    assert.match(d, /SELECT id, session_id, role, content, reasoning, tool_log, model_used, created_at, dashboard, visual, number_check FROM messages/)
    assert.match(src('src/renderer/src/App.tsx'), /event\.type === 'number_check'/)
    assert.match(src('src/renderer/src/views/Chat.tsx'), /<NumberCheckStrip check=\{m\.numberCheck\}/)
  })
})

describe('number check strip under a chat answer', () => {
  test('counts and names the numbers that are not in the data', () => {
    const check = checkNumbers('Order 4 boxes of KRAS and 12 boxes of LBC.', [FACT])
    const html = renderToStaticMarkup(React.createElement(NumberCheckStrip, { check }))
    assert.match(html, /Number check/)
    assert.match(html, /✓ 1 match/)
    assert.match(html, /⚠ 1 not in the reagent data: 12/)
  })

  test('all matched shows no warning', () => {
    const check = checkNumbers('Order 4 boxes.', [FACT])
    const html = renderToStaticMarkup(React.createElement(NumberCheckStrip, { check }))
    assert.match(html, /✓ 1 match/)
    assert.doesNotMatch(html, /⚠/)
  })
})
