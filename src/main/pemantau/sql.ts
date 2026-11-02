// SQL pemantau proaktif — KONSTAN dan BACA-SAJA. Disusun dari klausa yang sudah
// dipakai tool sales & lab (bukan salinan), supaya pemantau tidak bisa menghitung
// baris yang ditolak tool, dan dieksekusi lewat `salesQuery` (pool `max: 1`).
//
// ⚠️ Modul MURNI (tanpa Electron/logger) dengan sengaja: live-check menjalankan SQL
// ASLI dari sini. Live-check yang memakai salinan SQL tertinggal diam-diam saat
// aslinya berubah — dan tetap hijau sambil menguji sesuatu yang tidak dipakai
// (pelajaran aturan 64). Pola yang sama dengan `sales/order-status.ts`.

import { RECOGNIZED_CLAUSE } from '../sales/recognition'
import { BACKLOG_CLAUSE, DIAKUI_CLAUSE, JANGKAR_UMUR } from '../lab/rules'
import { LAB_JENDELA_HARI, LAB_MIN_SELESAI, LAB_PERSENTIL, LAB_UMUR_MAKS_HARI } from './rules'

/**
 * Kolom SalesRepository yang boleh disentuh pemantau — test memeriksa SQL tidak menyebut kolom lain.
 * `updated_at` sengaja TIDAK ada: ia juga ditulis retry bridging ERP (lihat SQL_KESEGARAN_SALES).
 */
export const KOLOM_SALES_DIBACA = [
  'created_at',
  'date_result',
  'date_received',
  'nett_sales',
  'order_id',
  'transfer_test_deleted_at',
  'transaction_transfer_deleted_at'
] as const

/**
 * Baris BARU terakhir di SalesRepository (= ETL masih memasukkan data) + umurnya. Umur
 * dihitung `now()` DATABASE — jam laptop yang meleset tidak boleh membuat data tampak
 * macet (atau tampak segar).
 *
 * ⚠️ `created_at`, BUKAN `updated_at` (ukur 20 Okt 2026, RANCANGAN-PEMANTAU §4.1).
 * `created_at` = DEFAULT database, hanya terisi saat INSERT. `updated_at` tanpa default
 * maupun trigger — ditulis ETL DAN job bridging ERP di SETIAP percobaan (sukses =
 * `bridged_at_*`, gagal ≈ `bridging_started_at_*`), dan baris gagal dicoba ulang tiap hari
 * job itu jalan. Dengan `max(updated_at)` ETL yang berhenti tidak terdeteksi, dan syarat
 * "sinkronisasi sesudah D" pemicu sales kemarin ikut lolos.
 */
export const SQL_KESEGARAN_SALES = `
SELECT to_char(t, 'YYYY-MM-DD HH24:MI') AS terakhir,
       round((EXTRACT(EPOCH FROM (now() - t)) / 3600.0)::numeric, 1)::float8 AS umur_jam
  FROM (SELECT max(created_at) AS t
          FROM public."SalesRepository" WHERE 1 = 1${RECOGNIZED_CLAUSE}) s`

/**
 * Kesegaran view TAT — kolom yang SAMA dengan `terakhirDiperbarui()` milik tool lab,
 * jadi pemantau dan jawaban AIRA menyebut waktu yang sama. `waktu_db` = SATU titik
 * waktu database untuk seluruh pemeriksaan sampel di putaran itu.
 */
export const SQL_KESEGARAN_TAT = `
SELECT to_char(t, 'YYYY-MM-DD HH24:MI') AS terakhir,
       round((EXTRACT(EPOCH FROM (now() - t)) / 3600.0)::numeric, 1)::float8 AS umur_jam,
       now() AS waktu_db
  FROM (SELECT max(last_updated_at) AS t FROM public.v_sample_tracker) s`

/**
 * Sampel yang melewati batas wajar kategorinya. `$1` = awal jendela (penanda
 * sebelumnya), `$2` = akhir jendela (`waktu_db`) — keduanya string ISO.
 *
 * - batas = persentil lama terima-lab → hasil dari sampel SELESAI dalam jendela
 *   riwayat, hanya kategori dengan cukup riwayat (PK/MB/Genme otomatis tidak ikut);
 * - hanya sampel yang SUDAH diterima lab: sebelum itu sampelnya memang belum di lab;
 * - `baru` = titik lewat-batasnya jatuh di ($1, $2] — jendela berurutan tanpa celah
 *   dan tanpa tumpang tindih antar pemeriksaan.
 */
export const SQL_SAMPEL_LEWAT_BATAS = `
WITH batas AS (
  SELECT category,
         percentile_cont(${LAB_PERSENTIL}) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (date_result - lab_sample_received_at)) / 86400.0) AS hari
    FROM public.v_sample_tracker
   WHERE ${DIAKUI_CLAUSE} AND date_result IS NOT NULL AND lab_sample_received_at IS NOT NULL
     AND date_result >= $2::timestamptz - interval '${LAB_JENDELA_HARI} days'
   GROUP BY category HAVING count(*) >= ${LAB_MIN_SELESAI}
), bl AS (
  SELECT category, lab_sample_received_at AS terima
    FROM public.v_sample_tracker
   WHERE ${BACKLOG_CLAUSE} AND lab_sample_received_at IS NOT NULL
     AND lab_sample_received_at >= $2::timestamptz - interval '${LAB_UMUR_MAKS_HARI} days'
)
SELECT b.category, round(b.hari::numeric, 1)::float8 AS batas_hari,
       count(bl.terima) FILTER (WHERE bl.terima + b.hari * interval '1 day' <= $2::timestamptz)::int AS terlambat,
       count(bl.terima) FILTER (WHERE bl.terima + b.hari * interval '1 day' >  $1::timestamptz
                                  AND bl.terima + b.hari * interval '1 day' <= $2::timestamptz)::int AS baru
  FROM batas b LEFT JOIN bl ON bl.category = b.category
 GROUP BY b.category, b.hari ORDER BY b.category`

/**
 * Kategori yang punya backlog ≤ LAB_UMUR_MAKS_HARI (jangkar berjenjang, aturan 34b)
 * + berapa yang sudah diterima lab — bahan daftar "tidak dipantau". `$1` = waktu_db.
 */
export const SQL_KATEGORI_BACKLOG = `
SELECT category,
       count(*) FILTER (WHERE lab_sample_received_at IS NOT NULL)::int AS di_lab,
       count(*)::int AS backlog
  FROM public.v_sample_tracker
 WHERE ${BACKLOG_CLAUSE} AND ${JANGKAR_UMUR} >= $1::timestamptz - interval '${LAB_UMUR_MAKS_HARI} days'
 GROUP BY category ORDER BY category`

/** Nett per tanggal hasil (basis INVOICE, aturan 4) untuk `$1::date[]`. */
export const SQL_NETT_HARIAN = `
SELECT to_char(date_result, 'YYYY-MM-DD') AS tgl, coalesce(sum(nett_sales), 0)::float8 AS nett
  FROM public."SalesRepository"
 WHERE date_result = ANY($1::date[])${RECOGNIZED_CLAUSE}
 GROUP BY 1`

/** Order masuk (order_id unik) per tanggal terima untuk `$1::date[]` — penanda hari libur. */
export const SQL_ORDER_HARIAN = `
SELECT to_char(date_received, 'YYYY-MM-DD') AS tgl, count(DISTINCT order_id)::int AS "order"
  FROM public."SalesRepository"
 WHERE date_received = ANY($1::date[])${RECOGNIZED_CLAUSE}
 GROUP BY 1`
