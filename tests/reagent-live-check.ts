// Reagent Check against the local dummy database (not part of npm test):
//   npx tsx tests/reagent-live-check.ts
// 1. Volumes from SQL_REAGENT_VOLUMES equal a separately written count per test code (no join, recognition clause).
// 2. On the committed demo files the engine finds exactly the planted anomalies, on the intended items.
import { Client } from 'pg'
import { SQL_REAGENT_VOLUMES, monthRange } from '../src/main/reagent/volumes'
import { readFileSync } from 'fs'
import { actions, clearReagentCache, runReconciliation } from '../src/main/reagent/service'
import { parseRecount } from '../src/shared/recount'
import { LOW_STOCK, PLANTED, RECOUNT_PLANTED } from '../scripts/seed/reagent'
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

    // 3. Reorder + voice recount on the committed demo files, with the DB volumes.
    const a = await actions({ folder: 'demo-data/reagent', month, deps: { volumes: async () => va } })
    if ('error' in a) {
      cek('reagent actions run on the demo files', false, a.error)
    } else {
      const now = a.reorder.filter((l) => l.status === 'order_now').map((l) => l.itemCode).sort()
      cek('the low-stock items (and only they) are Order now', JSON.stringify(now) === JSON.stringify([...LOW_STOCK].sort()), now.join(', '))
      const kit = a.reorder.find((l) => l.itemCode === 'KIT-DNA-EXT')
      cek(
        'the factor-too-high item: sheet factor orders more than the count needs',
        !!kit && kit.sheetOrderPacks !== null && kit.sheetOrderPacks > kit.orderPacks,
        kit ? `${kit.orderPacks} vs ${kit.sheetOrderPacks} ${kit.packUnit}` : 'missing'
      )
      cek('every order is a whole number of packs', a.reorder.every((l) => Number.isInteger(l.orderPacks)))
      const script = readFileSync(`demo-data/reagent/voice-count-${month}.txt`, 'utf8')
      const rows = parseRecount(script, a.recount)
      const differs = rows.filter((x) => x.status === 'differs')
      const unknown = rows.filter((x) => x.status === 'not_recognized')
      const others = rows.filter((x) => !['differs', 'not_recognized', 'matches'].includes(x.status))
      cek(
        'the committed voice script gives the planted recount outcome',
        differs.length === 1 && differs[0].itemCode === RECOUNT_PLANTED.itemCode && differs[0].diffPacks === -RECOUNT_PLANTED.packsBelow &&
          unknown.length === 1 && others.length === 0,
        `${differs.map((d) => `${d.itemCode} ${d.diffPacks}`).join(', ')}; not recognized ${unknown.length}; matches ${rows.length - differs.length - unknown.length - others.length}`
      )
    }
  }
  console.log(gagal ? `${gagal} PEMERIKSAAN GAGAL` : 'SEMUA LOLOS')
  process.exit(gagal ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
