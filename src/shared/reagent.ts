// Reagent Check types shared by main (engine, tools, IPC) and renderer (screen).

export type FindingType =
  | 'wrong_item_code'
  | 'factor_too_high'
  | 'used_faster'
  | 'unit_mismatch'
  | 'no_physical_count'

export const FINDING_TYPES: readonly FindingType[] = [
  'wrong_item_code',
  'factor_too_high',
  'used_faster',
  'unit_mismatch',
  'no_physical_count'
]

/** Where a value came from — shown to the user as evidence (1-based Excel row). */
export interface SourceRef {
  file: string
  sheet: string
  row: number
}

export interface Skipped {
  ref: SourceRef
  reason: string
}

/** An item that has data this month but could not be evaluated — always shown with the reason, never silent. */
export interface NotChecked {
  itemCode: string
  itemName: string
  reason: string
  evidence: SourceRef[]
}

export interface Finding {
  id: string
  type: FindingType
  itemCode: string
  itemName: string
  estimated: number | null
  actual: number | null
  ratio: number | null
  impliedFactor: number | null
  unit: string
  explanation: string
  evidence: SourceRef[]
}

export interface Summary {
  month: string
  /** Items fully evaluated (estimate vs actual compared) or that ended in a finding. */
  itemsChecked: number
  byType: Record<FindingType, number>
  skipped: Skipped[]
  /** Items with data that could not be evaluated, with the reason (not counted in itemsChecked). */
  notChecked: NotChecked[]
  filesRead: string[]
  thresholds: { factorHigh: number; usedFaster: number }
}

/** An item that reached the estimate-vs-actual comparison (with or without a finding) — the reorder input. */
export interface EvaluatedItem {
  itemCode: string
  itemName: string
  baseUnit: string
  packSize: number
  packUnit: string
  /** Opening + received − closing, base units. */
  consumption: number
  /** Physical closing count, base units. */
  closing: number
  /** Tests run × the sheet factor, base units. */
  estimated: number
  leadDays: number | null
  safetyDays: number | null
  countRefs: SourceRef[]
}

/** One Item List item that has stock-opname rows — what a voice recount is compared with. */
export interface RecountItem {
  itemCode: string
  itemName: string
  baseUnit: string
  packSize: number
  packUnit: string
  /** The unit written in the stock opname (first row). */
  opnameUnit: string
  /** Closing count in base units; null when a row's unit cannot be converted (see reason). */
  closing: number | null
  reason?: string
  refs: SourceRef[]
}

export type ReorderStatus = 'order_now' | 'order_soon' | 'ok' | 'no_use'

/** One reorder line — every number computed by code (src/main/reagent/reorder.ts). */
export interface ReorderLine {
  itemCode: string
  itemName: string
  baseUnit: string
  packUnit: string
  packSize: number
  /** Physical closing count, base units. */
  closing: number
  dailyUse: number
  leadDays: number
  safetyDays: number
  /** The Item List left it blank, so the default was used. */
  leadDefault: boolean
  safetyDefault: boolean
  reorderPoint: number
  target: number
  orderBase: number
  orderPacks: number
  status: ReorderStatus
  /** For `ok`: the day stock is expected to reach the reorder point. */
  reachesReorderPointOn: string | null
  /** For items with a factor_too_high finding: the order the sheet's factor would have produced. */
  sheetOrderPacks: number | null
  evidence: SourceRef[]
}

/** An item left out of the reorder list, with the reason (never shown as zero). */
export interface ReorderExcluded {
  itemCode: string
  itemName: string
  reason: string
}

export type InvestigationKind = FindingType | 'recount_differs'

/** One item of the investigation checklist; the steps are fixed per kind by code, roles are suggestions. */
export interface InvestigationItem {
  id: string
  kind: InvestigationKind
  itemCode: string
  itemName: string
  headline: string
  steps: { text: string; role: string }[]
  evidence: SourceRef[]
}

/** A voice-recount difference handed to the investigation list (mapped from a `differs` recount row). */
export interface RecountDiffer {
  itemCode: string
  itemName: string
  diffBase: number
  diffPacks: number | null
  /** Base unit, for the headline. */
  unit?: string
  refs: SourceRef[]
}

export type RecountStatus = 'matches' | 'differs' | 'unclear' | 'said_twice' | 'not_recognized' | 'not_comparable'

/** One phrase of a voice recount (src/shared/recount.ts). */
export interface RecountRow {
  id: string
  /** The phrase as transcribed. */
  phrase: string
  /** The matched item; null when nothing matched or the match is ambiguous (see candidates). */
  itemCode: string | null
  candidates: string[]
  count: number | null
  /** The word heard after the count (null = none said). */
  heardUnit: string | null
  /** The item's pack or base unit the count is in; null when it cannot be mapped. */
  unit: string | null
  /** No unit was said, so the pack unit is assumed. */
  unitAssumed: boolean
  voiceBase: number | null
  fileBase: number | null
  diffBase: number | null
  diffPacks: number | null
  status: RecountStatus
  reason?: string
  refs: SourceRef[]
}

/** Screen and export labels (one definition for both). */
export const REORDER_STATUS_LABEL: Record<ReorderStatus, string> = {
  order_now: 'Order now',
  order_soon: 'Order soon',
  ok: 'OK',
  no_use: 'No use'
}
export const RECOUNT_STATUS_LABEL: Record<RecountStatus, string> = {
  matches: 'Matches',
  differs: 'Differs',
  unclear: 'Unclear',
  said_twice: 'Said twice — check',
  not_recognized: 'Not recognized',
  not_comparable: 'Not comparable'
}

/** What the lab should order and investigate for one month, plus what a voice recount is compared with. */
export interface ReagentActions {
  month: string
  reorder: ReorderLine[]
  excluded: ReorderExcluded[]
  investigation: InvestigationItem[]
  recount: RecountItem[]
}
export type ReagentActionsResult = ReagentActions | { error: string }
export type ReagentSummaryResult = { text: string } | { error: string }
export type ReagentExportResult = { path: string } | { cancelled: true } | { error: string }

export interface ReagentStatus {
  folder: string | null
  months: string[]
}

export type ReagentRunResult =
  | { summary: Summary; findings: Finding[]; evaluated: EvaluatedItem[]; recount: RecountItem[] }
  | { error: string }

export interface EvidenceRow {
  ref: SourceRef
  cells: Record<string, string | number | null>
}

export type ReagentEvidenceResult = { rows: EvidenceRow[] } | { error: string }
