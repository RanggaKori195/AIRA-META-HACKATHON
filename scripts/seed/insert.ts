import type { Client } from 'pg'

/** Multi-row INSERT in batches. Returns the number of rows written. */
export async function insertRows(
  client: Client,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  batchSize = 1000
): Promise<number> {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      if (row.length !== columns.length) {
        throw new Error(`${table}: row has ${row.length} values, expected ${columns.length}`)
      }
      const marks = row.map((v) => {
        params.push(v)
        return `$${params.length}`
      })
      return `(${marks.join(', ')})`
    })
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params)
  }
  return rows.length
}
