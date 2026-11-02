/**
 * Pemeriksaan LANGSUNG ke `public.v_sample_tracker`. Bukan unit test, tidak ikut
 * `npm test`, butuh jaringan internal the company.
 *
 * Jalankan setelah menyentuh `src/main/lab/**` atau `tools/lab-tools.ts`:
 *   npx tsx tests/lab-live-check.ts
 *
 * Yang dibuktikan di sini adalah hal-hal yang TIDAK BISA dibuktikan unit test,
 * karena jawabannya ada di datanya sendiri: apakah jangkar umur benar-benar
 * menyelamatkan baris yang tanpanya hilang, apakah tahap ber-jam benar-benar
 * menghasilkan angka negatif, apakah backlog tidak menghitung yang batal.
 */
import 'dotenv/config'
import { Client } from 'pg'
import { JANGKAR_UMUR, TAHAPAN, ekspresiLama, tahapDari } from '../src/main/lab/rules'

const VIEW = 'public.v_sample_tracker'
const masalah: string[] = []
let no = 0

function periksa(judul: string, lolos: boolean, detail: string): void {
  no++
  console.log(`${lolos ? 'OK   ' : 'GAGAL'} ${no}. ${judul}`)
  console.log(`        ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

async function main(): Promise<void> {
  const conn = process.env.AIRA_SALES_DB
  if (!conn) throw new Error('AIRA_SALES_DB tidak ada di .env')
  const db = new Client({ connectionString: conn, statement_timeout: 180_000 })
  await db.connect()
  const satu = async (sql: string): Promise<Record<string, string | null>> =>
    (await db.query(sql)).rows[0] ?? {}

  // 1. View-nya masih ada, dan kolom yang dipakai belum berubah nama.
  const kolom = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='v_sample_tracker'`
  )
  const ada = new Set(kolom.rows.map((r) => r.column_name))
  const wajib = [
    'order_id', 'category', 'test', 'account', 'sample_status', 'is_rns',
    'rns_at', 'new_sample_received_date', 'canceled_at', 'date_result',
    'lab_sample_received_at', 'order_validated_at', 'order_created_at', 'last_updated_at'
  ]
  const hilang = wajib.filter((k) => !ada.has(k))
  periksa('semua kolom yang dipakai tool masih ada di view', hilang.length === 0,
    hilang.length ? `HILANG: ${hilang.join(', ')}` : `${wajib.length} kolom terverifikasi`)

  // 2. ⚠️ `patient` MASIH ADA di view — justru itu sebabnya daftar-izin kolom
  //    diperlukan. Kalau kolomnya hilang, daftar-izin jadi tidak relevan dan
  //    aturannya perlu ditinjau ulang, bukan didiamkan.
  periksa('kolom patient masih ada di view (alasan daftar-izin kolom tetap berlaku)',
    ada.has('patient'),
    ada.has('patient') ? 'ada — tool WAJIB tetap tidak mengambilnya' : 'sudah tidak ada, tinjau ulang aturan')

  // 3. order_validated_at masih selalu tengah malam?
  const jam = await satu(
    `SELECT count(*) FILTER (WHERE order_validated_at::time <> '00:00:00')::text AS berjam,
            count(*)::text AS total FROM ${VIEW} WHERE order_validated_at IS NOT NULL`)
  periksa('order_validated_at tidak menyimpan jam (dasar aturan "hitung dalam hari")',
    Number(jam.berjam) === 0,
    `${jam.berjam} dari ${jam.total} baris punya jam bukan 00:00`)

  // 4. Bukti bahwa menghitungnya dalam JAM memang menghasilkan angka negatif.
  const negatif = await satu(
    `SELECT count(*) FILTER (WHERE order_validated_at < order_created_at)::text AS n,
            count(*)::text AS total FROM ${VIEW}`)
  const rasio = (Number(negatif.n) / Math.max(1, Number(negatif.total))) * 100
  periksa('selisih mentah order->validasi memang negatif untuk sebagian besar baris',
    Number(negatif.n) > 0,
    `${negatif.n} dari ${negatif.total} (${rasio.toFixed(1)}%) — inilah yang dicegah aturan ketelitian "hari"`)

  // 5. Ekspresi yang DIPAKAI tool tidak boleh menghasilkan negatif.
  const tahapValidasi = tahapDari('order_ke_validasi')!
  const pakai = await satu(
    `SELECT count(*) FILTER (WHERE ${ekspresiLama(tahapValidasi)} < 0)::text AS n
       FROM ${VIEW}
      WHERE ${tahapValidasi.dari} IS NOT NULL AND ${tahapValidasi.ke} IS NOT NULL`)
  periksa('ekspresi yang dipakai tool TIDAK menghasilkan lama negatif',
    Number(pakai.n) === 0,
    `${pakai.n} baris negatif (harus 0)`)

  // 6. Jangkar berjenjang menyelamatkan baris yang tanpanya hilang diam-diam.
  const jangkar = await satu(
    `SELECT count(*) FILTER (WHERE lab_sample_received_at IS NULL)::text AS tanpa_terima,
            count(*) FILTER (WHERE ${JANGKAR_UMUR} IS NULL)::text AS tanpa_jangkar,
            count(*)::text AS total
       FROM ${VIEW} WHERE canceled_at IS NULL AND date_result IS NULL`)
  periksa('jangkar berjenjang menutup baris yang belum diterima lab',
    Number(jangkar.tanpa_jangkar) === 0 && Number(jangkar.tanpa_terima) > 0,
    `${jangkar.tanpa_terima} baris backlog belum diterima lab; dengan jangkar berjenjang yang tanpa umur tinggal ${jangkar.tanpa_jangkar} dari ${jangkar.total}`)

  // 7. Backlog tidak boleh memuat yang batal atau yang hasilnya sudah keluar.
  const bl = await satu(
    `SELECT count(*) FILTER (WHERE canceled_at IS NOT NULL)::text AS batal,
            count(*) FILTER (WHERE date_result IS NOT NULL)::text AS sudah_keluar
       FROM ${VIEW} WHERE canceled_at IS NULL AND date_result IS NULL`)
  periksa('backlog bersih dari sampel batal & yang sudah keluar hasilnya',
    Number(bl.batal) === 0 && Number(bl.sudah_keluar) === 0,
    `batal=${bl.batal} sudah_keluar=${bl.sudah_keluar} (dua-duanya harus 0)`)

  // 8. Dasar pengakuan memang berdampak — kalau tidak, klausanya sia-sia.
  const dampak = await satu(
    `SELECT count(*)::text AS tanpa_filter,
            count(*) FILTER (WHERE canceled_at IS NULL)::text AS dengan_filter
       FROM ${VIEW} WHERE date_result IS NULL`)
  const selisih = Number(dampak.tanpa_filter) - Number(dampak.dengan_filter)
  periksa('mengecualikan sampel batal benar-benar mengubah angka backlog',
    selisih > 0,
    `tanpa filter ${dampak.tanpa_filter}, dengan filter ${dampak.dengan_filter} — selisih ${selisih} baris`)

  // 9. RNS: pastikan ketiga golongan masih terpisah dan jumlahnya masuk akal.
  const rns = await satu(
    `SELECT count(*)::text AS total,
            count(new_sample_received_date)::text AS pengganti,
            count(*) FILTER (WHERE new_sample_received_date IS NULL
                               AND canceled_at IS NULL AND date_result IS NULL)::text AS menunggu
       FROM ${VIEW} WHERE is_rns = true`)
  periksa('RNS terbagi wajar, dan "masih menunggu" bukan nol',
    Number(rns.total) > 0 && Number(rns.menunggu) > 0,
    `total ${rns.total}, pengganti datang ${rns.pengganti}, masih menunggu ${rns.menunggu}`)

  // 10. rns_at hanya terisi saat is_rns — kalau tidak, penandanya tidak bisa dipercaya.
  const konsisten = await satu(
    `SELECT count(*) FILTER (WHERE is_rns = false AND rns_at IS NOT NULL)::text AS aneh_a,
            count(*) FILTER (WHERE is_rns = true AND rns_at IS NULL)::text AS aneh_b
       FROM ${VIEW}`)
  periksa('is_rns dan rns_at konsisten satu sama lain',
    Number(konsisten.aneh_a) === 0 && Number(konsisten.aneh_b) === 0,
    `is_rns=false tapi ada rns_at: ${konsisten.aneh_a}; is_rns=true tapi rns_at kosong: ${konsisten.aneh_b}`)

  // 11. Tahap patologi memang tidak universal — dasar catatan anti-salah-baca.
  // ⚠️ 29 Sep 2026: kolom pathology_completed_at DIKELUARKAN dari view oleh
  // pengelola ETL. AIRA sekarang melewati tahap itu dan menyebutnya (lab/tracker.ts
  // `kolomView`). Pemeriksaan ini melaporkan keadaannya, bukan crash.
  const kolomPat = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_sample_tracker' AND column_name='pathology_completed_at'`)
  if (kolomPat.rowCount === 0) {
    console.log('INFO kolom pathology_completed_at TIDAK ada di view — tahap patologi dilewati AIRA dan disebut ke user')
  } else {
    const pat = await db.query<{ category: string; total: string; ada: string }>(
      `SELECT category, count(*)::text AS total, count(pathology_completed_at)::text AS ada
         FROM ${VIEW} GROUP BY 1 ORDER BY 2 DESC`)
    const adaKategoriNol = pat.rows.some((r) => Number(r.ada) === 0)
    periksa('tahap patologi terbukti tidak berlaku untuk semua kategori',
      adaKategoriNol,
      pat.rows.map((r) => `${r.category} ${r.ada}/${r.total}`).join(' · '))
  }

  // 12. TAT total masih di kisaran yang diklaim ke user.
  const tatRows = await db.query<{ category: string; n: string; median: string }>(
    `SELECT category, count(*)::text AS n,
            round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY ${ekspresiLama(tahapDari('total')!)})::numeric, 1)::text AS median
       FROM ${VIEW}
      WHERE canceled_at IS NULL AND date_result IS NOT NULL AND lab_sample_received_at IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`)
  const wajar = tatRows.rows.every((r) => Number(r.median) >= 0 && Number(r.median) < 60)
  periksa('TAT total per kategori masih wajar (0–60 hari)', wajar,
    tatRows.rows.map((r) => `${r.category} median ${r.median} hari (n=${r.n})`).join(' · '))

  // 13. Order dibedakan dari baris — pastikan selisihnya memang ada.
  const oc = await satu(
    `SELECT count(*)::text AS baris, count(DISTINCT order_id)::text AS "order" FROM ${VIEW}`)
  periksa('jumlah order berbeda dari jumlah baris (wajib dibedakan di jawaban)',
    Number(oc.order) < Number(oc.baris),
    `${oc.order} order untuk ${oc.baris} baris pemeriksaan`)

  // 14. Kesegaran data terbaca — dipakai catatan "data per ...".
  const segar = await satu(
    `SELECT to_char(max(last_updated_at), 'YYYY-MM-DD HH24:MI') AS t FROM ${VIEW}`)
  periksa('waktu pembaruan ETL terbaca', segar.t !== null, `terakhir diperbarui ${segar.t}`)

  // 15. Semua tahap yang terdaftar memakai kolom yang benar-benar ada.
  const tahapSalah = TAHAPAN.filter((t) => !ada.has(t.dari) || !ada.has(t.ke))
  periksa('semua tahap menunjuk kolom yang ada di view', tahapSalah.length === 0,
    tahapSalah.length ? tahapSalah.map((t) => t.kode).join(', ') : `${TAHAPAN.length} tahap terverifikasi`)

  await db.end()
  console.log('')
  if (masalah.length) {
    console.log(`ADA ${masalah.length} MASALAH:`)
    for (const m of masalah) console.log(`  - ${m}`)
    process.exit(1)
  }
  console.log(`Semua ${no} pemeriksaan lolos.`)
}

main().catch((e) => {
  console.error('GAGAL:', e.message)
  process.exit(1)
})
