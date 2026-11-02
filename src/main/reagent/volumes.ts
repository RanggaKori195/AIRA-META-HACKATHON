// Test volumes per test code for one month, from the lab system (SalesRepository). Aggregate only (rule 3):
// no patient column is read. Rows whose transfer was cancelled are not counted (RECOGNIZED_CLAUSE, rule 5).
import { RECOGNIZED_CLAUSE } from '../sales/recognition'

/** Params: [from (inclusive, YYYY-MM-DD), to (exclusive)]. RECOGNIZED_CLAUSE starts with " AND". */
export const SQL_REAGENT_VOLUMES =
  `SELECT item_code, count(*)::int AS n FROM public."SalesRepository" ` +
  `WHERE date_received >= $1 AND date_received < $2${RECOGNIZED_CLAUSE} GROUP BY 1`

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return [`${month}-01`, to]
}

export async function testVolumes(month: string): Promise<Record<string, number>> {
  // Imported lazily so the pure engine and its tests never open a database pool.
  const { salesQuery } = await import('../sales/db')
  const rows = await salesQuery<{ item_code: string; n: number }>(SQL_REAGENT_VOLUMES, monthRange(month))
  return Object.fromEntries(rows.map((r) => [r.item_code, Number(r.n)]))
}
