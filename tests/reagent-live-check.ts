// Reagent Check against the local dummy database (not part of npm test):
//   npx tsx tests/reagent-live-check.ts
// 1. Volumes from SQL_REAGENT_VOLUMES equal a separately written count per test code (no join, recognition clause).
// 2. On the committed demo files the engine finds exactly the planted anomalies, on the intended items.
import { Client } from 'pg'
import { SQL_REAGENT_VOLUMES, monthRange } from '../src/main/reagent/volumes'
import { clearReagentCache, runReconciliation } from '../src/main/reagent/service'
import { PLANTED } from '../scripts/seed/reagent'
import { envDb } from './live-env'

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: envDb('AIRA_SALES_DB') })
  await db.connect()
  const month = '2026-10'
  const [from, to] = monthRange(month)
  const t0 = Date.now()
  const a = await db.query<{ item_code: string; n: number }>(SQL_REAGENT_VOLUMES, [from, to])
  const ms = Date.now() - t0
  const b = await db.query<{ item_code: string; n: number }>(
    `SELECT item_code, count(*)::int AS n FROM public."SalesRepository"
      WHERE date_received >= $1::date AND date_received < $2::date
        AND transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL
      GROUP BY item_code`,
    [from, to]
  )
  const va = Object.fromEntries(a.rows.map((r) => [r.item_code, r.n]))
  const vb = Object.fromEntries(b.rows.map((r) => [r.item_code, r.n]))
  cek('volumes identical to a separate count', JSON.stringify(Object.entries(va).sort()) === JSON.stringify(Object.entries(vb).sort()), `${a.rows.length} test codes, ${ms} ms`)
  const all = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public."SalesRepository" WHERE date_received >= $1 AND date_received < $2`, [from, to])
  const recognised = Object.values(va).reduce((s, n) => s + n, 0)
  cek('cancelled transfers are not counted', recognised <= all.rows[0].n, `${recognised} of ${all.rows[0].n} rows`)
  await db.end()

  clearReagentCache()
  const r = await runReconciliation({ folder: 'demo-data/reagent', month, deps: { volumes: async () => va } })
  if ('error' in r) {
    cek('reconciliation runs on the demo files', false, r.error)
  } else {
    const got = r.findings.map((f) => `${f.type}:${f.itemCode}`).sort()
    const want = PLANTED.map((p) => `${p.type}:${p.itemCode}`).sort()
    cek('exactly the planted findings', JSON.stringify(got) === JSON.stringify(want), got.join(', '))
    cek('every finding has evidence', r.findings.every((f) => f.evidence.length > 0))
    cek('no rows skipped in the demo files', r.summary.skipped.length === 0, String(r.summary.skipped.length))
    cek(
      'no item left unchecked on the demo files',
      r.summary.notChecked.length === 0,
      r.summary.notChecked.map((n) => `${n.itemCode}: ${n.reason}`).join('; ') || `${r.summary.itemsChecked} items checked`
    )
  }
  console.log(gagal ? `${gagal} PEMERIKSAAN GAGAL` : 'SEMUA LOLOS')
  process.exit(gagal ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
