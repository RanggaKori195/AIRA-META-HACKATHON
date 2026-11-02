// Synthetic reagent workbooks for the Reagent Check demo (pure, deterministic).
//
// Shaped like the lab's real files: a weekly usage sheet (test volume × per-test factor = estimated usage), an
// item list, and a month-end stock opname (opening, received, physical closing count). Four anomalies are planted
// on purpose — the ones found in the real molecular/HPV files — and every other item is ordinary (actual within
// 0.95–1.2 of the estimate) so the findings table is not full of false alarms.
import type { FindingType } from '../../src/main/reagent/types'
import { makeRng } from './prng'

export interface SheetSpec {
  name: string
  rows: (string | number | null)[][]
}

interface Item {
  code: string
  name: string
  baseUnit: string
  packSize: number
  packUnit: string
  tests: string[]
  factor: number
  /** Unit written in the stock opname (base unit, pack unit, a metric pair, or a planted odd one). */
  opnameUnit: string
  /** Item List "Lead Time (days)" / "Safety Stock (days)"; left blank on purpose for some items (defaults). */
  lead?: number
  safety?: number
}

const MOL = ['HPV101', 'HPV102', 'HPV103', 'MOL101', 'MOL102', 'MOL103']

const ITEMS: Item[] = [
  { code: 'RGT-HPV-HR', name: 'HPV DNA High Risk Kit', baseUnit: 'test', packSize: 96, packUnit: 'box', tests: ['HPV101'], factor: 1, opnameUnit: 'box', lead: 21, safety: 7 },
  { code: 'RGT-HPV-GT14', name: 'HPV Genotyping 14 Reagent Kit', baseUnit: 'test', packSize: 48, packUnit: 'box', tests: ['HPV102'], factor: 1, opnameUnit: 'test' },
  { code: 'RGT-HPV-GT28', name: 'HPV Genotyping 28 Reagent Kit', baseUnit: 'test', packSize: 48, packUnit: 'box', tests: ['HPV103'], factor: 1, opnameUnit: 'test' },
  { code: 'KIT-DNA-EXT', name: 'DNA Extraction Kit', baseUnit: 'test', packSize: 50, packUnit: 'box', tests: MOL, factor: 1, opnameUnit: 'test', lead: 21, safety: 10 },
  { code: 'TIP-FLT-200', name: 'Filter Tips 200 uL', baseUnit: 'pcs', packSize: 96, packUnit: 'rack', tests: MOL, factor: 4, opnameUnit: 'pcs', lead: 10, safety: 5 },
  { code: 'TUBE-PCR-02', name: 'PCR Tubes 0.2 mL', baseUnit: 'pcs', packSize: 1000, packUnit: 'bag', tests: MOL, factor: 2, opnameUnit: 'pcs' },
  { code: 'RGT-EGFR', name: 'EGFR Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', tests: ['MOL101'], factor: 1, opnameUnit: 'test', lead: 28, safety: 7 },
  { code: 'RGT-KRAS', name: 'KRAS Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', tests: ['MOL102'], factor: 1, opnameUnit: 'test', lead: 28, safety: 7 },
  { code: 'RGT-NRAS', name: 'NRAS Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', tests: ['MOL103'], factor: 1, opnameUnit: 'test' },
  { code: 'ETH-ABS', name: 'Ethanol Absolute', baseUnit: 'mL', packSize: 1000, packUnit: 'bottle', tests: MOL, factor: 0.5, opnameUnit: 'kit' },
  { code: 'PCR-MM', name: 'PCR Master Mix', baseUnit: 'mL', packSize: 1.25, packUnit: 'tube', tests: ['MOL101', 'MOL102', 'MOL103'], factor: 0.025, opnameUnit: 'µL' },
  { code: 'LBC-VIAL', name: 'ThinPrep PreservCyt Vial', baseUnit: 'pcs', packSize: 100, packUnit: 'box', tests: ['LBC101'], factor: 1, opnameUnit: 'pcs' }
]

export const PLANTED: Array<{ type: Exclude<FindingType, 'no_physical_count'>; itemCode: string; usageCode?: string }> = [
  { type: 'wrong_item_code', itemCode: 'RGT-HPV-GT14', usageCode: 'RGT-HPV-G14' },
  { type: 'factor_too_high', itemCode: 'KIT-DNA-EXT' },
  { type: 'used_faster', itemCode: 'TIP-FLT-200' },
  { type: 'unit_mismatch', itemCode: 'ETH-ABS' }
]

/** Items whose closing count covers only a few days of use → "Order now" in the reorder list. */
export const LOW_STOCK = ['RGT-KRAS', 'LBC-VIAL']
const LOW_DAYS = 5
/** Ordinary items close with about two months of stock (OK or Order soon, depending on lead time). */
const HEALTHY_DAYS = 60
/** The voice-count script says this item one pack below its Closing Count. */
export const RECOUNT_PLANTED = { itemCode: 'RGT-EGFR', packsBelow: 1 }
/** A phrase in the voice-count script naming an item that is not in the Item List. */
export const RECOUNT_UNKNOWN = 'Proteinase K'

const WEEKS = [
  { label: 'Week 1 (1–7 Oct)', w: 0.22 },
  { label: 'Week 2 (8–14 Oct)', w: 0.24 },
  { label: 'Week 3 (15–21 Oct)', w: 0.24 },
  { label: 'Week 4 (22–31 Oct)', w: 0.3 }
]

const r2 = (n: number): number => Math.round(n * 100) / 100
const daysIn = (month: string): number => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
/** 0–999 in English words ("two hundred and thirteen"). */
function words(n: number): string {
  if (n < 20) return SMALL[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + SMALL[n % 10] : '')
  return `${SMALL[Math.floor(n / 100)]} hundred` + (n % 100 ? ` and ${words(n % 100)}` : '')
}
const UNIT_WORD: Record<string, [string, string]> = { test: ['test', 'tests'], pcs: ['piece', 'pieces'], box: ['box', 'boxes'] }

