// Reagent reconciliation rules (pure). Every number here is computed by code; the model only explains it.
//
// actual    = Opening + Received − Closing Count, converted to the item's base unit (duplicate count rows summed)
// estimated = test volume from the lab system (DB, linked test codes) × the factor used in the usage sheet
//             (each row's factor converted to the base unit, then volume-weighted over the item's weekly rows)
//
// An item that has data but cannot be evaluated is listed in `notChecked` with the reason — never counted as
// checked, because a silent skip reads as "all clear".
import { canonName, toBase } from './normalize'
import { FINDING_TYPES, type FindingType, type ItemRow, type OpnameRow, type Skipped, type SourceRef, type UsageRow } from './types'

/** Estimated ≥ 2 × actual → the per-test factor in the sheet looks too high. */
export const FACTOR_HIGH_RATIO = 2
/** Actual ≥ 1.5 × estimated → consumed faster than estimated (waste, repeats, unrecorded use). */
export const USED_FASTER_RATIO = 1.5
/** A sheet test volume differing from the lab system by more than this share is mentioned. */
const VOLUME_DIFF_SHARE = 0.05

export type { EvaluatedItem, Finding, NotChecked, RecountItem, Summary } from '../../shared/reagent'
import type { EvaluatedItem, Finding, NotChecked, RecountItem, Summary } from '../../shared/reagent'

export interface ReconcileInput {
  usage: UsageRow[]
  items: ItemRow[]
  opname: OpnameRow[]
  skipped: Skipped[]
  volumes: Record<string, number>
  files: string[]
  month: string
}

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

export interface ReconcileOutput {
  summary: Summary
  findings: Finding[]
  evaluated: EvaluatedItem[]
  recount: RecountItem[]
}

