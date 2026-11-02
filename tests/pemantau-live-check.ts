// Pemeriksaan SQL pemantau proaktif ke database SUNGGUHAN (bukan unit test — butuh
// jaringan internal the company). Jalankan: npx tsx tests/pemantau-live-check.ts
//
// ⚠️ Memakai SQL ASLI dari `pemantau/sql.ts` (bukan salinan — pelajaran aturan 64).
// Pembandingnya DITULIS TERPISAH: klausa pengakuan diketik literal di sini, bukan
// diambil dari konstanta yang sama, supaya kesalahan di konstanta ikut tertangkap.
// Yang dicetak hanya kategori, tanggal, jumlah, dan waktu — tidak ada baris sampel
// maupun kolom pasien yang keluar dari database.
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import {
  SQL_KATEGORI_BACKLOG,
  SQL_KESEGARAN_SALES,
  SQL_KESEGARAN_TAT,
  SQL_NETT_HARIAN,
  SQL_ORDER_HARIAN,
  SQL_SAMPEL_LEWAT_BATAS
} from '../src/main/pemantau/sql'
import {
  AMBANG_DATA_SALES_JAM,
  AMBANG_DATA_TAT_JAM,
  LAB_JENDELA_HARI,
  LAB_MIN_SELESAI,
  LAB_PERSENTIL,
  LAB_UMUR_MAKS_HARI,
  hariDinilai,
  nilaiSalesAnjlok,
  putuskanSampel,
  tanggalPembanding,
  tidakDipantau,
  umurTanpaMinggu,
  type BarisSampel,
  type KategoriBacklog
} from '../src/main/pemantau/rules'
import { jakartaToday } from '../src/main/sales/periods'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}
const cs = envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

