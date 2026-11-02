import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildReagentWorkbooks, PLANTED, type SheetSpec } from '../scripts/seed/reagent'

const VOLUMES: Record<string, number> = {
  HPV101: 158, HPV102: 118, HPV103: 122, MOL101: 39, MOL102: 42, MOL103: 50, LBC101: 125
}

const sheet = (specs: SheetSpec[], name: string): SheetSpec => specs.find((s) => s.name === name)!
/** Rows after the header row (header found by its first cell). */
function table(s: SheetSpec, firstHeader: string): Array<Record<string, string | number | null>> {
  const h = s.rows.findIndex((r) => r[0] === firstHeader)
  const header = s.rows[h] as string[]
  return s.rows
    .slice(h + 1)
    .filter((r) => r.some((c) => c !== null && c !== ''))
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? null])))
}

describe('synthetic reagent workbooks', () => {
  const wb = buildReagentWorkbooks(VOLUMES, '2026-10')
  const items = table(sheet(wb.usage, 'Item List'), 'Item Code')
  const usage = table(sheet(wb.usage, 'Weekly Usage'), 'Week')
  const opname = table(sheet(wb.opname, 'Stock Opname'), 'Item Code')
  const item = (code: string) => items.find((i) => i['Item Code'] === code)!
  const linkedVolume = (code: string) =>
    String(item(code)['Test Code(s)']).split(/,\s*/).reduce((s, t) => s + (VOLUMES[t] ?? 0), 0)
  const toBase = (code: string, qty: number, unit: string) =>
    unit === item(code)['Base Unit'] ? qty : unit === item(code)['Pack Unit'] ? qty * Number(item(code)['Pack Size']) : unit === 'µL' && item(code)['Base Unit'] === 'mL' ? qty / 1000 : NaN
  const actual = (code: string) => {
    const o = opname.find((r) => r['Item Code'] === code)!
    const u = String(o.Unit)
    return toBase(code, Number(o['Opening Stock']) + Number(o.Received) - Number(o['Closing Count']), u)
  }
  const estimated = (code: string) => linkedVolume(code) * Number(item(code)['Standard Factor'])

  test('planted list names the four anomaly types', () => {
    assert.deepEqual(PLANTED.map((p) => p.type).sort(), ['factor_too_high', 'unit_mismatch', 'used_faster', 'wrong_item_code'])
  })

  test('wrong item code: a usage row whose code is not in the Item List but whose name is an item name', () => {
    const p = PLANTED.find((x) => x.type === 'wrong_item_code')!
    const row = usage.find((r) => r['Item Code'] === p.usageCode)!
    assert.ok(row, 'planted usage row exists')
    assert.ok(!items.some((i) => i['Item Code'] === p.usageCode))
    assert.equal(row['Item Name'], item(p.itemCode)['Item Name'])
  })

  test('factor too high: the sheet factor is 3x the standard factor', () => {
    const p = PLANTED.find((x) => x.type === 'factor_too_high')!
    const rows = usage.filter((r) => r['Item Code'] === p.itemCode)
    assert.ok(rows.length >= 4)
    for (const r of rows) assert.equal(Number(r['Factor per Test']), 3 * Number(item(p.itemCode)['Standard Factor']))
    const ratio = actual(p.itemCode) / estimated(p.itemCode)
    assert.ok(ratio > 0.9 && ratio < 1.3, `true consumption follows the standard factor (${ratio})`)
  })

  test('used faster: actual is about 1.8x the estimate', () => {
    const p = PLANTED.find((x) => x.type === 'used_faster')!
    const ratio = actual(p.itemCode) / estimated(p.itemCode)
    assert.ok(Math.abs(ratio - 1.8) <= 0.05, String(ratio))
  })

  test('unit mismatch: exactly one opname unit is neither base nor pack unit (nor a metric pair)', () => {
    const odd = opname.filter((o) => {
      const it = item(String(o['Item Code']))
      return o.Unit !== it['Base Unit'] && o.Unit !== it['Pack Unit'] && !(o.Unit === 'µL' && it['Base Unit'] === 'mL')
    })
    assert.equal(odd.length, 1)
    assert.equal(odd[0]['Item Code'], PLANTED.find((x) => x.type === 'unit_mismatch')!.itemCode)
  })

  test('every other item is ordinary (0.9–1.3) and one of them is counted in packs', () => {
    const planted = new Set(PLANTED.filter((p) => p.type !== 'wrong_item_code' && p.type !== 'factor_too_high').map((p) => p.itemCode))
    let inPacks = 0
    for (const it of items) {
      const code = String(it['Item Code'])
      if (planted.has(code)) continue
      const o = opname.find((r) => r['Item Code'] === code)!
      if (o.Unit === it['Pack Unit'] && it['Pack Unit'] !== it['Base Unit']) inPacks++
      if (PLANTED.some((p) => p.type === 'factor_too_high' && p.itemCode === code)) continue
      const r = actual(code) / estimated(code)
      assert.ok(r >= 0.9 && r <= 1.3, `${code} ratio ${r}`)
    }
    assert.ok(inPacks >= 1)
  })

  test('weekly sheet has a title row above the header and blank rows between weeks', () => {
    const rows = sheet(wb.usage, 'Weekly Usage').rows
    assert.notEqual(rows[0][0], 'Week')
    assert.ok(rows.some((r) => r.every((c) => c === null || c === '')))
  })

  test('deterministic', () => {
    assert.deepEqual(buildReagentWorkbooks(VOLUMES, '2026-10'), wb)
  })
})
