// Menakar apakah data SalesRepository cukup untuk forecasting — dan metode mana
// yang benar-benar akurat di data INI, bukan yang paling canggih di teori.
//
// Jalankan: npx tsx scripts/probe-forecast.ts   (butuh jaringan internal the company)
//
// Alasan skrip ini ada: forecast adalah angka yang TIDAK BISA DIVERIFIKASI hari
// ini tapi dipakai mengambil keputusan. Memilih metodenya dari teori lalu
// berharap cocok adalah cara paling rapi untuk menghasilkan angka salah yang
// terdengar meyakinkan. Jadi metodenya dipilih dari backtest ke data sungguhan.

import { readFileSync } from 'fs'
import { Pool } from 'pg'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}

const cs = envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

interface Bulan {
  bulan: string
  nett: number
  order: number
  hariAktif: number
}

const rupiah = (n: number): string =>
  `Rp ${(n / 1_000_000_000).toFixed(3)} M`

/** MAPE — rata-rata galat absolut dalam persen. */
function mape(aktual: number[], ramalan: number[]): number {
  let total = 0
  for (let i = 0; i < aktual.length; i++) total += Math.abs(aktual[i] - ramalan[i]) / aktual[i]
  return (total / aktual.length) * 100
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 20_000 })
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await pool.query(sql, p)).rows as T[]

  // Basis INVOICE (date_result) — yang diakui sebagai sales (aturan 4).
  const rows = await q<any>(
    `SELECT to_char(date_trunc('month', date_result), 'YYYY-MM') AS bulan,
            sum(nett_sales)                       AS nett,
            count(DISTINCT order_id)             AS jml_order,
            count(DISTINCT date_result::date)     AS hari_aktif
       FROM public."SalesRepository"
      WHERE date_result IS NOT NULL
        AND date_result < date_trunc('month', now())
        ${RECOGNIZED_CLAUSE}
      GROUP BY 1
      ORDER BY 1`
  )

  const data: Bulan[] = rows.map((r) => ({
    bulan: r.bulan,
    nett: Number(r.nett),
    order: Number(r.jml_order),
    hariAktif: Number(r.hari_aktif)
  }))

  console.log(`\n=== Riwayat bulanan (basis invoice, baris diakui) — ${data.length} bulan penuh ===`)
  for (const d of data) {
    console.log(
      `${d.bulan}  ${rupiah(d.nett).padStart(14)}  ${String(d.order).padStart(7)} order  ${d.hariAktif} hari aktif`
    )
  }

  // --- Berapa panjang riwayat yang benar-benar bisa dipakai? ---
  console.log(`\n=== Kelayakan ===`)
  console.log(`Bulan penuh tersedia : ${data.length}`)
  console.log(`Siklus tahunan penuh : ${(data.length / 12).toFixed(2)}  (butuh >= 2 untuk musiman)`)

  // --- Backtest: 6 bulan terakhir diramal dengan hanya data SEBELUMNYA ---
  const UJI = 6
  if (data.length < UJI + 6) {
    console.log('Riwayat terlalu pendek untuk backtest yang berarti.')
    await pool.end()
    return
  }

  const aktual: number[] = []
  const rNaif: number[] = []
  const rMa3: number[] = []
  const rLinier: number[] = []
  const rMusiman: number[] = []
  const rDrift: number[] = []

  for (let i = data.length - UJI; i < data.length; i++) {
    const latih = data.slice(0, i).map((d) => d.nett)
    aktual.push(data[i].nett)

    // 1. Naif: bulan depan = bulan ini
    rNaif.push(latih[latih.length - 1])

    // 2. Rata-rata bergerak 3 bulan
    rMa3.push(latih.slice(-3).reduce((a, b) => a + b, 0) / 3)

    // 3. Regresi linier pada 12 bulan terakhir
    const w = latih.slice(-12)
    const n = w.length
    const sx = (n * (n - 1)) / 2
    const sxx = ((n - 1) * n * (2 * n - 1)) / 6
    const sy = w.reduce((a, b) => a + b, 0)
    const sxy = w.reduce((a, b, idx) => a + b * idx, 0)
    const kemiringan = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    const potong = (sy - kemiringan * sx) / n
    rLinier.push(potong + kemiringan * n)

    // 4. Naif musiman: bulan yang sama tahun lalu × pertumbuhan YoY 3 bulan terakhir
    const idxTahunLalu = i - 12
    if (idxTahunLalu >= 0) {
      const tahunLalu = data[idxTahunLalu].nett
      const rasio: number[] = []
      for (let k = 1; k <= 3; k++) {
        const skr = data[i - k]?.nett
        const lalu = data[i - k - 12]?.nett
        if (skr && lalu) rasio.push(skr / lalu)
      }
      const yoy = rasio.length > 0 ? rasio.reduce((a, b) => a + b, 0) / rasio.length : 1
      rMusiman.push(tahunLalu * yoy)
    } else {
      rMusiman.push(latih[latih.length - 1])
    }

    // 5. Drift: bulan terakhir + rata-rata perubahan 3 bulan terakhir
    const d1 = latih[latih.length - 1] - latih[latih.length - 2]
    const d2 = latih[latih.length - 2] - latih[latih.length - 3]
    const d3 = latih[latih.length - 3] - latih[latih.length - 4]
    rDrift.push(latih[latih.length - 1] + (d1 + d2 + d3) / 3)
  }

  console.log(`\n=== Backtest ${UJI} bulan terakhir (MAPE, makin kecil makin baik) ===`)
  const hasil: Array<[string, number[]]> = [
    ['naif (bulan lalu)', rNaif],
    ['rata2 bergerak 3 bln', rMa3],
    ['regresi linier 12 bln', rLinier],
    ['naif musiman x YoY', rMusiman],
    ['drift 3 bulan', rDrift]
  ]
  hasil.sort((a, b) => mape(aktual, a[1]) - mape(aktual, b[1]))
  for (const [nama, ramal] of hasil) {
    console.log(`${nama.padEnd(24)} MAPE ${mape(aktual, ramal).toFixed(1)}%`)
  }

  console.log(`\n=== Rincian metode terbaik: ${hasil[0][0]} ===`)
  for (let i = 0; i < UJI; i++) {
    const b = data[data.length - UJI + i].bulan
    const a = aktual[i]
    const r = hasil[0][1][i]
    console.log(
      `${b}  aktual ${rupiah(a).padStart(13)}  ramalan ${rupiah(r).padStart(13)}  galat ${(((r - a) / a) * 100).toFixed(1)}%`
    )
  }

  // --- Bagaimana bulan berjalan menumpuk? (untuk proyeksi run-rate) ---
  console.log(`\n=== Pola dalam bulan: porsi nett per hari-ke (rata-rata 6 bulan penuh terakhir) ===`)
  const pola = await q<any>(
    `WITH per_hari AS (
       SELECT to_char(date_trunc('month', date_result), 'YYYY-MM') AS bulan,
              extract(day FROM date_result)::int AS hari,
              sum(nett_sales) AS nett
         FROM public."SalesRepository"
        WHERE date_result >= date_trunc('month', now()) - interval '6 months'
          AND date_result < date_trunc('month', now())
          ${RECOGNIZED_CLAUSE}
        GROUP BY 1, 2
     ), kum AS (
       SELECT bulan, hari,
              sum(nett) OVER (PARTITION BY bulan ORDER BY hari) / sum(nett) OVER (PARTITION BY bulan) AS porsi
         FROM per_hari
     )
     SELECT hari, round(avg(porsi)::numeric * 100, 1) AS porsi_persen
       FROM kum GROUP BY hari ORDER BY hari`
  )
  const penting = [5, 10, 15, 20, 25, 28, 31]
  for (const p of pola.filter((r: any) => penting.includes(Number(r.hari)))) {
    console.log(`  s/d tanggal ${String(p.hari).padStart(2)} : ${p.porsi_persen}% dari nett bulan itu`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
