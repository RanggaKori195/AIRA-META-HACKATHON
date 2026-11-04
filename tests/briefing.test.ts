import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { briefingFacts, codeBriefing, buildBriefing, NOTHING_TODAY } from '../src/main/briefing/briefing'
import { checkNumbers } from '../src/shared/number-check'
import type { ReagentActions } from '../src/shared/reagent'
import type { Briefing, StatusPemicu } from '../src/shared/ipc'
import { readFileSync } from 'fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BriefingCard, shouldAutoPlay, briefingKey, autoBriefing } from '../src/renderer/src/components/BriefingCard'

;(globalThis as { React?: unknown }).React = React
const src = (p: string): string => readFileSync(p, 'utf8')

const ref = { file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: 9 }
const line = (code: string, name: string, status: 'order_now' | 'order_soon' | 'ok', packs: number) => ({
  itemCode: code, itemName: name, baseUnit: 'test', packUnit: 'box', packSize: 24, closing: 6, dailyUse: 1.35,
  leadDays: 14, safetyDays: 7, leadDefault: true, safetyDefault: true, reorderPoint: 28.35, target: 68.85, orderBase: 62.85,
  orderPacks: packs, status, reachesReorderPointOn: null, sheetOrderPacks: null, evidence: [ref]
})
const inv = (id: string) => ({ id, kind: 'used_faster' as const, itemCode: id, itemName: id, headline: `${id} was used faster`, steps: [], evidence: [ref] })
const ACTIONS: ReagentActions = {
  month: '2026-10',
  reorder: [
    line('RGT-KRAS', 'KRAS Mutation Kit', 'order_now', 4),
    line('LBC-VIAL', 'LBC Vial', 'order_now', 2),
    line('KIT-DNA-EXT', 'DNA Extraction Kit', 'order_soon', 1),
    line('RGT-HPV', 'HPV Kit', 'ok', 0)
  ],
  excluded: [],
  investigation: [inv('A'), inv('B'), inv('C')],
  recount: []
}
const pemicu = (id: string, judul: string, hasil: StatusPemicu['hasil'], aktif = true): StatusPemicu =>
  ({ id, menu: 'sales', judul, aturan: '', aktif, diperiksa: 1, hasil, ringkas: `${judul} summary`, tidakDipantau: [] }) as StatusPemicu

describe('briefing facts are built by code', () => {
  test('orders, findings and only the monitor alerts that are on and ringing', () => {
    const facts = briefingFacts({
      reagent: ACTIONS,
      monitor: [pemicu('data_sales', 'Sales data stalled', 'berbunyi'), pemicu('data_lab', 'TAT data stalled', 'normal'), pemicu('sales_anjlok', 'Sales dropped', 'berbunyi', false)]
    })
    assert.deepEqual(facts, [
      '- Order now — KRAS Mutation Kit: 4 box.',
      '- Order now — LBC Vial: 2 box.',
      '- Order soon — DNA Extraction Kit: 1 box.',
      '- Reagent check 2026-10: 3 findings to investigate.',
      '- Monitor alert — Sales data stalled: Sales data stalled summary'
    ])
  })

  test('no reagent folder and a quiet monitor = no facts', () => {
    assert.deepEqual(briefingFacts({ reagent: null, monitor: [pemicu('data_sales', 'x', 'normal')] }), [])
  })
})

describe('code-written briefing', () => {
  const facts = briefingFacts({ reagent: ACTIONS, monitor: [pemicu('data_sales', 'Sales data stalled', 'berbunyi')] })

  test('at most 3 sentences, and every number in it is in the facts', () => {
    const text = codeBriefing({ reagent: ACTIONS, monitor: [pemicu('data_sales', 'Sales data stalled', 'berbunyi')] })
    assert.ok(text.split(/(?<=[.!?])\s+/).length <= 3, text)
    assert.match(text, /KRAS Mutation Kit \(4 box\)/)
    assert.match(text, /3 findings/)
    assert.match(text, /Sales data stalled/)
    assert.equal(checkNumbers(text, facts).unmatched, 0, text)
  })
})

describe('the briefing Muse writes is number-checked before it is spoken', () => {
  const input = { reagent: ACTIONS, monitor: [] as StatusPemicu[] }

  test('nothing to report: no model call, a fixed sentence', async () => {
    let called = false
    const b = await buildBriefing({ reagent: null, monitor: [] }, async () => ((called = true), 'x'))
    assert.equal(called, false)
    assert.equal(b.text, NOTHING_TODAY)
    assert.equal(b.source, 'code')
  })

  test('a Muse briefing whose numbers all match is used', async () => {
    let prompt = ''
    const b = await buildBriefing(input, async (p) => ((prompt = p), 'Good morning. Order 4 boxes of KRAS and 2 of LBC Vial today; 3 findings need a look.'))
    assert.equal(b.source, 'muse')
    assert.match(b.text, /Good morning/)
    assert.equal(b.check.unmatched, 0)
    assert.match(prompt, /at most 5 short sentences/)
    assert.match(prompt, /Do not state any number that is not listed/)
    assert.match(prompt, /Always answer in English/)
    for (const f of briefingFacts(input)) assert.ok(prompt.includes(f), f)
  })

  test('one invented number and the code-written briefing is spoken instead', async () => {
    const b = await buildBriefing(input, async () => 'Order 12 boxes of KRAS today.')
    assert.equal(b.source, 'code')
    assert.equal(b.text, codeBriefing(input))
    assert.equal(b.check.unmatched, 0)
    assert.match(b.note ?? '', /12/)
  })

  test('a failed or empty model call falls back to the code-written briefing', async () => {
    assert.equal((await buildBriefing(input, async () => '   ')).source, 'code')
    const b = await buildBriefing(input, async () => {
      throw new Error('network')
    })
    assert.equal(b.source, 'code')
    assert.equal(b.text, codeBriefing(input))
  })
})

