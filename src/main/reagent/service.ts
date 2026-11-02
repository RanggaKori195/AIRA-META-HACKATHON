// Reagent Check service: finds the month's files in the chosen folder, runs parse → rules with DB volumes, and
// caches the result by file modification times so the screen and the chat tools see identical numbers and an
// edited file is never shown stale.
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { parseOpnameWorkbook, parseUsageWorkbook, rowCells } from './parse'
import { reconcile, type ReconcileOutput } from './rules'
import { testVolumes } from './volumes'
import { computeReorder } from './reorder'
import { buildInvestigation } from './investigation'
import type { SourceRef } from './types'
import type { ReagentActionsResult } from '../../shared/reagent'

const USAGE_RE = /^Reagent_Usage_(\d{4}-\d{2})\.xlsx$/i
const usageFile = (m: string): string => `Reagent_Usage_${m}.xlsx`
const opnameFile = (m: string): string => `Stock_Opname_${m}.xlsx`

export type ReconcileResult = ReconcileOutput

/** Months that have BOTH a usage file and a stock-opname file, newest first. */
export function availableMonths(folder: string): string[] {
  if (!existsSync(folder)) return []
  const names = new Set(readdirSync(folder).map((n) => n.toLowerCase()))
  return readdirSync(folder)
    .map((n) => USAGE_RE.exec(n)?.[1])
    .filter((m): m is string => !!m && names.has(opnameFile(m).toLowerCase()))
    .sort()
    .reverse()
}

/** Results per folder|month; each entry remembers the file mtimes it was computed from. */
const MAX_CACHED = 8
const cache = new Map<string, { stamp: string; result: ReconcileResult }>()

export function clearReagentCache(): void {
  cache.clear()
}

type Deps = { volumes?: (month: string) => Promise<Record<string, number>> }

export async function runReconciliation(o: {
  folder: string
  month?: string
  deps?: Deps
}): Promise<ReconcileResult | { error: string }> {
  if (!existsSync(o.folder)) return { error: `The folder "${o.folder}" does not exist. Choose the folder again on the Reagent Check screen.` }
  const months = availableMonths(o.folder)
  const month = o.month ?? months[0]
  if (!month || !months.includes(month)) {
    return {
      error: o.month
        ? `No usage and stock-opname files for ${o.month} in "${o.folder}". Available months: ${months.join(', ') || 'none'}.`
        : `No month in "${o.folder}" has both ${usageFile('YYYY-MM')} and ${opnameFile('YYYY-MM')}.`
    }
  }
  const pu = join(o.folder, usageFile(month))
  const po = join(o.folder, opnameFile(month))
  const key = `${o.folder}|${month}`
  const stamp = `${statSync(pu).mtimeMs}|${statSync(po).mtimeMs}`
  const hit = cache.get(key)
  if (hit?.stamp === stamp) return hit.result

  const [u, op, volumes] = [
    await parseUsageWorkbook(pu),
    await parseOpnameWorkbook(po),
    await (o.deps?.volumes ?? testVolumes)(month)
  ]
  const result = reconcile({
    usage: u.usage,
    items: u.items,
    opname: op.opname,
    skipped: [...u.skipped, ...op.skipped],
    volumes,
    files: [usageFile(month), opnameFile(month)],
    month
  })
  cache.delete(key)
  cache.set(key, { stamp, result })
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string)
  return result
}

/**
 * Reorder list, investigation checklist and the recount source for one month — from the same reconciliation run
 * the screen and the chat tools use (cache + mtime rules hold), so every number agrees with the findings.
 */
export async function actions(o: { folder: string; month?: string; deps?: Deps }): Promise<ReagentActionsResult> {
  const r = await runReconciliation(o)
  if ('error' in r) return r
  const { lines, excluded } = computeReorder({
    month: r.summary.month,
    evaluated: r.evaluated,
    findings: r.findings,
    notChecked: r.summary.notChecked
  })
  return { month: r.summary.month, reorder: lines, excluded, investigation: buildInvestigation(r.findings), recount: r.recount }
}

/**
 * The source rows of one finding, read from the folder and month asked for. Re-runs the reconciliation (a
 * cache hit while the files are unchanged — the mtimes are checked again), so the evidence never comes from
 * another folder, another month or a stale file.
 */
export async function evidenceRows(o: {
  folder: string
  month?: string
  findingId: string
  deps?: Deps
}): Promise<Array<{ ref: SourceRef; cells: Record<string, string | number | null> }>> {
  const r = await runReconciliation({ folder: o.folder, month: o.month, deps: o.deps })
  if ('error' in r) throw new Error(r.error)
  const finding = r.findings.find((f) => f.id === o.findingId)
  if (!finding) {
    throw new Error(`Unknown finding "${o.findingId}" for ${r.summary.month}. Run the reconciliation first and use a finding id from its result.`)
  }
  const out: Array<{ ref: SourceRef; cells: Record<string, string | number | null> }> = []
  for (const ref of finding.evidence) out.push({ ref, cells: await rowCells(join(o.folder, ref.file), ref.sheet, ref.row) })
  return out
}
