// Pemeriksaan ke database sungguhan untuk sales_customers (bukan unit test —
// butuh jaringan internal the company). Jalankan: npx tsx tests/customers-live-check.ts
//
// Memakai SQL yang SAMA PERSIS dengan produksi (customerHistorySql), supaya yang
// diuji benar-benar yang dipakai aplikasi.
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import {
  customerHistorySql,
  isPasienPribadi,
  pickBerhenti,
  pilihPelanggan,
  type BarisPelanggan
} from '../src/main/sales/customers'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'

const TABLE = 'public."SalesRepository"'
const cs = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('AIRA_SALES_DB='))!
  .slice('AIRA_SALES_DB='.length)
  .trim()

const pool = new Pool({ connectionString: cs, max: 2, statement_timeout: 60_000 })
const DARI = '2025-08-18'
const SAMPAI = '2026-08-18'
const JENDELA = 90
let gagal = 0

function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

const rupiah = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`

async function main(): Promise<void> {
  const sql = customerHistorySql({
    table: TABLE,
    basisColumn: 'date_received',
    filterClause: RECOGNIZED_CLAUSE
  })
  const t = Date.now()
  const r = await pool.query<BarisPelanggan>(sql, [DARI, SAMPAI, JENDELA])
  const ms = Date.now() - t
  const rows = r.rows

  cek('query riwayat pelanggan berjalan', rows.length > 0, `${rows.length} pelanggan`)
  // Cache dingin bisa 40 detik (tabelnya ~500 MB); karena itu tool ini memakai batas
  // waktu khusus 60 detik, bukan 20 detik bawaan. Jalan kedua menguji kondisi hangat.
  cek('jalan pertama selesai < 60 dtk (cache bisa dingin)', ms < 60_000, `${ms} ms`)
  const t2 = Date.now()
  await pool.query(sql, [DARI, SAMPAI, JENDELA])
  const ms2 = Date.now() - t2
  cek('jalan kedua (cache hangat) < 10 dtk', ms2 < 10_000, `${ms2} ms`)

  // Total nett per pelanggan harus sama dengan agregat polos — pola LATERAL tidak
  // boleh menggelembungkan apa pun.
  //
  // ⚠️ Kedua query WAJIB dalam satu snapshot REPEATABLE READ. Ini database produksi
  // yang hidup: transaksi baru masuk di sela dua query, dan perbandingannya jadi
  // gagal semu (terukur — selisihnya persis satu transaksi baru).
  const client = await pool.connect()
  let totalRows = 0
  let totalPolos = 0
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const snap = await client.query<BarisPelanggan>(sql, [DARI, SAMPAI, JENDELA])
    const polos = await client.query(
      `SELECT coalesce(sum(nett_sales),0)::float8 AS nett FROM ${TABLE}
       WHERE date_received BETWEEN $1::date AND $2::date${RECOGNIZED_CLAUSE}`,
      [DARI, SAMPAI]
    )
    totalRows = snap.rows.reduce((s, x) => s + Number(x.nettTotal), 0)
    totalPolos = Number(polos.rows[0].nett)
    await client.query('COMMIT')
  } finally {
    client.release()
  }
  cek(
    'total nett identik dengan agregat tanpa join master',
    Math.abs(totalRows - totalPolos) < 0.01,
    `${rupiah(totalRows)} vs ${rupiah(totalPolos)}`
  )

  // Tidak boleh ada baris tanpa nama — cadangan nama transaksi harus bekerja.
  const tanpaNama = rows.filter((x) => !x.nama || !String(x.nama).trim())
  cek('setiap pelanggan punya nama (cadangan dari transaksi bekerja)', tanpaNama.length === 0,
    `${tanpaNama.length} kosong`)

  // Segmentasi
  const pp = rows.filter((x) => isPasienPribadi(x.tipe, x.nama))
  cek('pasien pribadi terdeteksi', pp.length > 0, `${pp.length} akun`)
  const takTerMaster = rows.filter((x) => x.tipe === null)
  const takTerMasterPP = takTerMaster.filter((x) => isPasienPribadi(null, x.nama))
  console.log(
    `     tak ada di master: ${takTerMaster.length}, di antaranya terdeteksi Pasien Pribadi: ${takTerMasterPP.length}`
  )

  const institusi = pilihPelanggan(rows, 'berhenti', 'institusi')
  const semua = pickBerhenti(rows)
  cek('segmen institusi lebih sedikit daripada semua', institusi.length < semua.length,
    `${institusi.length} vs ${semua.length}`)
  cek(
    'tidak ada pasien pribadi yang lolos ke daftar institusi',
    institusi.every((x) => !isPasienPribadi(x.tipe, x.nama))
  )
  cek('diurutkan menurun berdasarkan nilai', institusi.every(
    (x, i) => i === 0 || Number(institusi[i - 1].nettTotal) >= Number(x.nettTotal)
  ))

  const nilai = institusi.reduce((s, x) => s + Number(x.nettTotal), 0)
  console.log(`\nPELANGGAN INSTITUSI BERHENTI: ${institusi.length} akun · ${rupiah(nilai)} setahun`)
  for (const x of institusi.slice(0, 8)) {
    console.log(
      `     ${String(x.nama).slice(0, 45).padEnd(45)} ${String(x.bulanAktif).padStart(2)} bln aktif · ` +
        `diam ${String(x.hariDiam).padStart(3)} hari · ${rupiah(Number(x.nettTotal))}`
    )
  }

  const melemah = pilihPelanggan(rows, 'melemah', 'institusi')
  const baru = pilihPelanggan(rows, 'baru', 'institusi')
  console.log(`\nMELEMAH: ${melemah.length} · BARU: ${baru.length}`)
  cek('daftar melemah & berhenti tidak tumpang tindih',
    melemah.every((m) => !institusi.some((b) => b.kode === m.kode)))

  await pool.end()
  console.log(gagal === 0 ? '\nSEMUA LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
