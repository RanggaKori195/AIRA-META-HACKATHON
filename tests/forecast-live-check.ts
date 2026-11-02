// Pemeriksaan peramalan ke database sungguhan (bukan unit test — butuh jaringan
// internal the company). Jalankan: npx tsx tests/forecast-live-check.ts
//
// Membuktikan yang TIDAK bisa dibuktikan unit test:
//   1. SQL-nya diterima Postgres dan mengembalikan riwayat yang masuk akal
//   2. Bulan BERJALAN benar-benar keluar dari riwayat pelatihan (kalau ikut, ia
//      terbaca sebagai kejatuhan dan tren meramalkan penurunan yang tidak ada)
//   3. Baris bertanggal MASA DEPAN tidak menyelinap (ada transaksi bertanggal
//      21 Agu 2026 di data — lihat HANDOFF §13)
//   4. Akurasi metode pada data hari ini masih di kisaran yang diklaim ke user
//   5. Proyeksi bulan berjalan tidak lebih kecil dari yang sudah terkumpul

import { Pool } from 'pg'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'
import { envDb } from './live-env'
import {
  bulanBerikut,
  harapanTren,
  mapeBacktest,
  momentum,
  proyeksiBulanBerjalan,
  ramal,
  MIN_RIWAYAT
} from '../src/main/sales/forecast'

