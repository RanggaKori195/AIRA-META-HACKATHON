import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, FACTOR_HIGH_RATIO, USED_FASTER_RATIO } from '../src/main/reagent/rules'
import type { ItemRow, OpnameRow, UsageRow } from '../src/main/reagent/types'

const ref = (sheet: string, row: number) => ({ file: sheet === 'Stock Opname' ? 'Stock_Opname_2026-10.xlsx' : 'Reagent_Usage_2026-10.xlsx', sheet, row })
let n = 0
const item = (code: string, o: Partial<ItemRow> = {}): ItemRow => ({
  code, rawCode: code, name: `${code} name`, baseUnit: 'test', packSize: 50, packUnit: 'box', tests: ['T1'], factor: 1, leadDays: null, safetyDays: null, ref: ref('Item List', ++n), ...o
})
const use = (code: string, volume: number, factor: number, o: Partial<UsageRow> = {}): UsageRow => ({
  week: 'W1', code, rawCode: code, name: `${code} name`, tests: ['T1'], volume, factor, estimated: volume * factor, unit: 'test', ref: ref('Weekly Usage', ++n), ...o
})
const count = (code: string, opening: number, received: number, closing: number, unit = 'test'): OpnameRow => ({
  code, rawCode: code, name: `${code} name`, opening, received, closing, unit, ref: ref('Stock Opname', ++n)
})
const run = (o: { items: ItemRow[]; usage: UsageRow[]; opname: OpnameRow[]; volumes: Record<string, number> }) =>
  reconcile({ ...o, skipped: [], files: ['a.xlsx', 'b.xlsx'], month: '2026-10' })

