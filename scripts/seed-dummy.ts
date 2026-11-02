// Fill the local dummy database `metahackton` with synthetic data for the hackathon demo.
//
//   npm run seed:dummy                     # data up to now
//   npm run seed:dummy -- --until 2026-11-04
//
// Refuses any database host that is not localhost. Drops and recreates ONLY the source tables
// (public."SalesRepository", masters, tracker, schema inno) — never the app's tb_*_aira tables.
import { readFileSync } from 'fs'
import { Client } from 'pg'
import { assertLocalDb } from '../src/main/hackathon/local-db'
import { makeRng } from './seed/prng'
import {
  DROP_STATEMENTS,
  DDL_PUBLIC,
  DDL_INNO,
  columnNames,
  SALES_REPOSITORY,
  M_CUSTOMER,
  M_PROVINCES,
  M_CITIES,
  M_ITEM_REPOSITORY,
  SAMPLE_TRACKER,
  TABLES_INNO,
  type TableDef
} from './seed/ddl'
import { insertRows } from './seed/insert'
import { generateSales } from './seed/sales'
import { generateTracker } from './seed/tracker'
import { generateInno } from './seed/inno'
import { resolveUntil } from './seed/until'

const SEED = 20261102
const FROM = new Date('2025-01-01T00:00:00')

function connectionString(): string {
  // A process env var wins over .env (used to prove the local-only refusal).
  if (process.env.AIRA_SALES_DB) return process.env.AIRA_SALES_DB
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('AIRA_SALES_DB='))
  return line ? line.slice('AIRA_SALES_DB='.length).trim() : ''
}

function untilArg(): Date {
  const i = process.argv.indexOf('--until')
  return resolveUntil(i < 0 ? undefined : (process.argv[i + 1] ?? ''), new Date())
}

async function fill(client: Client, table: TableDef, rows: unknown[][]): Promise<void> {
  await client.query('BEGIN')
  const n = await insertRows(client, table.name, columnNames(table), rows)
  await client.query('COMMIT')
  console.log(`${table.name}: ${n} rows`)
}

async function main(): Promise<void> {
  const started = Date.now()
  const cs = connectionString()
  assertLocalDb(cs, 'AIRA_SALES_DB')
  const until = untilArg()

  const sales = generateSales(makeRng(SEED), FROM, until)
  const tracker = generateTracker(makeRng(SEED + 1), sales.orderIdOrders, until)
  const inno = generateInno(makeRng(SEED + 2), sales.customers, sales.items)

  const client = new Client({ connectionString: cs })
  await client.connect()
  try {
    for (const sql of DROP_STATEMENTS) await client.query(sql)
    for (const sql of [...DDL_PUBLIC, ...DDL_INNO]) await client.query(sql)

    await fill(client, M_PROVINCES, sales.provinces)
    await fill(client, M_CITIES, sales.cities)
    await fill(client, M_CUSTOMER, sales.customers)
    await fill(client, M_ITEM_REPOSITORY, sales.items)
    await fill(client, SALES_REPOSITORY, sales.sales)
    await fill(client, SAMPLE_TRACKER, tracker)
    for (const def of TABLES_INNO) {
      await fill(client, def, inno[def.name.replace('inno.', '') as keyof typeof inno])
    }
    await client.query('ANALYZE')
  } finally {
    await client.end()
  }
  const day = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`
  console.log(`Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s (until ${day})`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
