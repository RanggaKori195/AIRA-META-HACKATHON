// Item-code and unit normalisation for Reagent Check (pure).

/** One canonical form: upper case, trimmed, runs of space/underscore/dash → a single dash. */
export function canonCode(s: string): string {
  return s.trim().toUpperCase().replace(/[\s_-]+/g, '-')
}

/** Canonical name for matching a wrongly-coded usage row to the item it belongs to. */
export function canonName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Canonical unit for matching: trimmed, case-insensitive, no spaces, micro sign and Greek mu → "u". */
export function canonUnit(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '').replace(/[µμ]/g, 'u')
}

/** Metric pairs per canonical base unit: factor to multiply a quantity in the key unit by. */
const METRIC: Record<string, Record<string, number>> = {
  ml: { ul: 0.001, l: 1000, ml: 1 },
  l: { ul: 0.000001, ml: 0.001, l: 1 },
  g: { mg: 0.001, kg: 1000, g: 1 }
}

/**
 * Quantity in the item's base unit, or null when the unit cannot be converted (that is a finding, never a
 * silent zero). Accepts the base unit, the pack unit (× Pack Size) and metric pairs of the base unit; matching
 * ignores case, spaces and the µ/μ spelling.
 */
export function toBase(
  qty: number,
  unit: string,
  item: { baseUnit: string; packSize: number; packUnit: string }
): number | null {
  const u = canonUnit(unit)
  const b = canonUnit(item.baseUnit)
  if (u === b) return qty
  if (u === canonUnit(item.packUnit)) return qty * item.packSize
  const metric = METRIC[b]?.[u]
  return metric === undefined ? null : qty * metric
}