describe('reconciliation rules', () => {
  test('thresholds', () => {
    assert.equal(FACTOR_HIGH_RATIO, 2)
    assert.equal(USED_FASTER_RATIO, 1.5)
  })

  test('factor too high: estimate 3x actual, implied factor from the count', () => {
    const r = run({ items: [item('KIT')], usage: [use('KIT', 100, 3)], opname: [count('KIT', 50, 100, 50)], volumes: { T1: 100 } })
    const f = r.findings.find((x) => x.type === 'factor_too_high')!
    assert.ok(f)
    assert.equal(f.estimated, 300)
    assert.equal(f.actual, 100)
    assert.equal(f.ratio, 0.33)
    assert.equal(f.impliedFactor, 1)
    assert.ok(f.evidence.some((e) => e.sheet === 'Weekly Usage') && f.evidence.some((e) => e.sheet === 'Stock Opname'))
    assert.match(f.explanation, /300/)
    assert.match(f.explanation, /100/)
  })

  test('used faster: actual 1.8x the estimate', () => {
    const r = run({ items: [item('TIP', { baseUnit: 'pcs', packUnit: 'rack', packSize: 96, factor: 4 })], usage: [use('TIP', 100, 4, { unit: 'pcs' })], opname: [count('TIP', 500, 400, 180, 'pcs')], volumes: { T1: 100 } })
    const f = r.findings.find((x) => x.type === 'used_faster')!
    assert.equal(f.actual, 720)
    assert.equal(f.estimated, 400)
    assert.equal(f.ratio, 1.8)
    assert.match(f.explanation, /1\.8/)
  })

  test('wrong item code: unknown code whose name matches an item', () => {
    const r = run({
      items: [item('HPV-14', { name: 'HPV Genotyping 14 Kit' })],
      usage: [use('HPV-14', 30, 1, { name: 'HPV Genotyping 14 Kit' }), use('HPV-G14', 10, 1, { rawCode: 'HPV-G14', name: 'HPV Genotyping 14 Kit' })],
      opname: [count('HPV-14', 20, 30, 10)],
      volumes: { T1: 40 }
    })
    const f = r.findings.find((x) => x.type === 'wrong_item_code')!
    assert.equal(f.itemCode, 'HPV-14')
    assert.equal(f.id, 'wrong_item_code:HPV-14:HPV-G14')
    assert.match(f.explanation, /HPV-G14/)
    assert.equal(f.evidence.length, 1)
    assert.equal(f.evidence[0].sheet, 'Weekly Usage')
  })

  test('wrong item code that matches nothing still becomes a finding', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1), use('ZZZ', 5, 1, { name: 'Mystery' })], opname: [count('A', 10, 0, 0)], volumes: { T1: 10 } })
    const f = r.findings.find((x) => x.type === 'wrong_item_code')!
    assert.equal(f.itemCode, 'ZZZ')
    assert.match(f.explanation, /matches no item/i)
  })

  test('unit mismatch: an unconvertible count unit is a finding, not zero', () => {
    const r = run({ items: [item('ETH', { baseUnit: 'mL', packUnit: 'bottle', packSize: 1000, factor: 0.5 })], usage: [use('ETH', 100, 0.5, { unit: 'mL' })], opname: [count('ETH', 12, 6, 9, 'kit')], volumes: { T1: 100 } })
    const types = r.findings.map((x) => x.type)
    assert.deepEqual(types, ['unit_mismatch'])
    assert.equal(r.findings[0].actual, null)
    assert.equal(r.findings[0].evidence[0].sheet, 'Stock Opname')
  })

  test('no physical count: usage without an opname row', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1)], opname: [], volumes: { T1: 10 } })
    assert.deepEqual(r.findings.map((x) => x.type), ['no_physical_count'])
  })

  test('ordinary item (ratio 1.1) and pack-unit count are not flagged', () => {
    const r = run({ items: [item('A', { packSize: 50, packUnit: 'box' })], usage: [use('A', 100, 1)], opname: [count('A', 3, 1, 1.8, 'box')], volumes: { T1: 100 } })
    assert.deepEqual(r.findings, [])
    assert.equal(r.summary.itemsChecked, 1)
  })

  test('zero test volume never divides and flags nothing on ratio', () => {
    const r = run({ items: [item('A')], usage: [use('A', 0, 1)], opname: [count('A', 10, 0, 5)], volumes: {} })
    assert.ok(!r.findings.some((x) => x.type === 'factor_too_high' || x.type === 'used_faster'))
  })

  test('a different sheet volume is mentioned in the explanation', () => {
    const r = run({ items: [item('KIT')], usage: [use('KIT', 60, 3)], opname: [count('KIT', 50, 100, 50)], volumes: { T1: 100 } })
    assert.match(r.findings[0].explanation, /sheet.*60.*100|100.*60/i)
  })

  test('summary counts findings by type and carries skipped rows and thresholds', () => {
    const r = reconcile({
      items: [item('A')], usage: [use('A', 10, 1)], opname: [], volumes: { T1: 10 },
      skipped: [{ ref: ref('Weekly Usage', 99), reason: 'missing item code' }], files: ['a.xlsx'], month: '2026-10'
    })
    assert.equal(r.summary.byType.no_physical_count, 1)
    assert.equal(r.summary.byType.used_faster, 0)
    assert.equal(r.summary.skipped.length, 1)
    assert.deepEqual(r.summary.thresholds, { factorHigh: 2, usedFaster: 1.5 })
  })

  test('every finding has evidence pointing at rows of its item (or the wrong code)', () => {
    const r = run({
      items: [item('KIT'), item('TIP', { factor: 4 })],
      usage: [use('KIT', 100, 3), use('TIP', 100, 4), use('BAD', 1, 1, { name: 'KIT name' })],
      opname: [count('KIT', 50, 100, 50), count('TIP', 500, 400, 180)],
      volumes: { T1: 100 }
    })
    assert.ok(r.findings.length >= 3)
    for (const f of r.findings) assert.ok(f.evidence.length >= 1, f.id)
  })
  test('wrong-code finding ids are unique per unknown code', () => {
    const r = run({
      items: [item('A', { name: 'Kit A' })],
      usage: [use('A', 10, 1, { name: 'Kit A' }), use('A1', 1, 1, { name: 'Kit A' }), use('A2', 1, 1, { name: 'Kit A' })],
      opname: [count('A', 10, 0, 0)],
      volumes: { T1: 10 }
    })
    const ids = r.findings.filter((x) => x.type === 'wrong_item_code').map((x) => x.id).sort()
    assert.deepEqual(ids, ['wrong_item_code:A:A1', 'wrong_item_code:A:A2'])
  })
})

