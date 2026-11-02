import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import ExcelJS from 'exceljs'
import { parseUsageWorkbook, parseOpnameWorkbook } from '../src/main/reagent/parse'
import { canonCode, toBase } from '../src/main/reagent/normalize'

const dir = mkdtempSync(join(tmpdir(), 'reagent-parse-'))

async function write(file: string, sheets: Record<string, (string | number | null)[][]>): Promise<string> {
  const wb = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name)
    rows.forEach((r) => ws.addRow(r))
  }
  const p = join(dir, file)
  await wb.xlsx.writeFile(p)
  return p
}

describe('normalisation', () => {
  test('item codes have one canonical form', () => {
    assert.equal(canonCode(' kit hpv_01 '), 'KIT-HPV-01')
    assert.equal(canonCode('KIT--HPV  01'), 'KIT-HPV-01')
  })
  test('units convert to the base unit or return null', () => {
    const box = { baseUnit: 'test', packSize: 96, packUnit: 'box' }
    assert.equal(toBase(2, 'box', box), 192)
    assert.equal(toBase(5, 'test', box), 5)
    assert.equal(toBase(500, 'µL', { baseUnit: 'mL', packSize: 1, packUnit: 'tube' }), 0.5)
    assert.equal(toBase(500, 'uL', { baseUnit: 'mL', packSize: 1, packUnit: 'tube' }), 0.5)
    assert.equal(toBase(1, 'L', { baseUnit: 'mL', packSize: 1, packUnit: 'tube' }), 1000)
    assert.equal(toBase(1, 'kit', { baseUnit: 'mL', packSize: 1000, packUnit: 'bottle' }), null)
  })
  test('unit matching ignores case and accepts Greek mu, ul, and L↔mL when the base is L', () => {
    const ml = { baseUnit: 'mL', packSize: 1, packUnit: 'tube' }
    assert.equal(toBase(500, 'μL', ml), 0.5) // Greek small mu U+03BC
    assert.equal(toBase(500, 'ul', ml), 0.5)
    assert.equal(toBase(500, 'UL', ml), 0.5)
    assert.equal(toBase(2, 'ML', ml), 2)
    assert.equal(toBase(1, 'l', ml), 1000)
    const l = { baseUnit: 'L', packSize: 5, packUnit: 'jerrycan' }
    assert.equal(toBase(500, 'mL', l), 0.5)
    assert.equal(toBase(1, 'JERRYCAN', l), 5)
    assert.equal(toBase(2, 'Mg', { baseUnit: 'g', packSize: 1, packUnit: 'jar' }), 0.002)
  })
})

describe('usage workbook', () => {
  let r: Awaited<ReturnType<typeof parseUsageWorkbook>>
  before(async () => {
    const p = await write('Reagent_Usage_2026-10.xlsx', {
      'Weekly Usage': [
        ['Reagent usage — test'],
        ['Unit', 'Item Name', 'Week', 'Item Code', 'Test Volume', 'Factor per Test', 'Test Code', 'Estimated Usage'],
        ['test', 'Kit A', 'W1', 'kit a', 10, 1, 'T1', 10],
        [null, null, null, null, null, null, null, null],
        ['test', 'Kit A', 'W2', 'KIT-A', 'twelve', 1, 'T1', 12],
        ['test', 'Kit B', 'W2', '', 5, 1, 'T2', 5]
      ],
      'Item List': [
        ['Item Code', 'Item Name', 'Base Unit', 'Pack Size', 'Pack Unit', 'Test Code(s)', 'Standard Factor'],
        ['KIT-A', 'Kit A', 'test', 96, 'box', 'T1, T2', 1]
      ],
      Notes: [['nothing here']]
    })
    r = await parseUsageWorkbook(p)
  })

  test('columns found in any order below a title row, row numbers are Excel rows', () => {
    assert.equal(r.usage.length, 1)
    assert.deepEqual(
      { code: r.usage[0].code, rawCode: r.usage[0].rawCode, volume: r.usage[0].volume, factor: r.usage[0].factor, week: r.usage[0].week },
      { code: 'KIT-A', rawCode: 'kit a', volume: 10, factor: 1, week: 'W1' }
    )
    assert.deepEqual(r.usage[0].ref, { file: 'Reagent_Usage_2026-10.xlsx', sheet: 'Weekly Usage', row: 3 })
  })

  test('item list parsed with linked tests', () => {
    assert.equal(r.items.length, 1)
    assert.deepEqual(r.items[0].tests, ['T1', 'T2'])
    assert.equal(r.items[0].packSize, 96)
    assert.equal(r.items[0].ref.row, 2)
  })

  test('unreadable rows are skipped with a reason; blank rows are ignored silently', () => {
    const rows = r.skipped.map((s) => [s.ref.sheet, s.ref.row, s.reason])
    assert.ok(rows.some(([sh, row, why]) => sh === 'Weekly Usage' && row === 5 && /not a number/i.test(String(why))), JSON.stringify(rows))
    assert.ok(rows.some(([sh, row, why]) => sh === 'Weekly Usage' && row === 6 && /item code/i.test(String(why))), JSON.stringify(rows))
    assert.ok(!rows.some(([, row]) => row === 4))
  })

  test('a sheet without a recognisable header is reported, not ignored', () => {
    assert.ok(r.skipped.some((s) => s.ref.sheet === 'Notes' && /header not found/.test(s.reason)))
  })
})

