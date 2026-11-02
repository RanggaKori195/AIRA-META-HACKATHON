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
}

const MOL = ['HPV101', 'HPV102', 'HPV103', 'MOL101', 'MOL102', 'MOL103']

const ITEMS: Item[] = [
  { code: 'RGT-HPV-HR', name: 'HPV DNA High Risk Kit', baseUnit: 'test', packSize: 96, packUnit: 'box', tests: ['HPV101'], factor: 1, opnameUnit: 'box' },
  { code: 'RGT-HPV-GT14', name: 'HPV Genotyping 14 Reagent Kit', baseUnit: 'test', packSize: 48, packUnit: 'box', tests: ['HPV102'], factor: 1, opnameUnit: 'test' },
  { code: 'RGT-HPV-GT28', name: 'HPV Genotyping 28 Reagent Kit', baseUnit: 'test', packSize: 48, packUnit: 'box', tests: ['HPV103'], factor: 1, opnameUnit: 'test' },
  { code: 'KIT-DNA-EXT', name: 'DNA Extraction Kit', baseUnit: 'test', packSize: 50, packUnit: 'box', tests: MOL, factor: 1, opnameUnit: 'test' },
  { code: 'TIP-FLT-200', name: 'Filter Tips 200 uL', baseUnit: 'pcs', packSize: 96, packUnit: 'rack', tests: MOL, factor: 4, opnameUnit: 'pcs' },
  { code: 'TUBE-PCR-02', name: 'PCR Tubes 0.2 mL', baseUnit: 'pcs', packSize: 1000, packUnit: 'bag', tests: MOL, factor: 2, opnameUnit: 'pcs' },
  { code: 'RGT-EGFR', name: 'EGFR Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', tests: ['MOL101'], factor: 1, opnameUnit: 'test' },
  { code: 'RGT-KRAS', name: 'KRAS Mutation Kit', baseUnit: 'test', packSize: 24, packUnit: 'box', tests: ['MOL102'], factor: 1, opnameUnit: 'test' },
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

const WEEKS = [
  { label: 'Week 1 (1–7 Oct)', w: 0.22 },
  { label: 'Week 2 (8–14 Oct)', w: 0.24 },
  { label: 'Week 3 (15–21 Oct)', w: 0.24 },
  { label: 'Week 4 (22–31 Oct)', w: 0.3 }
]

const r2 = (n: number): number => Math.round(n * 100) / 100

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
    ['Item Code', 'Item Name', 'Base Unit', 'Pack Size', 'Pack Unit', 'Test Code(s)', 'Standard Factor'],
    ...ITEMS.map((it) => [it.code, it.name, it.baseUnit, it.packSize, it.packUnit, it.tests.join(', '), it.factor])
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
    const opening = Math.ceil(used * 0.6) + 2
    const received = Math.ceil(used * 0.7)
    // Physical counts of tests and pieces are whole numbers; volumes and packs keep two decimals.
    const whole = it.opnameUnit === 'test' || it.opnameUnit === 'pcs'
    const closing = whole ? Math.round(opening + received - used) : r2(opening + received - used)
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
