import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReagentView, { type ReagentViewProps } from '../src/renderer/src/components/reagent/ReagentView'
import { TYPE_LABEL, fmtRatio } from '../src/renderer/src/components/reagent/bantu'
import { FINDING_TYPES, type Finding, type Summary } from '../src/shared/reagent'

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
