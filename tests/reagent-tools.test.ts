import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { makeReagentTools } from '../src/main/tools/reagent-tools'
import { visualDariHasil } from '../src/main/visual/sales'
import type { Finding, Summary } from '../src/main/reagent/rules'
import type { ToolContext } from '../src/main/tools/types'

const src = (p: string): string => readFileSync(p, 'utf8')
const ctx = {} as ToolContext
const finding: Finding = {
  id: 'factor_too_high:KIT-DNA-EXT', type: 'factor_too_high', itemCode: 'KIT-DNA-EXT', itemName: 'DNA Extraction Kit',
  estimated: 1587, actual: 616, ratio: 0.39, impliedFactor: 1.164, unit: 'test',
  explanation: 'Estimated usage 1,587 test is 2.58× the actual consumption 616 test.',
  evidence: [{ file: 'Reagent_Usage_2026-10.xlsx', sheet: 'Weekly Usage', row: 6 }, { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 }]
}
const NOT_CHECKED = [
  { itemCode: 'RGT-HPV-X', itemName: 'HPV X Kit', reason: 'linked test codes HPV999 have no test volume in the lab system for 2026-10', evidence: [{ file: 'Reagent_Usage_2026-10.xlsx', sheet: 'Item List', row: 9 }] },
  { itemCode: 'GHOST', itemName: 'Ghost', reason: 'code not in the Item List', evidence: [{ file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 14 }] }
]
const summary = (skipped = 0, notChecked = 0): Summary => ({
  month: '2026-10', itemsChecked: 12,
  byType: { wrong_item_code: 0, factor_too_high: 1, used_faster: 0, unit_mismatch: 0, no_physical_count: 0 },
  skipped: Array.from({ length: skipped }, (_, i) => ({ ref: { file: 'a.xlsx', sheet: 'S', row: i + 2 }, reason: 'missing item code' })),
  notChecked: NOT_CHECKED.slice(0, notChecked),
  filesRead: ['Reagent_Usage_2026-10.xlsx', 'Stock_Opname_2026-10.xlsx'], thresholds: { factorHigh: 2, usedFaster: 1.5 }
})
const ACTIONS = {
  month: '2026-10',
  reorder: [
    {
      itemCode: 'RGT-KRAS', itemName: 'KRAS Mutation Kit', baseUnit: 'test', packUnit: 'box', packSize: 24, closing: 6,
      dailyUse: 1.35, leadDays: 14, safetyDays: 7, leadDefault: true, safetyDefault: true, reorderPoint: 28.35, target: 68.85,
      orderBase: 62.85, orderPacks: 3, status: 'order_now' as const, reachesReorderPointOn: null, sheetOrderPacks: null,
      evidence: [{ file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 9 }]
    }
  ],
  excluded: [{ itemCode: 'ETH-ABS', itemName: 'Ethanol Absolute', reason: 'unit mismatch — consumption cannot be computed' }],
  investigation: [
    {
      id: 'factor_too_high:KIT-DNA-EXT', kind: 'factor_too_high' as const, itemCode: 'KIT-DNA-EXT', itemName: 'DNA Extraction Kit',
      headline: 'Per-test factor looks too high for DNA Extraction Kit',
      steps: [{ text: 'Compare the factor with the kit insert.', role: 'QA officer (suggested)' }],
      evidence: finding.evidence
    }
  ],
  recount: []
}
const calls: { run: Array<[string, string | undefined]>; evidence: Array<[string, string, string | undefined]> } = { run: [], evidence: [] }
const tools = (o: { folder?: string | null; skipped?: number; notChecked?: number } = {}) =>
  makeReagentTools({
    folder: () => (o.folder === undefined ? 'D:/demo' : o.folder),
    run: async (folder, month) => {
      calls.run.push([folder, month])
      return { summary: summary(o.skipped, o.notChecked), findings: [finding] }
    },
    actions: async (folder, month) => {
      calls.run.push([folder, month])
      return ACTIONS
    },
    evidence: async (folder, id, month) => {
      calls.evidence.push([folder, id, month])
      if (id !== finding.id) throw new Error(`Unknown finding "${id}". Run the reconciliation first and use a finding id from its result.`)
      return [{ ref: finding.evidence[0], cells: { 'Item Code': 'KIT-DNA-EXT', 'Factor per Test': 3 } }]
    }
  })
const get = (t: ReturnType<typeof tools>, name: string) => t.find((x) => x.name === name)!

