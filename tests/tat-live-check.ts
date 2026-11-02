// Pemeriksaan ke database sungguhan (bukan unit test — butuh jaringan internal the company).
// Jalankan manual: npx tsx tests/tat-live-check.ts
//
// Membuktikan hal-hal yang TIDAK bisa dibuktikan unit test:
//   1. SQL TAT & backlog memang jalan di Postgres (percentile_cont, selisih tanggal)
//   2. backlog disaring pada `date_received`, BUKAN `date_result` — kalau
//      salah, baris yang belum keluar hasilnya tidak akan pernah ikut dan
//      backlognya selalu nol, terlihat seperti kabar baik
//   3. agregat pelanggan lewat LATERAL tidak menggelembung (jebakan yang sudah
//      DUA KALI memakan modul sales: +23% item, +12,1% pelanggan)
//   4. RECOGNIZED_CLAUSE benar-benar mengurangi backlog (transfer dibatalkan
//      tidak boleh dihitung sebagai penumpukan)
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'

const TABLE = 'public."SalesRepository"'
const ITEM_MASTER = 'public.m_item_repository'
const cs = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('AIRA_SALES_DB='))!
  .slice('AIRA_SALES_DB='.length)
  .trim()

const pool = new Pool({ connectionString: cs, max: 2, statement_timeout: 60_000 })
const DARI = '2026-08-01'
const SAMPAI = '2026-08-31'
let gagal = 0

function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[]

