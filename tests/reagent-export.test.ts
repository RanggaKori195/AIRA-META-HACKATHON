import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildActionsWorkbook } from '../src/main/reagent/export'
import { draftSummary, summaryFacts } from '../src/main/reagent/summary'
import type { ReagentActions, RecountRow } from '../src/shared/reagent'

const ref = { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 8 }
const A: ReagentActions = {
  month: '2026-10',
  reorder: [
    {
      itemCode: 'RGT-KRAS', itemName: 'KRAS Mutation Kit', baseUnit: 'test', packUnit: 'box', packSize: 24, closing: 6,
      dailyUse: 1.35, leadDays: 14, safetyDays: 7, leadDefault: true, safetyDefault: true, reorderPoint: 28.35, target: 68.85,
      orderBase: 62.85, orderPacks: 3, status: 'order_now', reachesReorderPointOn: null, sheetOrderPacks: null, evidence: [ref]
    },
    {
      itemCode: 'KIT-DNA-EXT', itemName: 'DNA Extraction Kit', baseUnit: 'test', packUnit: 'box', packSize: 50, closing: 300,
      dailyUse: 19.87, leadDays: 21, safetyDays: 7, leadDefault: false, safetyDefault: false, reorderPoint: 556.36, target: 1152.46,
      orderBase: 852.46, orderPacks: 18, status: 'order_now', reachesReorderPointOn: null, sheetOrderPacks: 64, evidence: [ref]
    }
  ],
  excluded: [{ itemCode: 'ETH-ABS', itemName: 'Ethanol Absolute', reason: 'unit mismatch — consumption cannot be computed' }],
  investigation: [
    {
      id: 'factor_too_high:KIT-DNA-EXT', kind: 'factor_too_high', itemCode: 'KIT-DNA-EXT', itemName: 'DNA Extraction Kit',
      headline: 'Per-test factor looks too high for DNA Extraction Kit',
      steps: [{ text: 'Compare the factor with the kit insert.', role: 'QA officer (suggested)' }], evidence: [ref]
    }
  ],
  recount: [
    { itemCode: 'RGT-EGFR', itemName: 'EGFR Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', opnameUnit: 'test', closing: 72, refs: [ref] }
  ]
}
const ROW: RecountRow = {
  id: 'r1', phrase: 'EGFR mutation kit, two boxes', itemCode: 'RGT-EGFR', candidates: ['RGT-EGFR'], count: 2, heardUnit: 'box',
  unit: 'box', unitAssumed: false, voiceBase: 48, fileBase: 72, diffBase: -24, diffPacks: -1, status: 'differs', refs: [ref]
}

async function read(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb
}
const values = (ws: ExcelJS.Worksheet): unknown[][] => {
  const out: unknown[][] = []
  ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)))
  return out
}

describe('reagent actions export', () => {
  test('workbook sheets and values equal the input', async () => {
    const wb = await read(await buildActionsWorkbook(A, [ROW]))
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Reorder', 'Investigation', 'Recount'])
    const reorder = values(wb.getWorksheet('Reorder')!)
    const kit = reorder.find((r) => r.includes('KIT-DNA-EXT'))!
    assert.ok(kit.includes(18) && kit.includes(64), JSON.stringify(kit))
    assert.ok(reorder.some((r) => r.includes('ETH-ABS') && r.some((c) => typeof c === 'string' && /unit mismatch/.test(c))))
    const inv = values(wb.getWorksheet('Investigation')!)
    assert.ok(inv.some((r) => r.includes('Compare the factor with the kit insert.')))
    assert.ok(inv.some((r) => r.includes('recount_differs') || r.some((c) => typeof c === 'string' && /third time/.test(c))))
    const rc = values(wb.getWorksheet('Recount')!)
    const egfr = rc.find((r) => r.includes('RGT-EGFR'))!
    assert.ok(egfr.includes(-24) && egfr.includes(-1) && egfr.includes('Differs'), JSON.stringify(egfr))
  })

  test('export rejects foreign codes', async () => {
    await assert.rejects(buildActionsWorkbook(A, [{ ...ROW, itemCode: 'NOT-IN-MONTH' }]), /NOT-IN-MONTH/)
  })
})

describe('AI draft summary', () => {
  test('prompt contains only listed numbers and the no-other-numbers instruction', async () => {
    let prompt = ''
    const text = await draftSummary(A, async (p) => {
      prompt = p
      return '  The DNA extraction kit factor looks too high.  '
    })
    assert.equal(text, 'The DNA extraction kit factor looks too high.')
    assert.match(prompt, /Do not state any number that is not listed/)
    assert.match(prompt, /2026-10/)
    assert.match(prompt, /KRAS Mutation Kit: order 3 box/)
    assert.match(prompt, /DNA Extraction Kit: order 18 box .*sheet factor would order 64/)
    assert.match(prompt, /Per-test factor looks too high for DNA Extraction Kit/)
    assert.match(prompt, /Always answer in English/)
  })

  test('an empty model answer is an error, not a blank summary', async () => {
    await assert.rejects(draftSummary(A, async () => '   '), /empty/)
  })
})

describe('export recomputes the recount rows', () => {
  test('stale renderer numbers are not written — the rows are compared again with the month', async () => {
    const stale: RecountRow = { ...ROW, voiceBase: 72, fileBase: 72, diffBase: 0, diffPacks: 0, status: 'matches' }
    const wb = await read(await buildActionsWorkbook(A, [stale]))
    const rc = values(wb.getWorksheet('Recount')!)
    const egfr = rc.find((r) => r.includes('RGT-EGFR'))!
    assert.ok(egfr.includes(-24) && egfr.includes('Differs'), JSON.stringify(egfr))
  })
})

describe('summary facts', () => {
  test('the prompt carries exactly the facts the number check uses', async () => {
    let prompt = ''
    await draftSummary(A, async (p) => ((prompt = p), 'ok'))
    const facts = summaryFacts(A)
    assert.ok(facts.length >= 3)
    for (const f of facts) assert.ok(prompt.includes(f), f)
  })
})