/** Batas waktu satu query pemantau: tiap laptop menjalankannya, database dipakai produksi. */
const BATAS_MS = 5_000
const DIAKUI_SALES = 'transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL'

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs!, max: 1, connectionTimeoutMillis: 15_000 })
  const q = async <T>(sql: string, p: unknown[] = []): Promise<{ rows: T[]; ms: number }> => {
    const t0 = Date.now()
    const rows = (await pool.query(sql, p)).rows as T[]
    return { rows, ms: Date.now() - t0 }
  }
  const cepat = (nama: string, ms: number): void => cek(`${nama} di bawah ${BATAS_MS} ms`, ms < BATAS_MS, `${ms} ms`)

  // 1. Kesegaran SalesRepository = baris BARU terakhir (created_at). Retry bridging ERP
  //    juga menulis updated_at (ukur 20 Okt 2026), jadi updated_at bukan bukti ETL berjalan.
  const s = await q<{ terakhir: string | null; umur_jam: number | null }>(SQL_KESEGARAN_SALES)
  cepat('SQL_KESEGARAN_SALES', s.ms)
  const sp = await q<{ c: string | null; u: string | null }>(
    `SELECT to_char(max(created_at), 'YYYY-MM-DD HH24:MI') AS c, to_char(max(updated_at), 'YYYY-MM-DD HH24:MI') AS u
       FROM public."SalesRepository" WHERE ${DIAKUI_SALES}`
  )
  cek('kesegaran sales = baris baru terakhir (max created_at baris diakui)', s.rows[0].terakhir === sp.rows[0].c,
    `${s.rows[0].terakhir} vs ${sp.rows[0].c}`)
  cek('umur data sales tidak negatif', (s.rows[0].umur_jam ?? -1) >= 0, `${s.rows[0].umur_jam} jam`)

  // Pemeriksaan di atas hanya menangkap regresi ke updated_at/greatest() bila KEBETULAN pembaruan
  // terakhir lebih baru dari insert terakhir. Karena itu SQL ASLI juga dijalankan pada POTONGAN:
  // hanya baris yang dibuat s.d. batas. Tabelnya diganti subquery berkolom waktu saja (tanpa kolom
  // pasien); logika yang diuji tetap milik sql.ts.
  const TABEL = 'public."SalesRepository"'
  cek('SQL kesegaran sales menyebut tabelnya tepat sekali (bisa dipotong)', SQL_KESEGARAN_SALES.split(TABEL).length === 2)
  const potongan = SQL_KESEGARAN_SALES.replace(
    TABEL,
    `(SELECT created_at, updated_at, transfer_test_deleted_at, transaction_transfer_deleted_at
        FROM ${TABEL} WHERE created_at <= $1::timestamp) potongan`
  )
  // a) Batas 7 hari lalu: ribuan baris yang dibuat sebelumnya diperbarui SESUDAHNYA (bridging,
  //    ETL), jadi sinyal yang ikut membaca updated_at pasti melewati batas.
  const b1 = (await q<{ b: string }>(`SELECT to_char(localtimestamp - interval '7 days', 'YYYY-MM-DD HH24:MI:SS') AS b`)).rows[0].b
  const pa = await q<{ terakhir: string | null }>(potongan, [b1])
  const ea = await q<{ c: string | null; lewat: number }>(
    `SELECT to_char(max(created_at), 'YYYY-MM-DD HH24:MI') AS c,
            count(*) FILTER (WHERE updated_at > $1::timestamp)::int AS lewat
       FROM public."SalesRepository" WHERE created_at <= $1::timestamp AND ${DIAKUI_SALES}`,
    [b1]
  )
  cek('potongan 7 hari lalu bermakna: ada baris yang diperbarui sesudah batas', ea.rows[0].lewat > 0, `${ea.rows[0].lewat} baris`)
  cek('kesegaran sales pada potongan 7 hari lalu = baris baru, bukan pembaruan sesudahnya',
    pa.rows[0].terakhir === ea.rows[0].c, `${pa.rows[0].terakhir} vs ${ea.rows[0].c}`)
  // b) Batas = menit terakhir yang SEMUA insert-nya kini dibatalkan transfernya: tanpa
  //    RECOGNIZED_CLAUSE hasilnya menit itu sendiri, dengan klausa menit sebelumnya.
  const mb = await q<{ m: string; b: string }>(
    `SELECT to_char(date_trunc('minute', created_at), 'YYYY-MM-DD HH24:MI') AS m,
            to_char(max(created_at), 'YYYY-MM-DD HH24:MI:SS.US') AS b
       FROM public."SalesRepository" GROUP BY 1 HAVING bool_and(NOT (${DIAKUI_SALES})) ORDER BY 1 DESC LIMIT 1`
  )
  // Bahan tidak ada ≠ lolos (aturan 33): pemeriksaan yang tidak bisa jalan dihitung GAGAL.
  cek('ada menit yang seluruh insert-nya dibatalkan (bahan pemeriksaan klausa)', mb.rows.length === 1, mb.rows[0]?.m ?? 'tidak ada')
  if (mb.rows.length === 1) {
    const pb = await q<{ terakhir: string | null }>(potongan, [mb.rows[0].b])
    const eb = await q<{ c: string | null }>(
      `SELECT to_char(max(created_at), 'YYYY-MM-DD HH24:MI') AS c
         FROM public."SalesRepository" WHERE created_at <= $1::timestamp AND ${DIAKUI_SALES}`,
      [mb.rows[0].b]
    )
    cek(`kesegaran sales pada potongan s.d. ${mb.rows[0].m} (insert dibatalkan saja) = baris DIAKUI terakhir`,
      pb.rows[0].terakhir === eb.rows[0].c && pb.rows[0].terakhir !== mb.rows[0].m,
      `${pb.rows[0].terakhir} vs ${eb.rows[0].c}`)
  }

  // 2. Kesegaran view TAT
  const tt = await q<{ terakhir: string | null; umur_jam: number | null; waktu_db: Date }>(SQL_KESEGARAN_TAT)
  cepat('SQL_KESEGARAN_TAT', tt.ms)
  const tp = await q<{ t: string | null }>(
    `SELECT to_char(max(last_updated_at), 'YYYY-MM-DD HH24:MI') AS t FROM public.v_sample_tracker`
  )
  cek('kesegaran TAT = max(last_updated_at)', tt.rows[0].terakhir === tp.rows[0].t, `${tt.rows[0].terakhir} vs ${tp.rows[0].t}`)
  cek('waktu_db berupa Date', tt.rows[0].waktu_db instanceof Date)
  const waktuDb = tt.rows[0].waktu_db
  const akhir = waktuDb.toISOString()
  const awal = new Date(waktuDb.getTime() - 7 * 86_400_000).toISOString()

  // 3. Nett & order harian — hari yang dinilai + 4 pembanding
  const D = hariDinilai(jakartaToday())
  const tanggal = [D, ...tanggalPembanding(D)]
  const n = await q<{ tgl: string; nett: number }>(SQL_NETT_HARIAN, [tanggal])
  cepat('SQL_NETT_HARIAN', n.ms)
  const o = await q<{ tgl: string; order: number }>(SQL_ORDER_HARIAN, [tanggal])
  cepat('SQL_ORDER_HARIAN', o.ms)
  for (const d of tanggal) {
    const pn = await q<{ v: number }>(
      `SELECT coalesce(sum(nett_sales), 0)::float8 AS v FROM public."SalesRepository"
        WHERE date_result = $1::date AND ${DIAKUI_SALES}`,
      [d]
    )
    const asliN = n.rows.find((r) => r.tgl === d)?.nett ?? 0
    cek(`nett ${d} = jumlah pembanding`, Math.abs(asliN - pn.rows[0].v) < 0.5, `${asliN} vs ${pn.rows[0].v}`)
    const po = await q<{ v: number }>(
      `SELECT count(DISTINCT order_id)::int AS v FROM public."SalesRepository"
        WHERE date_received = $1::date AND ${DIAKUI_SALES}`,
      [d]
    )
    const asliO = o.rows.find((r) => r.tgl === d)?.order ?? 0
    cek(`order ${d} = hitungan pembanding`, asliO === po.rows[0].v, `${asliO} vs ${po.rows[0].v}`)
  }

  // 4. Sampel melewati batas — batas & hitungan dihitung ulang terpisah per kategori
  const sm = await q<BarisSampel>(SQL_SAMPEL_LEWAT_BATAS, [awal, akhir])
  cepat('SQL_SAMPEL_LEWAT_BATAS', sm.ms)
  const p90 = await q<{ category: string; hari: number; n: number }>(
    `SELECT category,
            percentile_cont(${LAB_PERSENTIL}) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (date_result - lab_sample_received_at)) / 86400.0)::float8 AS hari,
            count(*)::int AS n
       FROM public.v_sample_tracker
      WHERE canceled_at IS NULL AND date_result IS NOT NULL AND lab_sample_received_at IS NOT NULL
        AND date_result >= $1::timestamptz - interval '${LAB_JENDELA_HARI} days'
      GROUP BY category`,
    [akhir]
  )
  const batas = new Map(p90.rows.filter((r) => r.n >= LAB_MIN_SELESAI).map((r) => [r.category, r.hari]))
  cek('kategori terpantau = kategori ber-riwayat cukup',
    JSON.stringify([...batas.keys()].sort()) === JSON.stringify(sm.rows.map((r) => r.category).sort()),
    sm.rows.map((r) => r.category).join(', '))
  for (const r of sm.rows) {
    const h = batas.get(r.category)
    cek(`batas ${r.category} = p${Math.round(LAB_PERSENTIL * 100)} pembanding`,
      h !== undefined && Math.round(h * 10) / 10 === r.batas_hari, `${r.batas_hari} vs ${h}`)
    const hit = await q<{ terlambat: number; baru: number }>(
      `SELECT count(*) FILTER (WHERE lab_sample_received_at + $2::float8 * interval '1 day' <= $4::timestamptz)::int AS terlambat,
              count(*) FILTER (WHERE lab_sample_received_at + $2::float8 * interval '1 day' > $3::timestamptz
                                 AND lab_sample_received_at + $2::float8 * interval '1 day' <= $4::timestamptz)::int AS baru
         FROM public.v_sample_tracker
        WHERE category = $1 AND canceled_at IS NULL AND date_result IS NULL AND lab_sample_received_at IS NOT NULL
          AND lab_sample_received_at >= $4::timestamptz - interval '${LAB_UMUR_MAKS_HARI} days'`,
      [r.category, h, awal, akhir]
    )
    cek(`terlambat ${r.category} = hitungan pembanding`, hit.rows[0].terlambat === r.terlambat,
      `${r.terlambat} vs ${hit.rows[0].terlambat}`)
    cek(`baru ${r.category} (7 hari) = hitungan pembanding`, hit.rows[0].baru === r.baru, `${r.baru} vs ${hit.rows[0].baru}`)
  }

  // 5. Kategori backlog (bahan daftar "tidak dipantau")
  const kb = await q<KategoriBacklog>(SQL_KATEGORI_BACKLOG, [akhir])
  cepat('SQL_KATEGORI_BACKLOG', kb.ms)
  const kp = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.v_sample_tracker
      WHERE canceled_at IS NULL AND date_result IS NULL
        AND COALESCE(lab_sample_received_at, order_validated_at, order_created_at) >= $1::timestamptz - interval '${LAB_UMUR_MAKS_HARI} days'`,
    [akhir]
  )
  const jumlahBacklog = kb.rows.reduce((t, r) => t + r.backlog, 0)
  cek(`jumlah backlog ≤ ${LAB_UMUR_MAKS_HARI} hari = hitungan pembanding`, jumlahBacklog === kp.rows[0].n,
    `${jumlahBacklog} vs ${kp.rows[0].n}`)

  // 6. Penilaian hari ini — dicetak, tidak menggagalkan (keadaan data, bukan benar/salah kode)
  const rekam = <T extends { tgl: string }>(rows: T[], kunci: keyof T): Record<string, number> =>
    Object.fromEntries(rows.map((r) => [r.tgl, Number(r[kunci])]))
  const p = nilaiSalesAnjlok(D, rekam(n.rows, 'nett'), rekam(o.rows, 'order'))
  const dinilai = umurTanpaMinggu({ terakhir: s.rows[0].terakhir, umurJam: s.rows[0].umur_jam })
  console.log(`\nINFO baris baru Sales terakhir ${s.rows[0].terakhir} (${s.rows[0].umur_jam} jam; dinilai tanpa jam Minggu ` +
    `${dinilai} jam; macet bila > ${AMBANG_DATA_SALES_JAM}) — pembaruan terakhir, termasuk bridging: ${sp.rows[0].u}`)
  console.log(`INFO data TAT terakhir ${tt.rows[0].terakhir} (${tt.rows[0].umur_jam} jam; macet bila > ${AMBANG_DATA_TAT_JAM})`)
  console.log(`INFO sales ${D}: ${p.hasil}, nett ${p.rasioNett === null ? '-' : Math.round(p.rasioNett * 100)}% / order ` +
    `${p.rasioOrder === null ? '-' : Math.round(p.rasioOrder * 100)}% dari biasanya`)
  const ps = putuskanSampel(sm.rows, true)
  console.log(`INFO sampel (relatif waktu database; data TAT bisa basi): terlambat ${ps.terlambat}, ` +
    `baru 7 hari ${sm.rows.reduce((t, r) => t + r.baru, 0)} — ` +
    sm.rows.map((r) => `${r.category} ${r.terlambat} (> ${r.batas_hari} hari)`).join(', '))
  console.log(`INFO tidak dipantau: ${tidakDipantau(kb.rows, sm.rows.map((r) => r.category)).join(', ') || '-'}`)

  await pool.end()
  console.log(`\n${gagal === 0 ? 'SEMUA OK' : `${gagal} GAGAL`}`)
  if (gagal > 0) process.exit(1)
}

main().catch((err) => {
  console.error('GAGAL menjalankan live-check:', String(err))
  process.exit(1)
})
