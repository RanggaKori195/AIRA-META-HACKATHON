// Apakah ADA pemeriksaan yang polanya musiman dan BERULANG?
//
// Jalankan: npx tsx scripts/probe-musiman-item.ts   (butuh jaringan internal the company)
//
// Pertanyaan yang dijawab skrip ini menentukan layak-tidaknya gagasan
// "gabungkan dengan sinyal kesehatan dari luar (MCP)": sinyal luar hanya berguna
// kalau permintaan pemeriksaannya MEMANG bergerak musiman. Kalau di data kita
// sendiri polanya tidak berulang antar tahun, korelasi apa pun dengan data luar
// hampir pasti kebetulan — dan kebetulan yang dipakai meramal adalah cara paling
// rapi menghasilkan angka salah yang terdengar meyakinkan.
//
// Caranya: buang dulu TRENnya (semua ikut naik karena bisnisnya tumbuh 18x),
// lalu bandingkan profil bulanan tahun-1 dengan tahun-2 pada item yang sama.
// Musiman yang nyata = dua tahun itu berkorelasi. Naik-turun acak = tidak.

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

/** Korelasi Pearson. */
function korelasi(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n
  let atas = 0
  let kiri = 0
  let kanan = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    atas += da * db
    kiri += da * da
    kanan += db * db
  }
  return kiri > 0 && kanan > 0 ? atas / Math.sqrt(kiri * kanan) : 0
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 30_000 })
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await pool.query(sql, p)).rows as T[]

  // 30 item terbesar 12 bulan terakhir. Nama menyusul lewat LATERAL (aturan 6:
  // master TIDAK boleh di-join langsung ke SalesRepository).
  const teratas = await q<any>(
    `SELECT s.item_code,
            sum(s.nett_sales) AS nett,
            (SELECT m.item_name FROM m_item_repository m
              WHERE m.item_code_erp = s.item_code LIMIT 1) AS nama
       FROM public."SalesRepository" s
      WHERE s.date_result >= date_trunc('month', now()) - interval '12 months'
        AND s.date_result < date_trunc('month', now())
        ${RECOGNIZED_CLAUSE}
      GROUP BY s.item_code
      ORDER BY nett DESC
      LIMIT 30`
  )
  const kode = teratas.map((t) => t.item_code)

  const seri = await q<any>(
    `SELECT item_code,
            to_char(date_trunc('month', date_result), 'YYYY-MM') AS bulan,
            sum(nett_sales) AS nett
       FROM public."SalesRepository"
      WHERE item_code = ANY($1::text[])
        AND date_result IS NOT NULL
        AND date_result < date_trunc('month', now())
        ${RECOGNIZED_CLAUSE}
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [kode]
  )

  const perItem = new Map<string, Map<string, number>>()
  for (const r of seri) {
    if (!perItem.has(r.item_code)) perItem.set(r.item_code, new Map())
    perItem.get(r.item_code)!.set(r.bulan, Number(r.nett))
  }

  const bulanSemua = [...new Set(seri.map((r: any) => r.bulan))].sort()
  console.log(`\nRentang: ${bulanSemua[0]} s/d ${bulanSemua[bulanSemua.length - 1]} (${bulanSemua.length} bulan)`)

  // Dua jendela 12 bulan yang bisa dibandingkan.
  const th2 = bulanSemua.slice(-12)
  const th1 = bulanSemua.slice(-24, -12)
  if (th1.length < 12) {
    console.log('Riwayat kurang dari 24 bulan — perbandingan dua tahun tidak bisa dilakukan.')
    await pool.end()
    return
  }
  console.log(`Tahun-1: ${th1[0]}..${th1[11]}   Tahun-2: ${th2[0]}..${th2[11]}\n`)

  interface Baris {
    nama: string
    kode: string
    nett: number
    r: number
    ragam: number
    puncak1: string
    puncak2: string
  }
  const hasil: Baris[] = []

  for (const t of teratas) {
    const m = perItem.get(t.item_code)
    if (!m) continue
    const v1 = th1.map((b) => m.get(b) ?? 0)
    const v2 = th2.map((b) => m.get(b) ?? 0)
    if (v1.filter((x) => x > 0).length < 10 || v2.filter((x) => x > 0).length < 10) continue

    // Buang tren: tiap tahun dinormalkan ke rata-ratanya sendiri, jadi yang
    // tersisa hanya BENTUK naik-turunnya dalam setahun.
    const r1 = v1.reduce((a, b) => a + b, 0) / 12
    const r2 = v2.reduce((a, b) => a + b, 0) / 12
    const n1 = v1.map((x) => x / r1)
    const n2 = v2.map((x) => x / r2)

    const rata = n2.reduce((a, b) => a + b, 0) / 12
    const ragam = Math.sqrt(n2.reduce((a, b) => a + (b - rata) ** 2, 0) / 12)

    hasil.push({
      nama: String(t.nama ?? '(tanpa nama)').slice(0, 34),
      kode: t.item_code,
      nett: Number(t.nett),
      r: korelasi(n1, n2),
      ragam,
      puncak1: th1[n1.indexOf(Math.max(...n1))].slice(5),
      puncak2: th2[n2.indexOf(Math.max(...n2))].slice(5)
    })
  }

  hasil.sort((a, b) => b.r - a.r)

  console.log('=== Apakah bentuk naik-turunnya BERULANG di dua tahun? ===')
  console.log('r mendekati 1 = pola tahun ini mirip tahun lalu (musiman nyata)')
  console.log('r sekitar 0   = naik-turunnya acak, tidak bisa diramal dari musim\n')
  console.log('  r     ragam  puncak(th1/th2)  nett 12bln     item')
  for (const h of hasil) {
    console.log(
      `${h.r >= 0 ? ' ' : ''}${h.r.toFixed(2)}   ${h.ragam.toFixed(2)}     ${h.puncak1} / ${h.puncak2}      ` +
        `${(h.nett / 1e9).toFixed(2)} M   ${h.nama}`
    )
  }

  const kuat = hasil.filter((h) => h.r >= 0.5)
  const samaBulan = hasil.filter((h) => h.puncak1 === h.puncak2)
  console.log(`\nItem dengan pola berulang kuat (r >= 0,5) : ${kuat.length} dari ${hasil.length}`)
  console.log(`Item yang puncaknya di bulan yang SAMA     : ${samaBulan.length} dari ${hasil.length}`)
  const rataR = hasil.reduce((a, b) => a + b.r, 0) / hasil.length
  console.log(`Rata-rata korelasi antar tahun            : ${rataR.toFixed(2)}`)

  await pool.end()
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
