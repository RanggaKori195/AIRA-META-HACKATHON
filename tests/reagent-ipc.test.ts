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