export function reconcile(input: ReconcileInput): ReconcileOutput {
  const findings: Finding[] = []
  const evaluated: EvaluatedItem[] = []
  const recount: RecountItem[] = []
  const notChecked: NotChecked[] = []
  const itemByCode = new Map(input.items.map((i) => [i.code, i]))
  const itemByName = new Map(input.items.map((i) => [canonName(i.name), i]))
  const notCheck = (itemCode: string, itemName: string, reason: string, evidence: SourceRef[]): void => {
    notChecked.push({ itemCode, itemName, reason, evidence })
  }

  // 1. Usage rows booked under a code that is not in the Item List.
  const unknown = new Map<string, UsageRow[]>()
  for (const u of input.usage) {
    if (itemByCode.has(u.code)) continue
    unknown.set(u.code, [...(unknown.get(u.code) ?? []), u])
  }
  for (const [code, rows] of unknown) {
    const match = itemByName.get(canonName(rows[0].name))
    const target = match?.code ?? code
    findings.push({
      // Unique per unknown code: two wrong codes for the same item are two findings with their own evidence.
      id: `wrong_item_code:${target}:${code}`,
      type: 'wrong_item_code',
      itemCode: target,
      itemName: match?.name ?? rows[0].name,
      estimated: null,
      actual: null,
      ratio: null,
      impliedFactor: null,
      unit: rows[0].unit || match?.baseUnit || '',
      explanation: match
        ? `Usage booked under code "${rows[0].rawCode}", which is not in the Item List; the item name matches ${match.code} (${match.name}) — probably booked under the wrong code (${rows.length} row${rows.length > 1 ? 's' : ''}).`
        : `Usage booked under code "${rows[0].rawCode}", which is not in the Item List and matches no item by name (${rows.length} row${rows.length > 1 ? 's' : ''}).`,
      evidence: rows.map((r) => r.ref)
    })
  }

  // 2. Per item: estimated vs actual.
  let itemsChecked = 0
  for (const item of input.items) {
    const rows = input.usage.filter((u) => u.code === item.code)
    const counts = input.opname.filter((o) => o.code === item.code)
    if (rows.length === 0 && counts.length === 0) continue
    const usageRefs = rows.map((r) => r.ref)
    const countRefs = counts.map((c) => c.ref)
    const unitOf = (r: UsageRow): string => r.unit.trim() || item.baseUnit

    // Recount source: every counted item, closing in base units (null + reason when a unit cannot convert).
    if (counts.length > 0) {
      const closings = counts.map((c) => toBase(c.closing, c.unit, item))
      const bad = counts.find((_c, i) => closings[i] === null)
      recount.push({
        itemCode: item.code,
        itemName: item.name,
        baseUnit: item.baseUnit,
        packSize: item.packSize,
        packUnit: item.packUnit,
        opnameUnit: counts[0].unit,
        closing: bad ? null : r3(closings.reduce((s: number, v) => s + (v as number), 0)),
        ...(bad ? { reason: `cannot convert "${bad.unit}" to ${item.baseUnit}` } : {}),
        refs: countRefs
      })
    }

    if (counts.length === 0) {
      itemsChecked++
      findings.push(base(item, 'no_physical_count', unitOf(rows[0]), usageRefs, 'Usage is recorded for this item, but it has no row in the stock opname, so actual consumption cannot be checked.'))
      continue
    }

    // Units: every count row and every usage factor must convert to the base unit.
    const badCounts = counts.filter((c) => toBase(c.opening + c.received - c.closing, c.unit, item) === null)
    const badUsage = rows.filter((r) => toBase(r.factor, unitOf(r), item) === null)
    if (badCounts.length || badUsage.length) {
      itemsChecked++
      const pack = `(pack: 1 ${item.packUnit} = ${fmt(item.packSize)} ${item.baseUnit})`
      const units = (xs: string[]): string => [...new Set(xs)].map((u) => `"${u}"`).join(', ')
      const parts: string[] = []
      if (badCounts.length) {
        parts.push(`The stock count is in ${units(badCounts.map((c) => c.unit))}, which cannot be converted to the base unit "${item.baseUnit}" ${pack}.`)
      }
      if (badUsage.length) {
        parts.push(
          `The usage sheet gives the factor per test in ${units(badUsage.map(unitOf))} (${badUsage.length} row${badUsage.length > 1 ? 's' : ''}), which cannot be converted to the base unit "${item.baseUnit}" ${pack}.`
        )
      }
      const unit = badCounts[0]?.unit ?? unitOf(badUsage[0])
      findings.push(base(item, 'unit_mismatch', unit, [...badUsage.map((r) => r.ref), ...(badCounts.length ? countRefs : [])], parts.join(' ')))
      continue
    }

    // Duplicate count rows are summed, each converted on its own.
    const actual = counts.reduce((s, c) => s + (toBase(c.opening + c.received - c.closing, c.unit, item) as number), 0)
    if (rows.length === 0) {
      notCheck(item.code, item.name, 'stock counted but no usage recorded', countRefs)
      continue
    }
    if (item.tests.length === 0) {
      notCheck(item.code, item.name, 'no linked test codes in the Item List (Test Code(s) is empty), so the number of tests run is unknown', [item.ref, ...usageRefs])
      continue
    }
    const missing = item.tests.filter((t) => !((input.volumes[t] ?? 0) > 0))
    const dbVolume = item.tests.reduce((s, t) => s + (input.volumes[t] ?? 0), 0)
    if (dbVolume <= 0) {
      notCheck(item.code, item.name, `linked test codes ${missing.join(', ')} have no test volume in the lab system for ${input.month}`, [item.ref, ...usageRefs])
      continue
    }

    // The factor is per test in the row's unit → convert each to the base unit, then weight by volume.
    const baseFactor = (r: UsageRow): number => toBase(r.factor, unitOf(r), item) as number
    const sheetVolume = rows.reduce((s, r) => s + r.volume, 0)
    const factor = sheetVolume > 0 ? rows.reduce((s, r) => s + r.volume * baseFactor(r), 0) / sheetVolume : baseFactor(rows[0])
    const estimated = dbVolume * factor
    if (estimated <= 0) {
      notCheck(item.code, item.name, `estimated usage is zero (factor per test ${fmt(r3(factor))} ${item.baseUnit})`, usageRefs)
      continue
    }
    if (actual < 0) {
      notCheck(item.code, item.name, `physical count is higher than opening stock plus received (actual −${fmt(r2(-actual))})`, countRefs)
      continue
    }
    if (actual === 0) {
      notCheck(item.code, item.name, `the stock count shows no consumption (opening + received − closing = 0) although ${fmt(dbVolume)} tests were run`, countRefs)
      continue
    }
    itemsChecked++
    evaluated.push({
      itemCode: item.code,
      itemName: item.name,
      baseUnit: item.baseUnit,
      packSize: item.packSize,
      packUnit: item.packUnit,
      consumption: r2(actual),
      closing: r2(counts.reduce((s, c) => s + (toBase(c.closing, c.unit, item) as number), 0)),
      estimated: r2(estimated),
      leadDays: item.leadDays ?? null,
      safetyDays: item.safetyDays ?? null,
      countRefs
    })

    const ratio = actual / estimated
    const notes =
      (Math.abs(sheetVolume - dbVolume) > VOLUME_DIFF_SHARE * dbVolume
        ? ` Note: the sheet's test volume (${fmt(sheetVolume)}) differs from the lab system (${fmt(dbVolume)}).`
        : '') +
      (missing.length ? ` Note: linked test codes ${missing.join(', ')} had no tests in the lab system for ${input.month}.` : '') +
      (counts.length > 1 ? ` The ${counts.length} stock-count rows of this item were added together.` : '')
    const evidence = [...usageRefs, ...countRefs]

    if (estimated >= FACTOR_HIGH_RATIO * actual) {
      const implied = actual / dbVolume
      findings.push({
        ...base(item, 'factor_too_high', item.baseUnit, evidence,
          `Estimated usage ${fmt(r2(estimated))} ${item.baseUnit} (${fmt(dbVolume)} tests × ${fmt(r3(factor))}) is ${fmt(r2(estimated / actual))}× the actual consumption ${fmt(r2(actual))} ${item.baseUnit} from the stock count: the per-test factor ${fmt(r3(factor))} looks too high; the count implies ${fmt(r3(implied))} per test.${notes}`),
        estimated: r2(estimated),
        actual: r2(actual),
        ratio: r2(ratio),
        impliedFactor: r3(implied)
      })
    } else if (ratio >= USED_FASTER_RATIO) {
      findings.push({
        ...base(item, 'used_faster', item.baseUnit, evidence,
          `Actual consumption ${fmt(r2(actual))} ${item.baseUnit} from the stock count is ${fmt(r2(ratio))}× the estimate ${fmt(r2(estimated))} ${item.baseUnit} (${fmt(dbVolume)} tests × ${fmt(r3(factor))}) — used faster than estimated (waste, repeat runs or unrecorded use).${notes}`),
        estimated: r2(estimated),
        actual: r2(actual),
        ratio: r2(ratio),
        impliedFactor: r3(actual / dbVolume)
      })
    }
  }

  // 3. Stock-count rows under a code that is not in the Item List: no base unit, no linked tests → not checked.
  const strayCounts = new Map<string, OpnameRow[]>()
  for (const o of input.opname) {
    if (itemByCode.has(o.code)) continue
    strayCounts.set(o.code, [...(strayCounts.get(o.code) ?? []), o])
  }
  for (const [code, rows] of strayCounts) {
    notCheck(code, rows[0].name || rows[0].rawCode, 'code not in the Item List', rows.map((r) => r.ref))
  }

  const byType = Object.fromEntries(FINDING_TYPES.map((t) => [t, findings.filter((f) => f.type === t).length])) as Record<FindingType, number>
  return {
    summary: {
      month: input.month,
      itemsChecked,
      byType,
      skipped: input.skipped,
      notChecked,
      filesRead: input.files,
      thresholds: { factorHigh: FACTOR_HIGH_RATIO, usedFaster: USED_FASTER_RATIO }
    },
    findings,
    evaluated,
    recount
  }
}

function base(item: ItemRow, type: FindingType, unit: string, evidence: SourceRef[], explanation: string): Finding {
  return {
    id: `${type}:${item.code}`,
    type,
    itemCode: item.code,
    itemName: item.name,
    estimated: null,
    actual: null,
    ratio: null,
    impliedFactor: null,
    unit,
    explanation,
    evidence
  }
}
