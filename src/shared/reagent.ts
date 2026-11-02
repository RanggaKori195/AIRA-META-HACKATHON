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

export interface ReagentStatus {
  folder: string | null
  months: string[]
}

export type ReagentRunResult = { summary: Summary; findings: Finding[] } | { error: string }

export interface EvidenceRow {
  ref: SourceRef
  cells: Record<string, string | number | null>
}

export type ReagentEvidenceResult = { rows: EvidenceRow[] } | { error: string }