const cs = envDb('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

const rupiah = (n: number): string => `Rp ${(n / 1e9).toFixed(3)} M`

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 20_000 })
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await pool.query(sql, p)).rows as T[]

  const kolom = 'date_result' // basis invoice — yang diakui sebagai sales

  const rows = await q<{ bulan: string; nett: string }>(
    `SELECT to_char(date_trunc('month', ${kolom}), 'YYYY-MM') AS bulan, sum(nett_sales) AS nett
       FROM public."SalesRepository"
      WHERE ${kolom} IS NOT NULL
        AND ${kolom} < date_trunc('month', now())${RECOGNIZED_CLAUSE}
      GROUP BY 1 ORDER BY 1`
  )
  const riwayat = rows.map((r) => ({ bulan: r.bulan, nett: Number(r.nett) }))
  cek('riwayat bulanan terbaca', riwayat.length >= MIN_RIWAYAT, `${riwayat.length} bulan penuh`)

  const bulanSekarang = new Date().toISOString().slice(0, 7)
  cek(
    'bulan BERJALAN tidak ikut ke riwayat pelatihan',
    !riwayat.some((r) => r.bulan >= bulanSekarang),
    `terakhir = ${riwayat[riwayat.length - 1]?.bulan}, sekarang = ${bulanSekarang}`
  )

  // Baris bertanggal masa depan — ada di data, dan kalau ikut masuk ke bulan
  // berjalan ia menggelembungkan proyeksi.
  const [depan] = await q<{ n: string }>(
    `SELECT count(*) AS n FROM public."SalesRepository"
      WHERE ${kolom} > now()${RECOGNIZED_CLAUSE}`
  )
  console.log(`     (catatan: ${depan.n} baris bertanggal MASA DEPAN ada di tabel)`)

  const nilai = riwayat.map((r) => r.nett)
  const mape = mapeBacktest(nilai)
  cek('akurasi historis bisa dihitung', mape !== null, mape === null ? '' : `MAPE ${mape.toFixed(1)}%`)
  cek(
    'akurasi masih di kisaran yang diklaim ke user (< 15%)',
    mape !== null && mape < 15,
    mape === null ? 'tidak terhitung' : `${mape.toFixed(1)}%`
  )

  // ⚠️ Dipanggil PERSIS seperti tool memanggilnya — termasuk `mulaiDari`.
  // Live-check yang memakai jalur berbeda dari aplikasi tidak menguji aplikasi;
  // itu pelajaran 18 Agu 2026 (SQL lolos di skrip, gagal di Electron).
  const bulanSekarangStr = new Date().toISOString().slice(0, 7)
  const bulanDepan = bulanBerikut(bulanSekarangStr, 1)
  const r = ramal(riwayat, 3, mape, bulanDepan)
  console.log('\n  Ramalan 3 bulan ke depan:')
  for (const x of r) {
    console.log(
      `   ${x.bulan}  ${rupiah(x.nett)}   rentang ${rupiah(x.bawah ?? 0)} .. ${rupiah(x.atas ?? 0)}`
    )
  }
  cek('ramalan tidak negatif', r.every((x) => x.nett >= 0))
  // Inti perbaikan 20 Agu 2026: bulan berjalan adalah urusan sales_projection,
  // yang punya transaksi nyatanya. Kalau ramalan ikut mencakupnya, AIRA punya
  // dua angka berbeda untuk bulan yang sama.
  cek(
    'ramalan TIDAK mencakup bulan berjalan',
    !r.some((x) => x.bulan <= bulanSekarangStr),
    `mulai ${r[0].bulan}, bulan berjalan ${bulanSekarangStr}`
  )
  cek(
    'rentang melebar makin jauh horizon',
    (r[2].atas! - r[2].bawah!) / r[2].nett > (r[0].atas! - r[0].bawah!) / r[0].nett
  )
  // Bisnis ini sedang tumbuh; ramalan yang lebih kecil dari bulan terakhir berarti
  // ada yang salah pada jendela pelatihan (mis. bulan berjalan ikut masuk).
  cek(
    'ramalan bulan depan masuk akal dibanding bulan terakhir',
    r[0].nett > nilai[nilai.length - 1] * 0.7,
    `${rupiah(r[0].nett)} vs terakhir ${rupiah(nilai[nilai.length - 1])}`
  )

  // --- proyeksi bulan berjalan ---
  const [kini] = await q<{ nett: string }>(
    `SELECT coalesce(sum(nett_sales), 0) AS nett FROM public."SalesRepository"
      WHERE ${kolom} >= date_trunc('month', now()) AND ${kolom} <= now()${RECOGNIZED_CLAUSE}`
  )
  const kurvaRows = await q<{ hari: number; porsi: string }>(
    `WITH per_hari AS (
       SELECT to_char(date_trunc('month', ${kolom}), 'YYYY-MM') AS bln,
              extract(day FROM ${kolom})::int AS hari, sum(nett_sales) AS nett
         FROM public."SalesRepository"
        WHERE ${kolom} >= date_trunc('month', now()) - interval '6 months'
          AND ${kolom} < date_trunc('month', now())${RECOGNIZED_CLAUSE}
        GROUP BY 1, 2
     ), kum AS (
       SELECT bln, hari,
              sum(nett) OVER (PARTITION BY bln ORDER BY hari)
                / NULLIF(sum(nett) OVER (PARTITION BY bln), 0) AS porsi
         FROM per_hari
     )
     SELECT hari, avg(porsi) AS porsi FROM kum GROUP BY hari ORDER BY hari`
  )
  const peta = new Map(kurvaRows.map((k) => [Number(k.hari), Number(k.porsi)]))
  const hariKe = new Date().getDate()
  const hariDalamBulan = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const nettKini = Number(kini.nett)
  const p = proyeksiBulanBerjalan(nettKini, hariKe, hariDalamBulan, peta)

  console.log(
    `\n  Bulan berjalan s/d tgl ${hariKe}: ${rupiah(nettKini)}  ->  proyeksi ${rupiah(p.proyeksiNett)} (${p.dasar}, porsi ${(p.porsiTerlewati * 100).toFixed(1)}%)`
  )
  // "Bulan ini bagus atau jelek?" — proyeksi dibandingkan dengan yang diharapkan
  // tren. Inilah pertanyaan yang selalu menyusul di rapat.
  const harapan = harapanTren(riwayat, bulanSekarangStr)
  if (harapan !== null) {
    const selisih = ((p.proyeksiNett - harapan) / harapan) * 100
    console.log(
      `  Harapan tren untuk bulan ini: ${rupiah(harapan)}  ->  proyeksi ${selisih >= 0 ? '+' : ''}${selisih.toFixed(1)}% terhadap tren`
    )
  }
  cek('harapan tren untuk bulan berjalan terhitung', harapan !== null)
  cek('kurva penumpukan terbaca dari database', peta.size >= 20, `${peta.size} tanggal`)
  cek('proyeksi >= yang sudah terkumpul', p.proyeksiNett >= nettKini)
  cek('proyeksi memakai kurva historis, bukan pro-rata', p.dasar === 'kurva historis', p.dasar)

  // --- momentum item ---
  const item = await q<{ item_code: string; bulan: string; nett: string }>(
    `WITH besar AS (
       SELECT item_code FROM public."SalesRepository"
        WHERE ${kolom} >= date_trunc('month', now()) - interval '12 months'
          AND ${kolom} < date_trunc('month', now())${RECOGNIZED_CLAUSE}
        GROUP BY item_code ORDER BY sum(nett_sales) DESC LIMIT 10
     )
     SELECT item_code, to_char(date_trunc('month', ${kolom}), 'YYYY-MM') AS bulan, sum(nett_sales) AS nett
       FROM public."SalesRepository"
      WHERE item_code IN (SELECT item_code FROM besar)
        AND ${kolom} < date_trunc('month', now())${RECOGNIZED_CLAUSE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
  const perItem = new Map<string, Map<string, number>>()
  for (const x of item) {
    if (!perItem.has(x.item_code)) perItem.set(x.item_code, new Map())
    perItem.get(x.item_code)!.set(x.bulan, Number(x.nett))
  }
  const bulanItem = [...new Set(item.map((x) => x.bulan))].sort().slice(-12)
  let naik = 0
  let turun = 0
  for (const [, seri] of perItem) {
    const m = momentum(bulanItem.map((b) => seri.get(b) ?? 0))
    if (m.arah === 'naik') naik++
    if (m.arah === 'turun') turun++
  }
  console.log(`\n  Momentum 10 item terbesar: ${naik} naik, ${turun} turun, sisanya datar/baru`)
  cek('momentum item terhitung', perItem.size > 0, `${perItem.size} item`)

  await pool.end()
  console.log(gagal === 0 ? '\nSEMUA LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
