import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkNumbers } from '../src/shared/number-check'

// The number check is the code behind "AIRA cannot invent numbers": every number Muse writes is looked up in the
// facts code gave it. It MARKS, never deletes — so the side that matters most is false alarms on true text.

const FACTS = [
  '- Finding: Usage for EGFR Mutation Kit (RGT-EGFR) was booked under a code that is not in the Item List.',
  '- Order now — KRAS Mutation Kit: order 4 box.',
  '- Order now — LBC Vial: order 2 box.',
  '- Order soon — DNA Extraction Kit: order 1 box (the sheet factor would order 39 box).',
  '- Not computed — PCR Tube 0.2 ml: cannot convert "piece" to ml.'
]

const values = (text: string, facts = FACTS): Array<[string, boolean]> =>
  checkNumbers(text, facts).hits.map((h) => [h.raw, h.ok])

describe('numbers that are in the facts', () => {
  test('a summary written from the facts has every number matched', () => {
    const r = checkNumbers(
      'Order 4 boxes of KRAS Mutation Kit and 2 boxes of LBC Vial now. The sheet factor for DNA Extraction Kit would order 39 boxes where 1 is enough.',
      FACTS
    )
    assert.deepEqual(r.hits.map((h) => h.raw), ['4', '2', '39', '1'])
    assert.equal(r.matched, 4)
    assert.equal(r.unmatched, 0)
  })

  test('each match names the fact it came from', () => {
    const h = checkNumbers('Order 39 boxes.', FACTS).hits[0]
    assert.match(h.source ?? '', /DNA Extraction Kit/)
  })

  test('a number rounded to what is written still matches', () => {
    const facts = ['daily use 19.87 test']
    assert.deepEqual(values('about 19.9 tests a day', facts), [['19.9', true]])
    assert.deepEqual(values('about 20 tests a day', facts), [['20', true]])
  })

  test('thousands with a comma match the plain number', () => {
    assert.deepEqual(values('3,840 tests were counted', ['{"closing":3840}']), [['3,840', true]])
  })

  test('a shortfall written without its sign matches the negative fact', () => {
    assert.deepEqual(values('the count is 24 tests short', ['diffBase -24']), [['24', true]])
  })

  test('a percentage matches a fraction or a percent fact', () => {
    assert.deepEqual(values('38% of the stock', ['share 0.38']), [['38%', true]])
    assert.deepEqual(values('38% of the stock', ['share 38']), [['38%', true]])
  })

  test('numbers in JSON tool results are found', () => {
    const facts = [JSON.stringify({ reorder: [{ itemCode: 'RGT-KRAS', orderPacks: 4, dailyUse: 1.35 }] })]
    assert.deepEqual(values('Order 4 boxes; it uses 1.35 tests a day.', facts), [['4', true], ['1.35', true]])
  })
})

describe('numbers that are not in the facts', () => {
  test('an invented number is unmatched and the text is not changed', () => {
    const text = 'Order 12 boxes of KRAS Mutation Kit.'
    const r = checkNumbers(text, FACTS)
    assert.deepEqual(r.hits.map((h) => [h.raw, h.ok]), [['12', false]])
    assert.equal(r.unmatched, 1)
    assert.equal(r.hits[0].source, null)
    assert.equal(text.slice(r.hits[0].index, r.hits[0].index + r.hits[0].raw.length), '12')
  })

  test('a rounding that is not a rounding of any fact is unmatched', () => {
    assert.deepEqual(values('about 21 tests a day', ['daily use 19.87 test']), [['21', false]])
  })
})

describe('things that are not numbers to check', () => {
  test('dates are skipped', () => {
    assert.deepEqual(values('For 2026-10, by 24 Oct and Nov 3, 2026, in October 2026.'), [])
  })

  test('list markers are skipped', () => {
    assert.deepEqual(values('1. Order KRAS Mutation Kit.\n2) Check the factor.'), [])
  })

  test('digits inside item codes and words are skipped', () => {
    assert.deepEqual(values('RGT-EGFR, HbA1c and COVID-19 kits'), [])
  })

  test('a number in an item name matches because the name is in the facts', () => {
    assert.deepEqual(values('PCR Tube 0.2 ml could not be computed.'), [['0.2', true]])
  })

  test('no numbers gives an empty, honest result', () => {
    const r = checkNumbers('Nothing needs your attention.', FACTS)
    assert.deepEqual(r, { hits: [], matched: 0, unmatched: 0 })
  })
})