describe('opname workbook', () => {
  test('rows parsed with units and Excel row numbers; Indonesian header aliases accepted', async () => {
    const p = await write('Stock_Opname_2026-10.xlsx', {
      'Stock Opname': [
        ['Kode Item', 'Item Name', 'Stok Awal', 'Received', 'Stok Akhir', 'Unit'],
        ['KIT-A', 'Kit A', 3, 1, 2.5, 'box']
      ]
    })
    const r = await parseOpnameWorkbook(p)
    assert.deepEqual(
      { code: r.opname[0].code, opening: r.opname[0].opening, received: r.opname[0].received, closing: r.opname[0].closing, unit: r.opname[0].unit },
      { code: 'KIT-A', opening: 3, received: 1, closing: 2.5, unit: 'box' }
    )
    assert.equal(r.opname[0].ref.row, 2)
    assert.equal(r.skipped.length, 0)
  })

  test('the committed demo files parse with only the expected skips', async () => {
    const u = await parseUsageWorkbook('demo-data/reagent/Reagent_Usage_2026-10.xlsx')
    const o = await parseOpnameWorkbook('demo-data/reagent/Stock_Opname_2026-10.xlsx')
    assert.equal(u.skipped.length, 0, JSON.stringify(u.skipped))
    assert.equal(o.skipped.length, 0, JSON.stringify(o.skipped))
    assert.equal(u.items.length, 12)
    assert.equal(u.usage.length, 48)
    assert.equal(o.opname.length, 12)
  })
  test('text numbers: thousands grouping never becomes a decimal; ambiguous text is skipped with a reason', async () => {
    const p = await write('Stock_Opname_numbers.xlsx', {
      'Stock Opname': [
        ['Item Code', 'Opening Stock', 'Received', 'Closing Count', 'Unit'],
        ['A', '12', '1,5', '0.25', 'test'], // row 2: plain and single decimal separators
        ['B', '1,200', 0, 0, 'test'], // row 3: ambiguous
        ['C', '1.200', 0, 0, 'test'], // row 4: ambiguous
        ['D', '1.200,5', '1,200.5', 0, 'test'], // row 5: both separators → unambiguous
        ['E', '1.200.000', '0,250', 0, 'test'] // row 6: repeated grouping → integer; leading zero → decimal
      ]
    })
    const r = await parseOpnameWorkbook(p)
    const by = Object.fromEntries(r.opname.map((o) => [o.code, o]))
    assert.deepEqual([by.A?.opening, by.A?.received, by.A?.closing], [12, 1.5, 0.25])
    assert.ok(!by.B && !by.C, JSON.stringify(r.opname))
    assert.deepEqual([by.D?.opening, by.D?.received], [1200.5, 1200.5])
    assert.deepEqual([by.E?.opening, by.E?.received], [1200000, 0.25])
    const reason = (row: number) => r.skipped.find((s) => s.ref.row === row)?.reason ?? ''
    assert.match(reason(3), /ambiguous number "1,200" .*— write it as a plain number/)
    assert.match(reason(4), /ambiguous number "1\.200"/)
  })

  test('usage Unit column is optional: a blank unit means the item base unit, the row is not skipped', async () => {
    const p = await write('Reagent_Usage_nounit.xlsx', {
      'Weekly Usage': [
        ['Week', 'Item Code', 'Item Name', 'Test Code', 'Test Volume', 'Factor per Test'],
        ['W1', 'KIT-A', 'Kit A', 'T1', 10, 1]
      ],
      'Weekly Usage 2': [
        ['Week', 'Item Code', 'Item Name', 'Test Code', 'Test Volume', 'Factor per Test', 'Unit'],
        ['W2', 'KIT-A', 'Kit A', 'T1', 10, 1, null]
      ],
      'Item List': [
        ['Item Code', 'Item Name', 'Base Unit', 'Pack Size', 'Pack Unit', 'Test Code(s)', 'Standard Factor'],
        ['KIT-A', 'Kit A', 'mL', 96, 'box', 'T1', 1]
      ]
    })
    const r = await parseUsageWorkbook(p)
    assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped))
    assert.deepEqual(r.usage.map((u) => u.unit), ['mL', 'mL'])
  })
})