describe('reagent tools', () => {
  test('reagent_reconcile returns findings with evidence and an honest completeness note', async () => {
    const j = JSON.parse(await get(tools(), 'reagent_reconcile').execute({}, ctx))
    assert.equal(j.month, '2026-10')
    assert.equal(j.findings[0].id, finding.id)
    assert.deepEqual(j.findings[0].evidence[1], { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 })
    assert.match(j.completenessNote, /Reagent_Usage_2026-10\.xlsx/)
    assert.match(j.completenessNote, /no rows were skipped/i)
    assert.equal(j.summary.notCheckedCount, 0)
    assert.deepEqual(j.notChecked, [])
  })

  test('skipped rows are named, not hidden', async () => {
    const j = JSON.parse(await get(tools({ skipped: 3 }), 'reagent_reconcile').execute({}, ctx))
    assert.match(j.completenessNote, /3 rows? (were )?skipped/i)
    assert.equal(j.skipped.length, 3)
  })

  test('items that could not be checked are counted, listed and named in the completeness note', async () => {
    const j = JSON.parse(await get(tools({ notChecked: 2 }), 'reagent_reconcile').execute({}, ctx))
    assert.equal(j.summary.notCheckedCount, 2)
    assert.equal(j.notChecked.length, 2)
    assert.equal(j.notChecked[0].itemCode, 'RGT-HPV-X')
    assert.match(j.completenessNote, /2 items could not be checked/)
    assert.match(j.completenessNote, /notChecked/)
    assert.doesNotMatch(j.completenessNote, /completely/)
    assert.doesNotMatch(j.completenessNote, /Do not claim anything was cut or missing/)
  })

  test('a non-empty month that is not YYYY-MM is refused with the format, never the newest month', async () => {
    calls.run.length = 0
    for (const month of ['October', '2026-13', '2026/10', '10-2026']) {
      await assert.rejects(get(tools(), 'reagent_reconcile').execute({ month }, ctx), /month must be YYYY-MM, e\.g\. 2026-10/, month)
    }
    assert.equal(calls.run.length, 0)
    await get(tools(), 'reagent_reconcile').execute({ month: '2026-10' }, ctx)
    await get(tools(), 'reagent_reconcile').execute({ month: '' }, ctx)
    assert.deepEqual(calls.run, [['D:/demo', '2026-10'], ['D:/demo', undefined]])
  })

  test('no folder chosen → tells the user where to choose it', async () => {
    await assert.rejects(get(tools({ folder: null }), 'reagent_reconcile').execute({}, ctx), /Reagent Check/)
  })

  test('reagent_evidence returns the cells; an unknown id explains how to get one', async () => {
    calls.evidence.length = 0
    const j = JSON.parse(await get(tools(), 'reagent_evidence').execute({ findingId: finding.id }, ctx))
    assert.equal(j.rows[0].cells['Factor per Test'], 3)
    await assert.rejects(get(tools(), 'reagent_evidence').execute({ findingId: 'x' }, ctx), /Run the reconciliation first/)
    // The user's folder and the month go to the service — evidence never depends on whichever run was last.
    await get(tools(), 'reagent_evidence').execute({ findingId: finding.id, month: '2026-10' }, ctx)
    assert.deepEqual(calls.evidence[0], ['D:/demo', finding.id, undefined])
    assert.deepEqual(calls.evidence[2], ['D:/demo', finding.id, '2026-10'])
    await assert.rejects(get(tools(), 'reagent_evidence').execute({ findingId: finding.id, month: 'Oct' }, ctx), /month must be YYYY-MM/)
    await assert.rejects(get(tools({ folder: null }), 'reagent_evidence').execute({ findingId: finding.id }, ctx), /Reagent Check/)
  })

  test('the card shows the findings table and the thresholds', async () => {
    const out = await get(tools(), 'reagent_reconcile').execute({}, ctx)
    const card = visualDariHasil('reagent_reconcile', out)!
    assert.ok(card)
    const tabel = card.panel.find((p) => p.jenis === 'tabel') as { baris: unknown[][] }
    assert.equal(tabel.baris.length, 1)
    assert.ok(JSON.stringify(tabel.baris[0]).includes('KIT-DNA-EXT'))
    assert.ok(card.catatan.some((c) => /2/.test(c) && /1\.5/.test(c)))
    assert.ok(JSON.stringify(tabel).includes('Actual ÷ est.'))
    assert.ok(!JSON.stringify(tabel).includes('"Ratio"'))
  })

  test('the card counts and notes items that could not be checked', async () => {
    const out = await get(tools({ notChecked: 2 }), 'reagent_reconcile').execute({}, ctx)
    const card = visualDariHasil('reagent_reconcile', out)!
    const kpi = card.panel.find((p) => p.jenis === 'kpi') as { item: Array<{ label: string; nilai: number }> }
    assert.equal(kpi.item.find((i) => i.label === 'Not checked')?.nilai, 2)
    assert.ok(card.catatan.some((c) => /2 items could not be checked/.test(c) && /RGT-HPV-X/.test(c)), JSON.stringify(card.catatan))
  })
})

