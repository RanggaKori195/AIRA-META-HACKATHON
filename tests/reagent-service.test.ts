import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import { join } from 'path'
import { tmpdir } from 'os'
import { availableMonths, runReconciliation, evidenceRows, clearReagentCache } from '../src/main/reagent/service'
import { SQL_REAGENT_VOLUMES } from '../src/main/reagent/volumes'

const VOLUMES = { HPV101: 158, HPV102: 118, HPV103: 122, MOL101: 39, MOL102: 42, MOL103: 50, LBC101: 125 }
const deps = { volumes: async () => VOLUMES }

describe('reagent service', () => {
  let dir = ''
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'reagent-svc-'))
    copyFileSync('demo-data/reagent/Reagent_Usage_2026-10.xlsx', join(dir, 'Reagent_Usage_2026-10.xlsx'))
    copyFileSync('demo-data/reagent/Stock_Opname_2026-10.xlsx', join(dir, 'Stock_Opname_2026-10.xlsx'))
    writeFileSync(join(dir, 'Reagent_Usage_2026-09.xlsx'), 'no partner opname file')
  })

  test('months need both files; newest first', () => {
    assert.deepEqual(availableMonths(dir), ['2026-10'])
    assert.deepEqual(availableMonths(join(dir, 'missing')), [])
  })

  test('runs on the newest month and finds the planted anomalies', async () => {
    clearReagentCache()
    const r = await runReconciliation({ folder: dir, deps })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.summary.month, '2026-10')
    assert.deepEqual(r.findings.map((f) => f.type).sort(), ['factor_too_high', 'unit_mismatch', 'used_faster', 'wrong_item_code'])
    assert.deepEqual(r.summary.filesRead, ['Reagent_Usage_2026-10.xlsx', 'Stock_Opname_2026-10.xlsx'])
  })

  test('second run without changes returns the cached result; a touched file invalidates it', async () => {
    clearReagentCache()
    const a = await runReconciliation({ folder: dir, deps })
    const b = await runReconciliation({ folder: dir, deps })
    assert.equal(a, b)
    const later = new Date(Date.now() + 5000)
    utimesSync(join(dir, 'Stock_Opname_2026-10.xlsx'), later, later)
    const c = await runReconciliation({ folder: dir, deps })
    assert.notEqual(c, a)
  })

  test('missing folder or month gives an error that names it', async () => {
    const r = await runReconciliation({ folder: join(dir, 'nope'), deps })
    assert.ok('error' in r && /nope/.test(r.error))
    const m = await runReconciliation({ folder: dir, month: '2025-01', deps })
    assert.ok('error' in m && /2025-01/.test(m.error))
  })

  test('evidence rows come back with their cells — without any earlier run (no global last-run cache)', async () => {
    clearReagentCache()
    const rows = await evidenceRows({ folder: dir, month: '2026-10', findingId: 'unit_mismatch:ETH-ABS', deps })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].ref.sheet, 'Stock Opname')
    assert.equal(rows[0].cells['Item Code'], 'ETH-ABS')
    assert.equal(rows[0].cells['Unit'], 'kit')
    await assert.rejects(evidenceRows({ folder: dir, month: '2026-10', findingId: 'nope:X', deps }), /unknown finding/i)
    await assert.rejects(evidenceRows({ folder: dir, month: '2025-01', findingId: 'unit_mismatch:ETH-ABS', deps }), /2025-01/)
  })

  test('evidence is read from the folder asked for, and the cache keeps one result per folder|month', async () => {
    // Folder B: same files, but ETH-ABS counted in "carton".
    const dirB = join(dir, 'b')
    mkdirSync(dirB, { recursive: true })
    copyFileSync('demo-data/reagent/Reagent_Usage_2026-10.xlsx', join(dirB, 'Reagent_Usage_2026-10.xlsx'))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile('demo-data/reagent/Stock_Opname_2026-10.xlsx')
    const ws = wb.worksheets[0]
    ws.eachRow((row) => {
      if (row.getCell(1).value === 'ETH-ABS') row.getCell(6).value = 'carton'
    })
    await wb.xlsx.writeFile(join(dirB, 'Stock_Opname_2026-10.xlsx'))

    clearReagentCache()
    const a1 = await runReconciliation({ folder: dir, month: '2026-10', deps })
    await runReconciliation({ folder: dirB, month: '2026-10', deps })
    const a2 = await runReconciliation({ folder: dir, month: '2026-10', deps })
    assert.equal(a1, a2, 'running folder B must not evict folder A')
    const fromA = await evidenceRows({ folder: dir, month: '2026-10', findingId: 'unit_mismatch:ETH-ABS', deps })
    const fromB = await evidenceRows({ folder: dirB, month: '2026-10', findingId: 'unit_mismatch:ETH-ABS', deps })
    assert.equal(fromA[0].cells['Unit'], 'kit')
    assert.equal(fromB[0].cells['Unit'], 'carton')
  })

  test('the demo files leave no item unchecked', async () => {
    clearReagentCache()
    const r = await runReconciliation({ folder: dir, month: '2026-10', deps })
    if ('error' in r) throw new Error(r.error)
    assert.deepEqual(r.summary.notChecked, [])
  })

  test('volume SQL is aggregate-only and uses the recognition clause', () => {
    assert.match(SQL_REAGENT_VOLUMES, /count\(\*\)/)
    assert.match(SQL_REAGENT_VOLUMES, /transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL/)
    assert.doesNotMatch(SQL_REAGENT_VOLUMES, /patient|dob|diagnosis|result\b/i)
  })
})