describe('items that cannot be evaluated are never silent (no false all-clear)', () => {
  const nc = (r: ReturnType<typeof run>, code: string) => r.summary.notChecked.find((x) => x.itemCode === code)

  test('linked test codes absent from the lab-system volumes → not checked, named, not counted', () => {
    const r = run({ items: [item('HPV', { tests: ['HPV999'] })], usage: [use('HPV', 10, 1)], opname: [count('HPV', 10, 0, 0)], volumes: { T1: 10 } })
    assert.equal(r.summary.itemsChecked, 0)
    const x = nc(r, 'HPV')!
    assert.ok(x, JSON.stringify(r.summary.notChecked))
    assert.match(x.reason, /linked test codes HPV999 have no test volume in the lab system for 2026-10/)
    assert.equal(x.itemName, 'HPV name')
    assert.ok(x.evidence.length >= 1)
  })

  test('zero DB volume → not checked', () => {
    const r = run({ items: [item('A')], usage: [use('A', 0, 1)], opname: [count('A', 10, 0, 5)], volumes: { T1: 0 } })
    assert.equal(r.summary.itemsChecked, 0)
    assert.match(nc(r, 'A')!.reason, /T1 have no test volume/)
  })

  test('empty Test Code(s) in the Item List → not checked with that reason', () => {
    const r = run({ items: [item('A', { tests: [] })], usage: [use('A', 10, 1)], opname: [count('A', 10, 0, 0)], volumes: { T1: 10 } })
    assert.equal(r.summary.itemsChecked, 0)
    assert.match(nc(r, 'A')!.reason, /no linked test codes/i)
  })

  test('physical count higher than opening + received → not checked, actual named', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1)], opname: [count('A', 10, 0, 22)], volumes: { T1: 10 } })
    assert.equal(r.summary.itemsChecked, 0)
    assert.deepEqual(r.findings, [])
    assert.match(nc(r, 'A')!.reason, /physical count is higher than opening stock plus received \(actual −12\)/)
  })

  test('zero consumption from the count → not checked', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1)], opname: [count('A', 10, 0, 10)], volumes: { T1: 10 } })
    assert.equal(r.summary.itemsChecked, 0)
    assert.match(nc(r, 'A')!.reason, /no consumption/i)
  })

  test('stock counted but no usage rows → not checked', () => {
    const r = run({ items: [item('A')], usage: [], opname: [count('A', 10, 0, 5)], volumes: { T1: 10 } })
    assert.equal(r.summary.itemsChecked, 0)
    const x = nc(r, 'A')!
    assert.match(x.reason, /stock counted but no usage recorded/)
    assert.equal(x.evidence[0].sheet, 'Stock Opname')
  })

  test('opname row whose code is not in the Item List → not checked', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1)], opname: [count('A', 10, 0, 0), count('GHOST', 5, 0, 1)], volumes: { T1: 10 } })
    const x = nc(r, 'GHOST')!
    assert.ok(x, JSON.stringify(r.summary.notChecked))
    assert.match(x.reason, /code not in the Item List/)
    assert.equal(x.itemName, 'GHOST name')
    assert.equal(r.summary.itemsChecked, 1)
  })

  test('a fully evaluated item leaves notChecked empty', () => {
    const r = run({ items: [item('A')], usage: [use('A', 100, 1)], opname: [count('A', 100, 0, 0)], volumes: { T1: 100 } })
    assert.deepEqual(r.summary.notChecked, [])
    assert.equal(r.summary.itemsChecked, 1)
  })
})

describe('duplicate opname rows', () => {
  test('all rows of an item are summed after converting each to the base unit; every row is evidence', () => {
    // 1 box (50) + 20 test = 70 consumed; estimate 35 × 4 = 140 → factor too high, actual from BOTH rows.
    const a = count('A', 2, 0, 1, 'box')
    const b = count('A', 30, 0, 10, 'test')
    const r = run({ items: [item('A')], usage: [use('A', 35, 4)], opname: [a, b], volumes: { T1: 35 } })
    const f = r.findings.find((x) => x.type === 'factor_too_high')!
    assert.ok(f, JSON.stringify(r.findings))
    assert.equal(f.actual, 70)
    assert.ok(f.evidence.some((e) => e.row === a.ref.row) && f.evidence.some((e) => e.row === b.ref.row))
  })

  test('one unconvertible duplicate row → unit_mismatch for the item', () => {
    const r = run({ items: [item('A')], usage: [use('A', 10, 1)], opname: [count('A', 10, 0, 0), count('A', 1, 0, 0, 'carton')], volumes: { T1: 10 } })
    assert.deepEqual(r.findings.map((x) => x.type), ['unit_mismatch'])
    assert.match(r.findings[0].explanation, /carton/)
    assert.equal(r.findings[0].evidence.length, 2)
  })
})