describe('registration and prompt', () => {
  test('both tools are registered and step labels are English', () => {
    const s = src('src/main/tools/registry.ts')
    assert.match(s, /reagentTools/)
    const t = src('src/main/tools/reagent-tools.ts')
    assert.match(t, /label: 'Reagent reconciliation'/)
  })

  test('the mode prompt keeps the rules', () => {
    const s = src('src/main/agent/orchestrator.ts')
    const p = s.slice(s.indexOf('const REAGENT_PROMPT'), s.indexOf('const LAB_PROMPT'))
    assert.match(p, /Always answer in English\./)
    assert.match(p, /reagent_reconcile/)
    assert.match(p, /reagent_evidence/)
    assert.match(p, /not part of this version/)
    assert.match(p, /file.*sheet.*row/i)
  })
})

describe('bundled main process', () => {
  test('real dependencies are loaded with import(), never require() of a source path (fails after bundling)', () => {
    // Found from the app: require('../auth/service') → "Cannot find module" in out/main/index.js.
    const s = src('src/main/tools/reagent-tools.ts')
    assert.doesNotMatch(s, /require\(/)
    assert.match(s, /await import\('\.\.\/auth\/service'\)/)
  })
})

describe('reagent_actions (reorder + investigation)', () => {
  const exec = (o: Parameters<typeof tools>[0], args: Record<string, unknown>) =>
    tools(o).find((t) => t.name === 'reagent_actions')!.execute(args, ctx)

  test('reagent_actions returns the code-computed reorder list verbatim', async () => {
    const out = JSON.parse(String(await exec({}, { month: '2026-10' })))
    assert.equal(out.month, '2026-10')
    assert.equal(out.reorder[0].orderPacks, 3)
    assert.equal(out.reorder[0].status, 'order_now')
    assert.equal(out.reorder[0].leadDefault, true)
    assert.equal(out.excluded[0].itemCode, 'ETH-ABS')
    assert.equal(out.investigation[0].steps[0].role, 'QA officer (suggested)')
    assert.match(out.completenessNote, /computed by code/)
    assert.match(out.completenessNote, /ETH-ABS/)
  })

  test('refuses a bad month', async () => {
    await assert.rejects(exec({}, { month: 'October' }), /YYYY-MM/)
  })

  test('no folder → the NO_FOLDER message', async () => {
    await assert.rejects(exec({ folder: null }, {}), /Reagent Check screen/)
  })

  test('reagent_actions belongs to the reagent group and the prompt sends reorder questions to it', async () => {
    const { groupOf } = await import('../src/main/agent/tool-groups')
    assert.equal(groupOf('reagent_actions'), 'reagent')
    const s = src('src/main/agent/orchestrator.ts')
    const p = s.slice(s.indexOf('const REAGENT_PROMPT'), s.indexOf('const LAB_PROMPT'))
    assert.match(p, /reagent_actions/)
    assert.doesNotMatch(p, /Reorder quantities, purchase plans, exports and memos are not part of this version/)
  })
})

describe('reagent_actions wording for people', () => {
  test('prompt and tool note ask for plain words, never the field names (seen in the app: "status order_now, orderPacks 2 box")', async () => {
    const s = src('src/main/agent/orchestrator.ts')
    const p = s.slice(s.indexOf('const REAGENT_PROMPT'), s.indexOf('const LAB_PROMPT'))
    assert.match(p, /never write field names/i)
    assert.doesNotMatch(p, /orderPacks/)
    const out = JSON.parse(String(await tools({}).find((t) => t.name === 'reagent_actions')!.execute({}, ctx)))
    assert.match(out.completenessNote, /Order now/)
    assert.match(out.completenessNote, /never the field names/)
    assert.doesNotMatch(out.completenessNote, /quote orderPacks/)
  })
})