describe('briefing IPC', () => {
  const ipc = src('src/main/ipc.ts')
  const i = ipc.indexOf('IPC_CHANNELS.briefingGet,')
  const h = i < 0 ? '' : ipc.slice(i, ipc.indexOf('ipcMain.handle(', i + 10))

  test('the channel exists in main, preload and the shared list', () => {
    assert.ok(h, 'briefingGet handler')
    assert.match(src('src/shared/ipc.ts'), /briefingGet: 'briefing:get'/)
    assert.match(src('src/preload/index.ts'), /briefingGet: \(\): Promise<Briefing>/)
  })

  test('login is required, reagent facts only with Reagent Check permission, monitor as the user may see it', () => {
    assert.match(h, /wajibLogin\(\)/)
    assert.match(h, /auth\.bolehModeSekarang\('reagent'\)/)
    assert.match(h, /pemantau\.keadaanPemantau\(\)\.pemicu/)
    assert.match(h, /buildBriefing\(/)
  })

  test('Muse Wonder words it with room for hidden reasoning', () => {
    const m = /completeDetail\([\s\S]*?MUSE\.agent,\s*(\d+)\)/.exec(h)
    assert.ok(m && Number(m[1]) >= 16000, m?.[1])
  })
})

describe('briefing card and once-a-day rule', () => {

  test('plays automatically once per user per day, never when muted', () => {
    assert.equal(shouldAutoPlay(null, '2026-11-03', false), true)
    assert.equal(shouldAutoPlay('2026-11-02', '2026-11-03', false), true)
    assert.equal(shouldAutoPlay('2026-11-03', '2026-11-03', false), false)
    assert.equal(shouldAutoPlay(null, '2026-11-03', true), false)
    assert.notEqual(briefingKey('ana'), briefingKey('budi'))
  })

  test('a Muse briefing shows its number check and the Brief me button', () => {
    const text = 'Order 4 boxes of KRAS today.'
    const b = { text, source: 'muse' as const, check: checkNumbers(text, ['- Order now — KRAS Mutation Kit: 4 box.']) }
    const html = renderToStaticMarkup(React.createElement(BriefingCard, { briefing: b, loading: false, error: null, onBriefMe: () => {} }))
    assert.match(html, /Morning briefing/)
    assert.match(html, /AI draft · numbers checked/)
    assert.match(html, /class="num-ok"/)
    assert.match(html, /All 1 number matches the data/)
    assert.match(html, />Brief me</)
  })

  test('a code-written briefing says why', () => {
    const b = { text: 'Order now: KRAS Mutation Kit (4 box).', source: 'code' as const, check: checkNumbers('x', []), note: 'Muse wrote a number that is not in the data (12) — the code-written briefing was used.' }
    const html = renderToStaticMarkup(React.createElement(BriefingCard, { briefing: b, loading: false, error: null, onBriefMe: () => {} }))
    assert.match(html, /Written by code from the data/)
    assert.match(html, /not in the data \(12\)/)
  })

  test('Home loads the briefing, plays it once a day and offers Brief me', () => {
    const home = src('src/renderer/src/views/Home.tsx')
    assert.match(home, /<BriefingCard /)
    assert.match(home, /window\.aira\.briefingGet\(\)/)
    assert.match(home, /shouldAutoPlay\(/)
    assert.match(home, /speakAnswer\(/)
  })

  test('the day marker is kept per signed-in user, never under an empty name', () => {
    const home = src('src/renderer/src/views/Home.tsx')
    assert.match(home, /if \(!username\) return/)
    assert.match(home, /briefingKey\(username\)/)
    assert.match(src('src/renderer/src/App.tsx'), /<Home[\s\S]{0,400}username=\{session/)
  })

  test('a second mount of Home (React dev) reuses the same briefing: one model call, spoken once', async () => {
    let calls = 0
    const start = async (): Promise<Briefing> => (calls++, { text: 'x', source: 'code', check: checkNumbers('x', []) })
    const a = autoBriefing('ana:2026-11-03', start)
    const b = autoBriefing('ana:2026-11-03', start)
    assert.equal(a, b)
    await a
    assert.equal(calls, 1)
    await autoBriefing('budi:2026-11-03', start)
    assert.equal(calls, 2)
  })
})
