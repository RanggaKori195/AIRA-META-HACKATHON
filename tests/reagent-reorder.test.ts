import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeReorder, CYCLE_DAYS, DEFAULT_LEAD_DAYS, DEFAULT_SAFETY_DAYS } from '../src/main/reagent/reorder'
import type { EvaluatedItem, Finding, NotChecked } from '../src/shared/reagent'

const ref = { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 }
const ev = (code: string, o: Partial<EvaluatedItem> = {}): EvaluatedItem => ({
  itemCode: code,
  itemName: `${code} name`,
  baseUnit: 'test',
  packSize: 96,
  packUnit: 'box',
  consumption: 310,
  closing: 100,
  estimated: 310,
  leadDays: 14,
  safetyDays: 7,
  countRefs: [ref],
  ...o
})
const finding = (type: Finding['type'], code: string, o: Partial<Finding> = {}): Finding => ({
  id: `${type}:${code}`, type, itemCode: code, itemName: `${code} name`, estimated: null, actual: null, ratio: null,
  impliedFactor: null, unit: 'test', explanation: `explanation ${code}`, evidence: [ref], ...o
})
const run = (evaluated: EvaluatedItem[], findings: Finding[] = [], notChecked: NotChecked[] = [], month = '2026-10') =>
  computeReorder({ month, evaluated, findings, notChecked })

describe('reorder list (computed by code)', () => {
  test('defaults and cycle', () => {
    assert.equal(DEFAULT_LEAD_DAYS, 14)
    assert.equal(DEFAULT_SAFETY_DAYS, 7)
    assert.equal(CYCLE_DAYS, 30)
  })

  test('order quantity rounds up to whole packs', () => {
    const l = run([ev('A')]).lines[0]
    assert.equal(l.dailyUse, 10)
    assert.equal(l.reorderPoint, 210)
    assert.equal(l.target, 510)
    assert.equal(l.orderBase, 410)
    assert.equal(l.orderPacks, 5)
    assert.deepEqual(l.evidence, [ref])
  })

  test('order_now when closing ≤ reorder point; order_soon when it reaches it within the cycle; ok otherwise with the date', () => {
    const { lines } = run([ev('OK', { closing: 600 }), ev('SOON', { closing: 400 }), ev('NOW', { closing: 100 })])
    assert.deepEqual(lines.map((l) => [l.itemCode, l.status]), [['NOW', 'order_now'], ['SOON', 'order_soon'], ['OK', 'ok']])
    const ok = lines.find((l) => l.itemCode === 'OK')!
    assert.equal(ok.orderPacks, 0)
    assert.equal(ok.reachesReorderPointOn, '2026-12-09') // 31 Oct + floor((600 − 210) / 10) = 39 days
    assert.equal(lines.find((l) => l.itemCode === 'NOW')!.reachesReorderPointOn, null)
  })

  test('defaults are flagged', () => {
    const l = run([ev('A', { leadDays: null, safetyDays: null })]).lines[0]
    assert.equal(l.leadDays, 14)
    assert.equal(l.safetyDays, 7)
    assert.equal(l.leadDefault, true)
    assert.equal(l.safetyDefault, true)
    const m = run([ev('B')]).lines[0]
    assert.equal(m.leadDefault, false)
    assert.equal(m.safetyDefault, false)
  })

  test('factor_too_high item gets sheetOrderPacks from the sheet estimate', () => {
    const { lines } = run([ev('KIT', { estimated: 930 }), ev('OTHER')], [finding('factor_too_high', 'KIT')])
    const kit = lines.find((l) => l.itemCode === 'KIT')!
    assert.equal(kit.orderPacks, 5)
    assert.equal(kit.sheetOrderPacks, 15) // sheet dailyUse 30 → target 1530 − 100 = 1430 → 15 boxes
    assert.equal(lines.find((l) => l.itemCode === 'OTHER')!.sheetOrderPacks, null)
  })

  test('no_use', () => {
    const l = run([ev('Z', { consumption: 0 })]).lines[0]
    assert.equal(l.status, 'no_use')
    assert.equal(l.orderPacks, 0)
    assert.equal(l.reachesReorderPointOn, null)
  })

  test('february', () => {
    const l = run([ev('F', { consumption: 280 })], [], [], '2026-02').lines[0]
    assert.equal(l.dailyUse, 10)
  })

  test('excluded carries unit_mismatch, no_physical_count and notChecked reasons, never a zero line', () => {
    const r = run(
      [ev('A')],
      [finding('unit_mismatch', 'ODD'), finding('no_physical_count', 'NOCOUNT'), finding('wrong_item_code', 'A')],
      [{ itemCode: 'NC', itemName: 'NC name', reason: 'stock counted but no usage recorded', evidence: [ref] }]
    )
    assert.deepEqual(r.lines.map((l) => l.itemCode), ['A'])
    assert.deepEqual(
      r.excluded.map((e) => [e.itemCode, e.reason]),
      [
        ['ODD', 'unit mismatch — consumption cannot be computed'],
        ['NOCOUNT', 'no physical count — consumption cannot be computed'],
        ['NC', 'stock counted but no usage recorded']
      ]
    )
  })
})
