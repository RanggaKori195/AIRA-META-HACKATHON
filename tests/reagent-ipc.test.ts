import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { IPC_CHANNELS } from '../src/shared/ipc'
import { ReagentMonth, ReagentFindingId, ReagentEvidenceInput } from '../src/main/reagent/ipc-schema'

const src = (p: string): string => readFileSync(p, 'utf8')
const handler = (s: string, ch: string): string => {
  const i = s.indexOf(`IPC_CHANNELS.${ch},`)
  return i < 0 ? '' : s.slice(i, s.indexOf('ipcMain.handle(', i + 10))
}

describe('Reagent Check IPC', () => {
  test('channels exist', () => {
    for (const ch of ['reagentStatus', 'reagentChooseFolder', 'reagentRun', 'reagentEvidence'] as const) {
      assert.ok(IPC_CHANNELS[ch], ch)
    }
  })

  test('every handler checks the Reagent Check permission', () => {
    const s = src('src/main/ipc.ts')
    for (const ch of ['reagentStatus', 'reagentChooseFolder', 'reagentRun', 'reagentEvidence']) {
      assert.match(handler(s, ch), /bolehModeSekarang\('reagent'\)/, ch)
    }
  })

  test('the folder is chosen by a main-process dialog — the renderer never sends a path', () => {
    const h = handler(src('src/main/ipc.ts'), 'reagentChooseFolder')
    assert.match(h, /async \(\)/)
    assert.match(h, /showOpenDialog/)
    assert.match(src('src/preload/index.ts'), /reagentChooseFolder: \(\)/)
  })

  test('inputs are validated', () => {
    assert.equal(ReagentMonth.safeParse('2026-10').success, true)
    assert.equal(ReagentMonth.safeParse(undefined).success, true)
    assert.equal(ReagentMonth.safeParse('2026-13x').success, false)
    assert.equal(ReagentFindingId.safeParse('factor_too_high:KIT-DNA-EXT').success, true)
    assert.equal(ReagentFindingId.safeParse('x'.repeat(200)).success, false)
  })

  test('evidence takes { findingId, month } validated by Zod; the folder comes from the session', () => {
    assert.equal(ReagentEvidenceInput.safeParse({ findingId: 'unit_mismatch:ETH-ABS', month: '2026-10' }).success, true)
    assert.equal(ReagentEvidenceInput.safeParse({ findingId: 'unit_mismatch:ETH-ABS' }).success, true)
    assert.equal(ReagentEvidenceInput.safeParse({ findingId: '', month: '2026-10' }).success, false)
    assert.equal(ReagentEvidenceInput.safeParse({ findingId: 'a:b', month: 'Oct' }).success, false)
    assert.equal(ReagentEvidenceInput.safeParse('unit_mismatch:ETH-ABS').success, false)
    const h = handler(src('src/main/ipc.ts'), 'reagentEvidence')
    assert.match(h, /ReagentEvidenceInput\.(safeParse|parse)\(raw\)/)
    assert.match(h, /reagentFolderFor\(sesi\.username\)/)
    assert.match(src('src/preload/index.ts'), /reagentEvidence: \(input: \{ findingId: string; month\?: string \}\)/)
  })
})

describe('Reagent actions IPC', () => {
  test('new channels exist and check the Reagent Check permission', () => {
    const s = src('src/main/ipc.ts')
    for (const ch of ['reagentActions', 'reagentSummary', 'reagentExport'] as const) {
      assert.ok(IPC_CHANNELS[ch], ch)
      assert.match(handler(s, ch), /bolehModeSekarang\('reagent'\)/, ch)
      assert.match(handler(s, ch), /reagentFolderFor\(sesi\.username\)/, ch)
    }
  })

  test('export saves through a main-process dialog — the renderer never sends a path', () => {
    const h = handler(src('src/main/ipc.ts'), 'reagentExport')
    assert.match(h, /showSaveDialog/)
    assert.match(h, /ReagentExportInput\.safeParse\(raw\)/)
    assert.match(src('src/preload/index.ts'), /reagentExport: \(input: \{ month\?: string; recount: RecountRow\[\] \}\)/)
  })

  test('schemas drop unknown fields and refuse bad months / oversize recount', async () => {
    const { ReagentExportInput } = await import('../src/main/reagent/ipc-schema')
    const row = {
      id: 'r1', phrase: 'EGFR mutation kit, two boxes', itemCode: 'RGT-EGFR', candidates: ['RGT-EGFR'], count: 2,
      heardUnit: 'box', unit: 'box', unitAssumed: false, voiceBase: 48, fileBase: 72, diffBase: -24, diffPacks: -1,
      status: 'differs', refs: [{ file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 8 }]
    }
    const ok = ReagentExportInput.safeParse({ month: '2026-10', recount: [{ ...row, path: 'C:/x' }], path: 'C:/evil.xlsx' })
    assert.equal(ok.success, true)
    if (ok.success) {
      assert.equal('path' in ok.data, false)
      assert.equal('path' in ok.data.recount[0], false)
    }
    assert.equal(ReagentExportInput.safeParse({ month: '2026-13', recount: [] }).success, false)
    assert.equal(ReagentExportInput.safeParse({ month: '2026-10', recount: Array(501).fill(row) }).success, false)
    assert.equal(ReagentExportInput.safeParse({ month: '2026-10', recount: [{ ...row, status: 'hacked' }] }).success, false)
  })
})

describe('AI draft summary budget', () => {
  test('the summary leaves room for Muse hidden reasoning (2000 tokens was cut off in the app)', () => {
    const h = handler(src('src/main/ipc.ts'), 'reagentSummary')
    const m = /completeDetail\([\s\S]*?MUSE\.agent,\s*(\d+)\)/.exec(h)
    assert.ok(m, 'completeDetail call with an explicit budget')
    assert.ok(Number(m![1]) >= 8000, `budget ${m![1]}`)
  })
})

describe('AI draft summary number check', () => {
  test('the summary is checked in code against the same facts the model was given', () => {
    const h = handler(src('src/main/ipc.ts'), 'reagentSummary')
    assert.match(h, /checkNumbers\(\s*text,\s*summaryFacts\(a\)\s*\)/)
    assert.match(h, /return \{ text, check \}/)
  })
})
