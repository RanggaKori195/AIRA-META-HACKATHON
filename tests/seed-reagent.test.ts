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

describe('demo data for reorder and voice recount', () => {
  const run = async () => {
    const { mkdtempSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const ExcelJS = (await import('exceljs')).default
    const { actions, clearReagentCache } = await import('../src/main/reagent/service')
    const seed = await import('../scripts/seed/reagent')
    const wb = seed.buildReagentWorkbooks(VOLUMES, '2026-10')
    const dir = mkdtempSync(join(tmpdir(), 'seed-act-'))
    for (const [file, sheets] of [['Reagent_Usage_2026-10.xlsx', wb.usage], ['Stock_Opname_2026-10.xlsx', wb.opname]] as const) {
      const x = new ExcelJS.Workbook()
      for (const s of sheets) {
        const ws = x.addWorksheet(s.name)
        for (const r of s.rows) ws.addRow(r)
      }
      await x.xlsx.writeFile(join(dir, file))
    }
    clearReagentCache()
    const a = await actions({ folder: dir, deps: { volumes: async () => VOLUMES } })
    if ('error' in a) throw new Error(a.error)
    return { a, wb, seed }
  }

  test('item list has lead/safety for some items and blanks for others', () => {
    const wb = buildReagentWorkbooks(VOLUMES, '2026-10')
    const items = table(sheet(wb.usage, 'Item List'), 'Item Code')
    const lead = items.map((i) => i['Lead Time (days)'])
    assert.ok(lead.some((v) => typeof v === 'number'))
    assert.ok(lead.some((v) => v === null))
    assert.ok(items.some((i) => typeof i['Safety Stock (days)'] === 'number'))
  })

  test('low-stock items are order_now and the four planted findings are unchanged', async () => {
    const { a, seed } = await run()
    const now = a.reorder.filter((l) => l.status === 'order_now').map((l) => l.itemCode).sort()
    assert.deepEqual(now, [...seed.LOW_STOCK].sort())
    assert.deepEqual(a.investigation.map((i) => i.kind).sort(), ['factor_too_high', 'unit_mismatch', 'used_faster', 'wrong_item_code'])
    const kit = a.reorder.find((l) => l.itemCode === 'KIT-DNA-EXT')!
    assert.ok(kit.sheetOrderPacks !== null && kit.sheetOrderPacks > kit.orderPacks, JSON.stringify(kit))
  })

  test('the voice script yields exactly one differs (RGT-EGFR, -1 pack), one not_recognized, matches for the rest', async () => {
    const { a, wb, seed } = await run()
    const { parseRecount } = await import('../src/shared/recount')
    const rows = parseRecount(seed.buildVoiceScript(wb.opname), a.recount)
    const differs = rows.filter((r) => r.status === 'differs')
    assert.deepEqual(differs.map((r) => [r.itemCode, r.diffPacks]), [[seed.RECOUNT_PLANTED.itemCode, -seed.RECOUNT_PLANTED.packsBelow]])
    const unknown = rows.filter((r) => r.status === 'not_recognized')
    assert.equal(unknown.length, 1)
    assert.match(unknown[0].phrase, new RegExp(seed.RECOUNT_UNKNOWN))
    assert.deepEqual(rows.filter((r) => !['differs', 'not_recognized'].includes(r.status)).map((r) => r.status).filter((s) => s !== 'matches'), [])
    assert.ok(rows.filter((r) => r.status === 'matches').length >= 8)
  })
})