describe('usage unit', () => {
  test('the usage factor is converted from the row unit to the base unit', () => {
    // factor 500 µL per test in a mL item = 0.5 mL; 100 tests → 50 mL; actual 50 mL → no finding.
    const r = run({
      items: [item('ETH', { baseUnit: 'mL', packUnit: 'bottle', packSize: 1000, factor: 0.5 })],
      usage: [use('ETH', 100, 500, { unit: 'µL' })],
      opname: [count('ETH', 100, 0, 50, 'mL')],
      volumes: { T1: 100 }
    })
    assert.deepEqual(r.findings, [])
    assert.equal(r.summary.itemsChecked, 1)
  })

  test('an unconvertible usage unit → unit_mismatch with that usage row as evidence', () => {
    const bad = use('ETH', 100, 1, { unit: 'kit' })
    const r = run({
      items: [item('ETH', { baseUnit: 'mL', packUnit: 'bottle', packSize: 1000 })],
      usage: [use('ETH', 100, 0.5, { unit: 'mL' }), bad],
      opname: [count('ETH', 100, 0, 0, 'mL')],
      volumes: { T1: 200 }
    })
    assert.deepEqual(r.findings.map((x) => x.type), ['unit_mismatch'])
    assert.deepEqual(r.findings[0].evidence, [bad.ref])
    assert.match(r.findings[0].explanation, /kit/)
  })

  test('a blank usage unit means the base unit', () => {
    const r = run({ items: [item('A')], usage: [use('A', 100, 1, { unit: '' })], opname: [count('A', 100, 0, 0)], volumes: { T1: 100 } })
    assert.deepEqual(r.findings, [])
    assert.equal(r.summary.itemsChecked, 1)
  })
})

describe('reconcile output for reorder and recount', () => {
  test('evaluated lists ordinary and finding items with consumption and closing in base units', () => {
    const r = run({
      items: [item('BOX', { packSize: 96, leadDays: 21 }), item('KIT')],
      usage: [use('BOX', 100, 1), use('KIT', 100, 3)],
      opname: [count('BOX', 4, 1, 3, 'box'), count('KIT', 50, 100, 50)],
      volumes: { T1: 100 }
    })
    const box = r.evaluated.find((e) => e.itemCode === 'BOX')!
    assert.equal(box.closing, 288)
    assert.equal(box.consumption, 192)
    assert.equal(box.leadDays, 21)
    assert.equal(box.safetyDays, null)
    assert.equal(box.packSize, 96)
    assert.ok(box.countRefs.every((x) => x.sheet === 'Stock Opname'))
    const kit = r.evaluated.find((e) => e.itemCode === 'KIT')!
    const finding = r.findings.find((x) => x.type === 'factor_too_high')!
    assert.equal(kit.consumption, finding.actual)
    assert.equal(kit.estimated, finding.estimated)
  })

  test('evaluated excludes not-checked, unit-mismatch and no-physical-count items', () => {
    const r = run({
      items: [item('NOCOUNT'), item('ODD'), item('NOTEST', { tests: [] })],
      usage: [use('NOCOUNT', 10, 1), use('ODD', 10, 1), use('NOTEST', 10, 1)],
      opname: [count('ODD', 5, 5, 2, 'kit'), count('NOTEST', 20, 0, 10)],
      volumes: { T1: 10 }
    })
    assert.deepEqual(r.evaluated, [])
  })

  test('recount has every counted item; an unconvertible unit gives closing null with a reason', () => {
    const r = run({
      items: [item('BOX', { packSize: 96 }), item('ODD')],
      usage: [use('BOX', 100, 1), use('ODD', 10, 1)],
      opname: [count('BOX', 4, 1, 3, 'box'), count('ODD', 5, 5, 2, 'kit')],
      volumes: { T1: 100 }
    })
    const box = r.recount.find((x) => x.itemCode === 'BOX')!
    assert.equal(box.closing, 288)
    assert.equal(box.opnameUnit, 'box')
    assert.equal(box.refs.length, 1)
    const odd = r.recount.find((x) => x.itemCode === 'ODD')!
    assert.equal(odd.closing, null)
    assert.match(odd.reason ?? '', /cannot convert "kit" to test/)
  })
})
