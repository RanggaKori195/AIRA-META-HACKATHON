// Reorder list (pure). Every quantity is computed here from the month's physical count; the model never sizes an
// order. Items whose consumption cannot be trusted are listed in `excluded` with the reason — never as zero.
//
// dailyUse     = consumption ÷ days in the month
// reorderPoint = dailyUse × (lead + safety)
// target       = dailyUse × (lead + safety + cycle)
// order        = target − closing, rounded UP to whole packs
import type { EvaluatedItem, Finding, NotChecked, ReorderExcluded, ReorderLine, ReorderStatus } from '../../shared/reagent'

export const DEFAULT_LEAD_DAYS = 14
export const DEFAULT_SAFETY_DAYS = 7
/** The stock-opname cycle: the next physical count is a month away. */
export const CYCLE_DAYS = 30

const r2 = (n: number): number => Math.round(n * 100) / 100
const RANK: Record<ReorderStatus, number> = { order_now: 0, order_soon: 1, ok: 2, no_use: 3 }
const EXCLUDING: Partial<Record<Finding['type'], string>> = {
  unit_mismatch: 'unit mismatch — consumption cannot be computed',
  no_physical_count: 'no physical count — consumption cannot be computed'
}

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Day number `day` counted from the start of `month` (day 1 = the 1st; may run past the month's end). */
function dayOf(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10)
}

/** Packs to order so stock reaches the target, for a given daily use (0 when stock already covers it). */
function packsFor(dailyUse: number, days: number, closing: number, packSize: number): number {
  const base = Math.max(0, dailyUse * days - closing)
  return base > 0 ? Math.ceil(base / packSize - 1e-9) : 0
}

export function computeReorder(o: {
  month: string
  evaluated: EvaluatedItem[]
  findings: Finding[]
  notChecked: NotChecked[]
}): { lines: ReorderLine[]; excluded: ReorderExcluded[] } {
  const days = daysIn(o.month)
  const factorHigh = new Set(o.findings.filter((f) => f.type === 'factor_too_high').map((f) => f.itemCode))
  const lines: ReorderLine[] = o.evaluated.map((e) => {
    const leadDays = e.leadDays ?? DEFAULT_LEAD_DAYS
    const safetyDays = e.safetyDays ?? DEFAULT_SAFETY_DAYS
    const dailyUse = e.consumption / days
    const reorderPoint = dailyUse * (leadDays + safetyDays)
    const span = leadDays + safetyDays + CYCLE_DAYS
    const target = dailyUse * span
    const orderBase = Math.max(0, target - e.closing)
    let status: ReorderStatus
    let reachesReorderPointOn: string | null = null
    if (dailyUse <= 0) status = 'no_use'
    else if (e.closing <= reorderPoint) status = 'order_now'
    else if (e.closing - dailyUse * CYCLE_DAYS <= reorderPoint) status = 'order_soon'
    else {
      status = 'ok'
      reachesReorderPointOn = dayOf(o.month, days + Math.floor((e.closing - reorderPoint) / dailyUse))
    }
    return {
      itemCode: e.itemCode,
      itemName: e.itemName,
      baseUnit: e.baseUnit,
      packUnit: e.packUnit,
      packSize: e.packSize,
      closing: e.closing,
      dailyUse: r2(dailyUse),
      leadDays,
      safetyDays,
      leadDefault: e.leadDays === null,
      safetyDefault: e.safetyDays === null,
      reorderPoint: r2(reorderPoint),
      target: r2(target),
      orderBase: status === 'no_use' ? 0 : r2(orderBase),
      orderPacks: status === 'no_use' ? 0 : packsFor(dailyUse, span, e.closing, e.packSize),
      status,
      reachesReorderPointOn,
      sheetOrderPacks: factorHigh.has(e.itemCode) ? packsFor(e.estimated / days, span, e.closing, e.packSize) : null,
      evidence: e.countRefs
    }
  })
  lines.sort((a, b) => RANK[a.status] - RANK[b.status] || a.itemCode.localeCompare(b.itemCode))

  const excluded: ReorderExcluded[] = []
  for (const f of o.findings) {
    const reason = EXCLUDING[f.type]
    if (reason) excluded.push({ itemCode: f.itemCode, itemName: f.itemName, reason })
  }
  for (const n of o.notChecked) excluded.push({ itemCode: n.itemCode, itemName: n.itemName, reason: n.reason })
  return { lines, excluded }
}