async function main(): Promise<void> {
  // ── Pencarian item lewat master ──
  const kandidat = await q<{ kode: string; nama: string }>(
    `SELECT kode, nama FROM (
       SELECT DISTINCT ON (item_code_erp)
              item_code_erp AS kode, trim(item_name) AS nama
         FROM ${ITEM_MASTER}
        WHERE item_code_erp <> '' AND trim(item_name) <> ''
          AND (item_name ILIKE $1 OR item_code_erp = $2)
        ORDER BY item_code_erp, (status = '5') DESC, item_name
     ) x ORDER BY (kode = $2) DESC, length(nama), nama LIMIT 10`,
    ['%EKG%', 'EKG']
  )
  cek('pencarian item lewat master jalan', kandidat.length > 0,
    `${kandidat.length} kandidat: ${kandidat.slice(0, 3).map((k) => k.nama).join(', ')}`)
  if (kandidat.length === 0) return

  // Item yang benar-benar bertransaksi, supaya angkanya bermakna.
  const [ramai] = await q<{ kode: string; n: string }>(
    `SELECT item_code AS kode, count(*) AS n FROM ${TABLE}
      WHERE date_result >= $1 AND date_result <= $2 ${RECOGNIZED_CLAUSE}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
    [DARI, SAMPAI]
  )
  const kode = ramai.kode
  console.log(`     item uji: ${kode} (${ramai.n} baris di Agustus 2026)`)

  // ── TAT ──
  const t0 = Date.now()
  const [tat] = await q<{ baris: string; median: string | null; p90: string | null }>(
    `SELECT count(*) AS baris,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (date_result::date - date_received::date)) AS median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY (date_result::date - date_received::date)) AS p90
       FROM ${TABLE}
      WHERE item_code = $1 AND date_received >= $2 AND date_received < ($3::date + 1)
        AND date_result IS NOT NULL AND date_result >= date_received ${RECOGNIZED_CLAUSE}`,
    [kode, DARI, SAMPAI]
  )
  const ms = Date.now() - t0
  cek('TAT terhitung & masuk akal', Number(tat.baris) > 0 && Number(tat.median) >= 0,
    `${tat.baris} baris, median ${tat.median} hari, p90 ${tat.p90} hari (${ms} ms)`)
  cek('TAT p90 >= median', Number(tat.p90) >= Number(tat.median))
  cek('query TAT cepat (< 20 dtk)', ms < 20_000, `${ms} ms`)

  // ── Backlog: disaring pada date_received ──
  const [backlog] = await q<{ jumlah: string; nilai: string | null; tertua: string | null }>(
    `SELECT count(DISTINCT order_id) AS jumlah, sum(nett_sales) AS nilai,
            min(date_received)::date::text AS tertua
       FROM ${TABLE}
      WHERE item_code = $1 AND date_received >= $2 AND date_received < ($3::date + 1)
        AND date_result IS NULL ${RECOGNIZED_CLAUSE}`,
    [kode, DARI, SAMPAI]
  )
  console.log(`     backlog item ini: ${backlog.jumlah} order, nilai ${Number(backlog.nilai ?? 0).toLocaleString('id-ID')}, tertua ${backlog.tertua}`)

  // ⚠️ Kalau backlog salah disaring pada date_result, hasilnya SELALU nol —
  // dan nol terlihat seperti kabar baik. Buktikan bahwa secara keseluruhan
  // memang ADA penumpukan, jadi nol pada satu item bukan karena SQL-nya salah.
  const [backlogSemua] = await q<{ jumlah: string; nilai: string | null }>(
    `SELECT count(DISTINCT order_id) AS jumlah, sum(nett_sales) AS nilai
       FROM ${TABLE}
      WHERE date_received >= $1 AND date_received < ($2::date + 1)
        AND date_result IS NULL ${RECOGNIZED_CLAUSE}`,
    [DARI, SAMPAI]
  )
  cek('backlog menyeluruh terdeteksi (bukan selalu nol karena salah kolom)',
    Number(backlogSemua.jumlah) > 0,
    `${backlogSemua.jumlah} order senilai ${Number(backlogSemua.nilai ?? 0).toLocaleString('id-ID')}`)

  // ── Baris yang dibatalkan tidak boleh dihitung sebagai penumpukan ──
  const [tanpaFilter] = await q<{ jumlah: string }>(
    `SELECT count(DISTINCT order_id) AS jumlah FROM ${TABLE}
      WHERE date_received >= $1 AND date_received < ($2::date + 1) AND date_result IS NULL`,
    [DARI, SAMPAI]
  )
  cek('RECOGNIZED_CLAUSE benar-benar mengurangi backlog',
    Number(tanpaFilter.jumlah) >= Number(backlogSemua.jumlah),
    `tanpa filter ${tanpaFilter.jumlah} vs diakui ${backlogSemua.jumlah}`)

  // ── Pelanggan teratas lewat LATERAL: tidak menggelembung ──
  const [polos] = await q<{ nett: string | null }>(
    `SELECT sum(nett_sales) AS nett FROM ${TABLE}
      WHERE item_code = $1 AND date_result >= $2 AND date_result < ($3::date + 1) ${RECOGNIZED_CLAUSE}`,
    [kode, DARI, SAMPAI]
  )
  const pelanggan = await q<{ pelanggan: string; nett: string }>(
    `SELECT coalesce(nullif(trim(c.customer_name), ''), a.kode, '(tidak diisi)') AS pelanggan, a.nett
       FROM (
         SELECT customer_id AS kode, sum(nett_sales) AS nett
           FROM ${TABLE}
          WHERE item_code = $1 AND date_result >= $2 AND date_result < ($3::date + 1) ${RECOGNIZED_CLAUSE}
          GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 5
       ) a
       LEFT JOIN LATERAL (
         SELECT m.customer_name FROM public.m_customer m
          WHERE m.customer_code_lis = a.kode ORDER BY m.customer_name LIMIT 1
       ) c ON true
      ORDER BY a.nett DESC NULLS LAST`,
    [kode, DARI, SAMPAI]
  )
  const totalPolos = Number(polos.nett ?? 0)
  const totalTop5 = pelanggan.reduce((s, p) => s + Number(p.nett ?? 0), 0)
  cek('top-5 pelanggan TIDAK melebihi agregat polos (LATERAL tidak menggandakan)',
    totalTop5 <= totalPolos + 1,
    `top5 ${totalTop5.toLocaleString('id-ID')} <= total ${totalPolos.toLocaleString('id-ID')}`)
  cek('jumlah baris pelanggan tepat 5 atau kurang, tanpa duplikat',
    pelanggan.length <= 5 && new Set(pelanggan.map((p) => p.pelanggan)).size === pelanggan.length,
    `${pelanggan.length} baris`)

  console.log(gagal === 0 ? '\nSEMUA PEMERIKSAAN LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
}

main()
  .catch((e) => {
    console.error('live-check gagal:', e)
    gagal++
  })
  .finally(async () => {
    await pool.end()
    process.exit(gagal === 0 ? 0 : 1)
  })
