import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvestigation } from '../src/main/reagent/investigation'
import type { Finding } from '../src/shared/reagent'

const use = { file: 'Reagent_Usage_2026-10.xlsx', sheet: 'Weekly Usage', row: 9 }
const cnt = { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 }
const finding = (type: Finding['type'], code: string, o: Partial<Finding> = {}): Finding => ({
  id: `${type}:${code}`, type, itemCode: code, itemName: `${code} name`, estimated: null, actual: null, ratio: null,
  impliedFactor: null, unit: 'test', explanation: `explanation ${code}`, evidence: [use, cnt], ...o
})

describe('investigation checklist (steps fixed by code)', () => {
  test('one item per finding, steps fixed by type, evidence carried', () => {
    const items = buildInvestigation([
      finding('wrong_item_code', 'A'),
      finding('factor_too_high', 'B', { impliedFactor: 0.39 }),
      finding('used_faster', 'C'),
      finding('unit_mismatch', 'D'),
      finding('no_physical_count', 'E')
    ])
    assert.equal(items.length, 5)
    const kw: Record<string, RegExp> = {
      wrong_item_code: /item master/i,
      factor_too_high: /kit insert/i,
      used_faster: /repeat runs/i,
      unit_mismatch: /unit/i,
      no_physical_count: /count the item/i
    }
    for (const it of items) {
      assert.ok(it.steps.length >= 2, it.kind)
      assert.ok(it.steps.some((s) => kw[it.kind].test(s.text)), it.kind)
      assert.deepEqual(it.evidence, [use, cnt])
      assert.ok(it.headline.length > 0)
    }
  })

  test('factor_too_high step states the implied factor from the finding', () => {
    const [it] = buildInvestigation([finding('factor_too_high', 'B', { impliedFactor: 0.39 })])
    assert.ok(it.steps.some((s) => /the count implies 0\.39 test per test/.test(s.text)))
  })

  test('recount differs rows add recount_differs items with the opname evidence', () => {
    const items = buildInvestigation([], [{ itemCode: 'RGT-EGFR', itemName: 'EGFR Mutation Kit', diffBase: -24, diffPacks: -1, refs: [cnt] }])
    assert.equal(items.length, 1)
    assert.equal(items[0].kind, 'recount_differs')
    assert.deepEqual(items[0].evidence, [cnt])
    assert.match(items[0].headline, /1 box|-24|24/)
    assert.ok(items[0].steps.some((s) => /third time/.test(s.text)))
  })

  test('every role ends with "(suggested)"', () => {
    const items = buildInvestigation(
      [finding('wrong_item_code', 'A'), finding('used_faster', 'C')],
      [{ itemCode: 'X', itemName: 'X', diffBase: 5, diffPacks: null, refs: [cnt] }]
    )
    for (const it of items) for (const s of it.steps) assert.match(s.role, / \(suggested\)$/)
  })
})

describe('investigation headline wording', () => {
  test('wrong_item_code headline names the item the usage belongs to, not as the unknown code', () => {
    const [it] = buildInvestigation([finding('wrong_item_code', 'RGT-HPV-GT14', { itemName: 'HPV Genotyping 14 Reagent Kit' })])
    assert.equal(it.headline, 'Usage for HPV Genotyping 14 Reagent Kit (RGT-HPV-GT14) was booked under a code that is not in the Item List')
  })
})
