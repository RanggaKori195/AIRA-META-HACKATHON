import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReagentView, { type ReagentViewProps } from '../src/renderer/src/components/reagent/ReagentView'
import { TYPE_LABEL, fmtRatio } from '../src/renderer/src/components/reagent/bantu'
import { FINDING_TYPES, type Finding, type Summary } from '../src/shared/reagent'
import { checkNumbers } from '../src/shared/number-check'

;(globalThis as { React?: unknown }).React = React
const src = (p: string): string => readFileSync(p, 'utf8')

const f = (type: Finding['type'], code: string, ratio: number | null): Finding => ({
  id: `${type}:${code}`, type, itemCode: code, itemName: `${code} name`, estimated: ratio ? 300 : null, actual: ratio ? 100 : null,
  ratio, impliedFactor: ratio ? 1 : null, unit: 'test', explanation: `explanation for ${code}`,
  evidence: [{ file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 }]
})
const summary: Summary = {
  month: '2026-10', itemsChecked: 12,
  byType: { wrong_item_code: 1, factor_too_high: 1, used_faster: 1, unit_mismatch: 1, no_physical_count: 0 },
  skipped: [], notChecked: [], filesRead: ['Reagent_Usage_2026-10.xlsx', 'Stock_Opname_2026-10.xlsx'], thresholds: { factorHigh: 2, usedFaster: 1.5 }
}
const findings = [f('wrong_item_code', 'RGT-HPV-GT14', null), f('factor_too_high', 'KIT-DNA-EXT', 3), f('used_faster', 'TIP-FLT-200', 1.8), f('unit_mismatch', 'ETH-ABS', null)]
const noop = (): void => undefined
const view = (p: Partial<ReagentViewProps>): string =>
  renderToStaticMarkup(
    React.createElement(ReagentView, {
      status: { folder: 'D:/demo-data/reagent', months: ['2026-10'] }, month: '2026-10', result: { summary, findings },
      running: false, selected: null, evidence: null, text: '',
      onChooseFolder: noop, onRun: noop, onMonth: noop, onSelect: noop, onAsk: noop, onText: noop, onSubmit: noop,
      ...p
    })
  )

