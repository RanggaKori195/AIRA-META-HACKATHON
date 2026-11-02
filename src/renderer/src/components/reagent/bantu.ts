import type { FindingType } from '../../../../shared/reagent'

// Display helpers for the Reagent Check screen (pure; relative import because tsx tests don't read aliases).

export const TYPE_LABEL: Record<FindingType, string> = {
  wrong_item_code: 'Wrong item code',
  factor_too_high: 'Factor too high',
  used_faster: 'Used faster than estimated',
  unit_mismatch: 'Unit mismatch',
  no_physical_count: 'No physical count'
}

/** CSS modifier per type (badge colour). */
export const TYPE_CLASS: Record<FindingType, string> = {
  wrong_item_code: 'rg-merah',
  factor_too_high: 'rg-oranye',
  used_faster: 'rg-ungu',
  unit_mismatch: 'rg-biru',
  no_physical_count: 'rg-abu'
}

export const fmtNum = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 3 })

export const fmtRatio = (n: number | null): string => (n === null ? '—' : `${n.toFixed(2)}×`)

export const fmtCell = (v: string | number | null): string =>
  v === null ? '' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : v
