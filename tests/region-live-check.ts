// Pemeriksaan ke database sungguhan (bukan unit test — butuh jaringan internal the company).
// Jalankan manual: npx tsx tests/region-live-check.ts
//
// Gunanya membuktikan dua hal yang tidak bisa dibuktikan unit test:
//   1. SQL dimensi wilayah memang jalan di Postgres
//   2. totalnya IDENTIK dengan agregat tanpa join master (tidak menggelembung)
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import { CUSTOMER_DIMENSIONS, customerDimensionSql, customerTypeLabel, regionFilter } from '../src/main/sales/region'
import { withShare } from '../src/main/sales/contribution'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'

const TABLE = 'public."SalesRepository"'
const cs = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('AIRA_SALES_DB='))!
  .slice('AIRA_SALES_DB='.length)
  .trim()

const pool = new Pool({ connectionString: cs, max: 2, statement_timeout: 30_000 })
const DARI = '2026-08-01'
const SAMPAI = '2026-08-31'
let gagal = 0

function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function main(): Promise<void> {
  // --- Dasar pengakuan ---------------------------------------------------
  // Varian OR pernah nyaris dipakai karena aturannya diucapkan sebagai "atau".
  // Cek ini membuktikan OR tidak menyaring apa pun, jadi kalau suatu saat klausanya
  // diubah jadi OR, pemeriksaan ini yang menangkapnya.
  const p = await pool.query(
    `SELECT coalesce(sum(nett_sales),0)::float8 AS tanpa_filter,
            coalesce(sum(nett_sales) FILTER (
              WHERE transfer_test_deleted_at IS NULL
                AND transaction_transfer_deleted_at IS NULL),0)::float8 AS pakai_and,
            coalesce(sum(nett_sales) FILTER (
              WHERE transfer_test_deleted_at IS NULL
                 OR transaction_transfer_deleted_at IS NULL),0)::float8 AS pakai_or
     FROM ${TABLE} WHERE date_received BETWEEN $1::date AND $2::date`,
    [DARI, SAMPAI]
  )
  const { tanpa_filter, pakai_and, pakai_or } = p.rows[0]
  cek('klausa pengakuan memakai AND', RECOGNIZED_CLAUSE.includes(' AND ') && !/\bOR\b/.test(RECOGNIZED_CLAUSE))
  cek('varian OR terbukti tidak menyaring apa pun', Number(pakai_or) === Number(tanpa_filter), `${pakai_or}`)
  cek('varian AND benar-benar mengeluarkan baris terhapus', Number(pakai_and) < Number(tanpa_filter),
    `${Number(tanpa_filter) - Number(pakai_and)} dikeluarkan`)

  const polos = await pool.query(
    `SELECT coalesce(sum(nett_sales),0)::float8 AS nett, count(*)::int AS trx
     FROM ${TABLE} WHERE date_received BETWEEN $1::date AND $2::date${RECOGNIZED_CLAUSE}`,
    [DARI, SAMPAI]
  )
  const nettPolos = Number(polos.rows[0].nett)
  const trxPolos = Number(polos.rows[0].trx)
  console.log(`Acuan Agustus 2026: nett=${nettPolos} transaksi=${trxPolos}\n`)

  for (const [nama, dim] of Object.entries(CUSTOMER_DIMENSIONS)) {
    const sql = customerDimensionSql({
      table: TABLE,
      basisColumn: 'date_received',
      filterClause: RECOGNIZED_CLAUSE,
      expr: dim.expr,
      arah: 'DESC',
      limit: 500
    })
    const t = Date.now()
    const r = await pool.query(sql, [DARI, SAMPAI])
    const ms = Date.now() - t
    const nett = r.rows.reduce((s, x) => s + Number(x.nett), 0)
    const trx = r.rows.reduce((s, x) => s + Number(x.barisItem), 0)

    cek(`${nama}: total nett identik dengan tanpa join`, Math.abs(nett - nettPolos) < 0.01, `${nett}`)
    cek(`${nama}: total barisItem identik`, trx === trxPolos, `${trx}`)
    cek(`${nama}: selesai < 20 dtk`, ms < 20_000, `${ms} ms`)
    const top = r.rows.slice(0, 3).map((x) => {
      const label = dim.asCode ? customerTypeLabel(String(x.kategori)) : String(x.kategori)
      return `${label}=${Math.round(Number(x.nett) / 1e6)} jt`
    })
    console.log(`     3 teratas: ${top.join(' · ')}\n`)
  }

  // Filter wilayah: total Jawa Barat harus <= total keseluruhan dan > 0.
  const f = regionFilter({ province: 'Jawa Barat' }, 3)
  const filtered = await pool.query(
    `SELECT coalesce(sum(nett_sales),0)::float8 AS nett FROM ${TABLE}
     WHERE date_received BETWEEN $1::date AND $2::date${f.clause}${RECOGNIZED_CLAUSE}`,
    [DARI, SAMPAI, ...f.params]
  )
  const nettJabar = Number(filtered.rows[0].nett)
  cek('filter province="Jawa Barat" menghasilkan angka wajar', nettJabar > 0 && nettJabar < nettPolos, `${nettJabar}`)

  // Angka filter harus sama dengan baris Jawa Barat pada breakdown provinsi.
  const bd = await pool.query(
    customerDimensionSql({
      table: TABLE,
      basisColumn: 'date_received',
      filterClause: RECOGNIZED_CLAUSE,
      expr: CUSTOMER_DIMENSIONS.province.expr,
      arah: 'DESC',
      limit: 500
    }),
    [DARI, SAMPAI]
  )
  const barisJabar = bd.rows.find((x) => String(x.kategori).toUpperCase() === 'JAWA BARAT')
  cek(
    'filter provinsi cocok dengan baris breakdown provinsi',
    !!barisJabar && Math.abs(Number(barisJabar.nett) - nettJabar) < 0.01,
    `breakdown=${barisJabar?.nett} filter=${nettJabar}`
  )

  // --- Hitungan order vs baris item -------------------------------------
  const t0 = Date.now()
  const ring = await pool.query(
    `SELECT count(DISTINCT order_id)::int  AS "jumlahOrder",
            count(*)::int                   AS "barisItem",
            count(DISTINCT invoice_no)::int AS "jumlahInvoice"
     FROM ${TABLE} WHERE date_received BETWEEN $1::date AND $2::date${RECOGNIZED_CLAUSE}`,
    [DARI, SAMPAI]
  )
  const msRing = Date.now() - t0
  const { jumlahOrder, barisItem, jumlahInvoice } = ring.rows[0]
  console.log(`\nAgustus 2026: order=${jumlahOrder} barisItem=${barisItem} invoice=${jumlahInvoice}`)
  cek('barisItem cocok dengan acuan', barisItem === trxPolos)
  cek('jumlahOrder lebih kecil dari barisItem (satu order bisa banyak item)', jumlahOrder < barisItem)
  cek('ringkasan selesai < 20 dtk', msRing < 20_000, `${msRing} ms`)

  // Order melekat pada satu pelanggan, jadi untuk dimensi berbasis pelanggan
  // jumlah order antar baris TIDAK boleh tumpang tindih berlebihan.
  const prov = await pool.query(
    customerDimensionSql({
      table: TABLE,
      basisColumn: 'date_received',
      filterClause: RECOGNIZED_CLAUSE,
      expr: CUSTOMER_DIMENSIONS.province.expr,
      arah: 'DESC',
      limit: 500
    }),
    [DARI, SAMPAI]
  )
  const orderProv = prov.rows.reduce((s, x) => s + Number(x.jumlahOrder), 0)
  const barisProv = prov.rows.reduce((s, x) => s + Number(x.barisItem), 0)
  cek('breakdown provinsi: barisItem tetap identik', barisProv === trxPolos, `${barisProv}`)
  cek(
    'breakdown provinsi: jumlah order menyimpang < 1% dari total order',
    Math.abs(orderProv - jumlahOrder) / jumlahOrder < 0.01,
    `${orderProv} vs ${jumlahOrder}`
  )

  // --- Persen kontribusi -------------------------------------------------
  const top = prov.rows.slice(0, 10).map((r) => ({ nett: Number(r.nett) }))
  const share = withShare(top, nettPolos)
  const jumlahPersen = share.baris.reduce((s, b) => s + (b.persen ?? 0), 0)
  cek(
    'persen tiap baris konsisten dengan persenTercakup',
    Math.abs(jumlahPersen - (share.persenTercakup ?? 0)) < 0.5,
    `${jumlahPersen.toFixed(1)}% vs ${share.persenTercakup}%`
  )
  cek('persen tercakup tidak melebihi 100%', (share.persenTercakup ?? 0) <= 100.01, `${share.persenTercakup}%`)

  await pool.end()
  console.log(gagal === 0 ? '\nSEMUA LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