describe('Reagent Check screen', () => {
  test('every finding type has an English label', () => {
    for (const t of FINDING_TYPES) assert.ok(TYPE_LABEL[t] && /^[A-Z]/.test(TYPE_LABEL[t]), t)
    assert.equal(fmtRatio(3), '3.00×')
    assert.equal(fmtRatio(null), '—')
  })

  test('findings table shows each type, the ratio and an Evidence control per row', () => {
    const html = view({})
    for (const t of ['Wrong item code', 'Factor too high', 'Used faster than estimated', 'Unit mismatch']) assert.match(html, new RegExp(t), t)
    assert.match(html, /3\.00×/)
    assert.equal((html.match(/>Evidence</g) ?? []).length, 4)
    assert.match(html, />Run reconciliation</)
    assert.match(html, /Items checked/)
  })

  test('selecting a finding shows its source rows and "Ask AIRA about this"', () => {
    const html = view({
      selected: 'factor_too_high:KIT-DNA-EXT',
      evidence: [{ ref: { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 5 }, cells: { 'Item Code': 'KIT-DNA-EXT', 'Closing Count': 616 } }]
    })
    assert.match(html, /Stock_Opname_2026-10\.xlsx/)
    assert.match(html, /row 5/)
    assert.match(html, /616/)
    assert.match(html, /Ask AIRA about this/)
  })

  test('table header says "Actual ÷ est.", not "Ratio"', () => {
    const html = view({})
    assert.match(html, />Actual ÷ est\.</)
    assert.doesNotMatch(html, />Ratio</)
  })

  test('items that could not be checked: a "Not checked" count and a list with the reasons under the table', () => {
    const notChecked = [
      { itemCode: 'RGT-HPV-X', itemName: 'HPV X Kit', reason: 'linked test codes HPV999 have no test volume in the lab system for 2026-10', evidence: [{ file: 'Reagent_Usage_2026-10.xlsx', sheet: 'Item List', row: 9 }] }
    ]
    const html = view({ result: { summary: { ...summary, notChecked }, findings } })
    assert.match(html, /Not checked<\/span><strong>1</)
    assert.match(html, /RGT-HPV-X/)
    assert.match(html, /HPV999 have no test volume/)
    assert.match(html, /Item List › row 9/)
    assert.match(view({}), /Not checked<\/span><strong>0</)
  })

  test('an evidence error is shown in the panel instead of an empty list', () => {
    const html = view({ selected: 'factor_too_high:KIT-DNA-EXT', evidence: null, evidenceError: 'The folder "X" does not exist.' })
    assert.match(html, /The folder &quot;X&quot; does not exist\./)
    assert.doesNotMatch(html, /Loading source rows/)
  })

  test('ReagentHome passes the shown month with the finding id and ignores a stale response', () => {
    const h = src('src/renderer/src/views/ReagentHome.tsx')
    assert.match(h, /reagentEvidence\(\{\s*findingId: id,\s*month/)
    assert.match(h, /useRef/)
    assert.match(h, /latest\.current !== id/)
    assert.match(h, /setEvidenceError/)
  })

  test('no folder → empty state that asks to choose it', () => {
    const html = view({ status: { folder: null, months: [] }, result: null })
    assert.match(html, /Choose the folder with the usage and stock-opname files/)
  })

  test('an error from the engine is shown, not hidden', () => {
    assert.match(view({ result: { error: 'No month in "X" has both files.' } }), /No month in/)
  })

  test('App shows Reagent Check only with the permission and routes the mode to the screen', () => {
    const a = src('src/renderer/src/App.tsx')
    assert.match(a, /session\.menu\.includes\('reagent'\)/)
    assert.match(a, /mode === 'reagent' \? \(\s*<ReagentHome/)
  })
})

describe('reagent screen looks like the other data screens and greets with the mascot', () => {
  test('header carries the icon tile used by the other data homes', () => {
    assert.match(view({}), /class="tile-ikon rg-kepala-ikon"/)
  })

  test('folder chosen, nothing run yet → the mascot explains the four checks, named from TYPE_LABEL', () => {
    const html = view({ result: null, mascotArt: 'idle.png' })
    assert.match(html, /class="rg-mulai"/)
    assert.match(html, /src="idle\.png"/)
    assert.match(html, /Pick the month and press Run reconciliation/)
    for (const t of ['wrong_item_code', 'factor_too_high', 'used_faster', 'unit_mismatch'] as const) {
      assert.match(html, new RegExp(TYPE_LABEL[t]), t)
    }
  })

  test('the greeting gives way to results, to a run in progress and to the no-folder hint', () => {
    assert.doesNotMatch(view({ mascotArt: 'idle.png' }), /rg-mulai/)
    assert.doesNotMatch(view({ result: null, running: true, mascotArt: 'idle.png' }), /rg-mulai/)
    assert.doesNotMatch(view({ result: null, status: { folder: null, months: [] }, mascotArt: 'idle.png' }), /rg-mulai/)
  })
})

describe('reagent screen: Reorder & actions and Voice recount tabs', () => {
  const ref = { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 9 }
  const line = (code: string, status: 'order_now' | 'order_soon' | 'ok', o: Record<string, unknown> = {}) => ({
    itemCode: code, itemName: `${code} name`, baseUnit: 'test', packUnit: 'box', packSize: 24, closing: 6, dailyUse: 1.35,
    leadDays: 14, safetyDays: 7, leadDefault: true, safetyDefault: false, reorderPoint: 28.35, target: 68.85, orderBase: 62.85,
    orderPacks: 3, status, reachesReorderPointOn: status === 'ok' ? '2026-12-09' : null, sheetOrderPacks: null, evidence: [ref], ...o
  })
  const actions = {
    month: '2026-10',
    reorder: [line('RGT-KRAS', 'order_now'), line('KIT-DNA-EXT', 'order_soon', { orderPacks: 2, sheetOrderPacks: 64 }), line('RGT-HPV-HR', 'ok', { orderPacks: 0 })],
    excluded: [{ itemCode: 'ETH-ABS', itemName: 'Ethanol Absolute', reason: 'unit mismatch — consumption cannot be computed' }],
    investigation: [
      { id: 'used_faster:TIP', kind: 'used_faster' as const, itemCode: 'TIP-FLT-200', itemName: 'Filter Tips 200 uL', headline: 'Filter Tips 200 uL was used faster than the tests explain', steps: [{ text: 'Check for repeat runs, failed runs and QC use in the period.', role: 'QA officer (suggested)' }], evidence: [ref] }
    ],
    recount: [{ itemCode: 'RGT-EGFR', itemName: 'EGFR Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', opnameUnit: 'test', closing: 72, refs: [ref] }]
  }
  const row = (o: Record<string, unknown>) => ({
    id: 'r1', phrase: 'EGFR mutation kit, two boxes', itemCode: 'RGT-EGFR', candidates: ['RGT-EGFR'], count: 2, heardUnit: 'box', unit: 'box',
    unitAssumed: false, voiceBase: 48, fileBase: 72, diffBase: -24, diffPacks: -1, status: 'differs' as const, refs: [ref], ...o
  })
  const recount = (o: Record<string, unknown> = {}) => ({ transcript: '', rows: [], notCounted: [], recording: false, transcribing: false, error: null, ...o })

  test('tabs appear only after a successful run', () => {
    assert.match(view({ actions }), /class="rg-tabs"/)
    assert.match(view({ actions }), />Reorder &amp; actions</)
    assert.match(view({ actions }), />Voice recount</)
    assert.doesNotMatch(view({ result: null, actions }), /rg-tabs/)
    assert.doesNotMatch(view({ result: { error: 'x' }, actions }), /rg-tabs/)
  })

  test('reorder tab: order_now rows first, packs and default flags shown, factor-too-high shows both quantities and the saving', () => {
    const html = view({ tab: 'reorder', actions })
    const now = html.indexOf('RGT-KRAS')
    const soon = html.indexOf('KIT-DNA-EXT')
    const ok = html.indexOf('RGT-HPV-HR')
    assert.ok(now > 0 && now < soon && soon < ok)
    assert.match(html, />Order now</)
    assert.match(html, /3 box/)
    assert.match(html, /14 days \(default\)/)
    assert.match(html, /sheet factor would order 64 box — 62 box more/i)
    assert.match(html, /2026-12-09/)
  })

  test('excluded items listed with reasons', () => {
    const html = view({ tab: 'reorder', actions })
    assert.match(html, /ETH-ABS/)
    assert.match(html, /unit mismatch — consumption cannot be computed/)
  })

  test('investigation steps with evidence and "(suggested)" roles; AI draft label on the summary', () => {
    const html = view({ tab: 'reorder', actions, summary: { text: 'Order KRAS now.', loading: false } })
    assert.match(html, /Check for repeat runs/)
    assert.match(html, /QA officer \(suggested\)/)
    assert.match(html, /Stock_Opname_2026-10\.xlsx › Stock Opname › row 9/)
    assert.match(html, /AI draft — check before sharing/)
    assert.match(html, /Order KRAS now\./)
    assert.match(html, />Export to Excel</)
    assert.match(html, />Draft summary</)
  })

  test('recount tab: editable transcript, Read counts, rows with statuses, Differs shows the pack difference, not counted listed', () => {
    const html = view({
      tab: 'recount',
      actions,
      recount: recount({
        transcript: 'EGFR mutation kit, two boxes.',
        rows: [row({}), row({ id: 'r2', phrase: 'Proteinase K, five vials', itemCode: null, candidates: [], status: 'not_recognized', reason: 'no item in the Item List matches this phrase', voiceBase: null, fileBase: null, diffBase: null, diffPacks: null })],
        notCounted: [{ ...actions.recount[0], itemCode: 'RGT-KRAS', itemName: 'KRAS Mutation Kit' }]
      })
    })
    assert.match(html, /<textarea[^>]*>EGFR mutation kit, two boxes\.<\/textarea>/)
    assert.match(html, />Read counts</)
    assert.match(html, />Differs</)
    assert.match(html, /-1 box/)
    assert.match(html, />Not recognized</)
    assert.match(html, /Proteinase K, five vials/)
    assert.match(html, /Not counted by voice/)
    assert.match(html, /RGT-KRAS/)
    assert.match(html, /Muse Voice Transcribe/)
  })

  test('ReagentHome uses useRecorder and transkripsikanSuara and never sends the transcript anywhere but parseRecount', () => {
    const h = src('src/renderer/src/views/ReagentHome.tsx')
    assert.match(h, /useRecorder\(\)/)
    assert.match(h, /transkripsikanSuara\(/)
    assert.match(h, /parseRecount\(/)
    assert.match(h, /compareRecount\(/)
    assert.match(h, /reagentActions\(/)
    assert.match(h, /reagentExport\(/)
    assert.doesNotMatch(h, /onSubmit\([^)]*transcript/)
  })
})

describe('recorder is released when the month or folder changes', () => {
  test('month and folder changes discard an open recording and its timer', () => {
    const h = src('src/renderer/src/views/ReagentHome.tsx')
    const reset = h.slice(h.indexOf('const resetRecount'), h.indexOf('const resetRecount') + 400)
    assert.match(reset, /rec\.discard\(\)/)
    assert.match(reset, /clearTimeout\(clipTimer\.current\)/)
    assert.match(h.slice(h.indexOf('const chooseFolder')), /resetRecount\(\)/)
    assert.match(h.slice(h.indexOf('onMonth=')), /resetRecount\(\)/)
  })
})

describe('number check on the AI draft summary', () => {
  const actions = { month: '2026-10', reorder: [], excluded: [], investigation: [], recount: [] }
  test('matched numbers point at their fact, an invented one is marked, the text stays whole', () => {
    const text = 'Order 4 boxes of KRAS now and 12 boxes of LBC.'
    const check = checkNumbers(text, ['- Order now — KRAS Mutation Kit: order 4 box.'])
    const html = view({ tab: 'reorder', actions, summary: { text, check, loading: false } })
    assert.match(html, /class="num-ok"[^>]*title="From the data: - Order now — KRAS Mutation Kit: order 4 box\."[^>]*>4</)
    assert.match(html, /class="num-warn"[^>]*title="Not in the reagent data"[^>]*>⚠ ?12</)
    assert.match(html, /1 of 2 numbers match the reagent data/)
    assert.match(html, /boxes of LBC\./)
  })

  test('a summary with every number matched says so', () => {
    const text = 'Order 4 boxes.'
    const html = view({ tab: 'reorder', actions, summary: { text, check: checkNumbers(text, ['order 4 box']), loading: false } })
    assert.match(html, /All 1 number matches the reagent data/)
    assert.doesNotMatch(html, /num-warn/)
  })
})