/**
 * The demo voice-count script: one line per counted item ("EGFR mutation kit, forty-eight tests."), every other
 * count in words, the planted item one pack below its Closing Count, plus one item that is not in the Item List.
 * Items counted in a unit nobody would say aloud (the planted "kit" unit, µL) are left out.
 */
export function buildVoiceScript(opname: SheetSpec[]): string {
  const rows = opname.find((s) => s.name === 'Stock Opname')!.rows.slice(1)
  const lines: string[] = []
  for (const [code, name, , , closing, unit] of rows) {
    const it = ITEMS.find((i) => i.code === code)
    const word = UNIT_WORD[String(unit)]
    if (!it || !word || typeof closing !== 'number') continue
    const pack = String(unit) === it.packUnit ? 1 : it.packSize
    const count = code === RECOUNT_PLANTED.itemCode ? closing - RECOUNT_PLANTED.packsBelow * pack : closing
    const spoken = String(name).replace(/\buL\b/, 'microliter').replace(/\bmL\b/, 'milliliter')
    const n = lines.length % 2 === 1 && Number.isInteger(count) && count <= 999 ? words(count) : String(count)
    lines.push(`${spoken}, ${n} ${count === 1 ? word[0] : word[1]}.`)
  }
  lines.push(`${RECOUNT_UNKNOWN}, five vials.`)
  return lines.join('\n')
}

/** Splits a monthly volume over the weeks with fixed weights; the last week takes the remainder. */
function weekly(total: number): number[] {
  const out = WEEKS.slice(0, -1).map((w) => Math.round(total * w.w))
  out.push(total - out.reduce((a, b) => a + b, 0))
  return out
}

export function buildReagentWorkbooks(
  volumes: Record<string, number>,
  month: string
): { usage: SheetSpec[]; opname: SheetSpec[] } {
  const rng = makeRng(20261031)
  const linked = (it: Item): number => it.tests.reduce((s, t) => s + (volumes[t] ?? 0), 0)
  const factorHigh = PLANTED.find((p) => p.type === 'factor_too_high')!.itemCode
  const usedFaster = PLANTED.find((p) => p.type === 'used_faster')!.itemCode
  const wrong = PLANTED.find((p) => p.type === 'wrong_item_code')!

  // Weekly usage: a title row, then one block per week separated by a blank row.
  const header = ['Week', 'Item Code', 'Item Name', 'Test Code', 'Test Volume', 'Factor per Test', 'Estimated Usage', 'Unit']
  const usageRows: (string | number | null)[][] = [[`Reagent usage — molecular & cytology lab — ${month}`], header]
  WEEKS.forEach((wk, wi) => {
    if (wi > 0) usageRows.push([null, null, null, null, null, null, null, null])
    for (const it of ITEMS) {
      const vol = weekly(linked(it))[wi]
      const factor = it.code === factorHigh ? it.factor * 3 : it.factor
      const code = it.code === wrong.itemCode && wi === 1 ? wrong.usageCode! : it.code
      usageRows.push([wk.label, code, it.name, it.tests.join(', '), vol, factor, r2(vol * factor), it.baseUnit])
    }
  })

  const itemRows: (string | number | null)[][] = [
    ['Item Code', 'Item Name', 'Base Unit', 'Pack Size', 'Pack Unit', 'Test Code(s)', 'Standard Factor', 'Lead Time (days)', 'Safety Stock (days)'],
    ...ITEMS.map((it) => [it.code, it.name, it.baseUnit, it.packSize, it.packUnit, it.tests.join(', '), it.factor, it.lead ?? null, it.safety ?? null])
  ]

  // Stock opname: true consumption follows the standard factor (× noise), the planted item 1.8×.
  const opnameRows: (string | number | null)[][] = [
    ['Item Code', 'Item Name', 'Opening Stock', 'Received', 'Closing Count', 'Unit']
  ]
  for (const it of ITEMS) {
    const noise = 0.95 + rng.next() * 0.25
    const mult = it.code === usedFaster ? 1.8 : noise
    const actualBase = linked(it) * it.factor * mult
    if (it.opnameUnit === 'kit') {
      opnameRows.push([it.code, it.name, 12, 6, 9, 'kit'])
      continue
    }
    const perUnit = it.opnameUnit === it.packUnit ? it.packSize : it.opnameUnit === 'µL' ? 0.001 : 1
    const used = actualBase / perUnit
    const received = Math.ceil(used * 0.7)
    // The closing count is set by how many days of use are left; the opening stock absorbs it, so consumption
    // (opening + received − closing) — and therefore every finding — stays the same.
    const days = LOW_STOCK.includes(it.code) ? LOW_DAYS : HEALTHY_DAYS
    // Physical counts of tests, pieces and packs are whole numbers; volumes keep two decimals.
    const whole = it.opnameUnit === 'test' || it.opnameUnit === 'pcs'
    const wholeClosing = whole || it.opnameUnit === it.packUnit
    const rawClosing = (used / daysIn(month)) * days
    const closing = wholeClosing ? Math.max(1, Math.round(rawClosing)) : r2(rawClosing)
    const opening = whole ? Math.round(closing + used - received) : r2(closing + used - received)
    opnameRows.push([it.code, it.name, opening, received, closing, it.opnameUnit])
  }

  return {
    usage: [
      { name: 'Weekly Usage', rows: usageRows },
      { name: 'Item List', rows: itemRows }
    ],
    opname: [{ name: 'Stock Opname', rows: opnameRows }]
  }
}
