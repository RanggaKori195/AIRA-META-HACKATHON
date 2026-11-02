import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { adalahModeData, MODE_DATA } from '../src/main/agent/mode-data'
import { toolChoiceUntuk } from '../src/main/agent/sales-guard'
import { guardUjiBerlakuDiMode } from '../src/main/agent/verify-guard'
import { MODE_CHAT } from '../src/shared/mode-chat'

// Rule 30 / 79: the same set of DATA modes drives (1) the no-tool-answer guard, (2) the greeting exception
// (tool_choice 'none') and (3) the "I tested it" guard exemption. `reagent` was added to the app but not to
// these three hand-written lists (2 Nov 2026) — so they must all read ONE definition.
//
// `onedrive` is deliberately NOT a data mode here: follow-ups about an already-read file are legitimately answered
// from the conversation (orchestrator comment, 25 Aug 2026), and the "tested it" guard keeps running there.
const NON_DATA = ['general', 'onedrive']

describe('adalahModeData — one definition of "data mode"', () => {
  test('every ChatMode is classified explicitly: data or one of the named non-data modes', () => {
    for (const m of MODE_CHAT) {
      assert.equal(adalahModeData(m), !NON_DATA.includes(m), m)
    }
    assert.deepEqual([...MODE_DATA].sort(), ['masterdata', 'lab', 'reagent', 'sales'])
  })

  test('unknown / missing mode is not a data mode', () => {
    assert.equal(adalahModeData(undefined), false)
    assert.equal(adalahModeData('nonsense'), false)
  })
})

describe('all three consumers agree for every mode', () => {
  for (const m of MODE_CHAT) {
    const data = !NON_DATA.includes(m)
    test(`${m}: greeting → ${data ? 'none' : 'auto'}, "tested it" guard ${data ? 'off' : 'on'}`, () => {
      assert.equal(toolChoiceUntuk({ paksa: false, mode: m, pertanyaan: 'hi, who are you?', iterasi: 0 }), data ? 'none' : 'auto')
      assert.equal(guardUjiBerlakuDiMode(m), !data)
      assert.equal(adalahModeData(m), data)
    })
  }
})

describe('the orchestrator uses the shared predicate, not a hand-written mode chain', () => {
  const src = readFileSync('src/main/agent/orchestrator.ts', 'utf8')
  test('no `mode === \'sales\' || … \'lab\'` chain remains', () => {
    assert.doesNotMatch(src, /mode === 'sales' \|\| mode === 'masterdata' \|\| mode === 'lab'/)
  })
  test('the no-tool-answer guard condition calls adalahModeData(mode)', () => {
    assert.match(src, /adalahModeData\(mode\)\s*&&\s*activities\.length === 0/)
  })
  test('sales-guard.ts and verify-guard.ts have no hand-written mode chain either', () => {
    for (const f of ['src/main/agent/sales-guard.ts', 'src/main/agent/verify-guard.ts']) {
      assert.doesNotMatch(readFileSync(f, 'utf8'), /'masterdata'\s*(\|\||&&)[^\n]*'lab'/, f)
    }
  })
})
