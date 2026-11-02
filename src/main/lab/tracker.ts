// Query ke `public.v_sample_tracker` — perjalanan sampel dari order sampai
// hasil keluar. SQL ditulis manusia; model hanya mengisi parameter (§2).
//
// Database SAMA dengan tool sales (`DB-REPOSITORY`), jadi memakai `salesQuery`
// yang sudah punya pool `max: 1`, keepAlive, dan pengulangan khusus kegagalan
// koneksi. Jangan membuat pool baru di sini — aturan project: JANGAN membuka
// beberapa koneksi database bersamaan dari main process.

import { salesQuery } from '../sales/db'
import {
  BACKLOG_CLAUSE,
  DIAKUI_CLAUSE,
  JANGKAR_UMUR,
  MIN_VOLUME_PERSEN,
  TAHAPAN,
  ekspresiLama,
  type Tahap,
  type UrutRns
} from './rules'

const VIEW = 'public.v_sample_tracker'

/*
 * Kolom yang BENAR-BENAR ada di view saat ini (29 Sep 2026).
 *
 * ⚠️ Terjadi nyata: pengelola ETL mengeluarkan `pathology_completed_at` dari
 * view (kolomnya masih ada di tabel `t_sample_tracker`), dan SETIAP pelacakan
 * Order ID gagal total dengan `column … does not exist` — lalu model menyebutnya
 * "kendala teknis, coba lagi nanti". Satu kolom yang hilang tidak boleh
 * mematikan seluruh pelacakan: tahap yang kolomnya tidak ada DILEWATI dan
 * DISEBUT, bukan diam-diam dianggap belum terjadi.
 *
 * View tetap satu-satunya pintu (bukan tabel mentah) — itu antarmuka yang
 * disediakan pemilik data. Daftar dibaca ulang tiap jam: view bisa berubah lagi.
 */
const UMUR_CACHE_KOLOM_MS = 60 * 60_000
let cacheKolom: { kolom: Set<string>; waktu: number } | null = null

export async function kolomView(): Promise<Set<string>> {
  if (cacheKolom && Date.now() - cacheKolom.waktu < UMUR_CACHE_KOLOM_MS) return cacheKolom.kolom
  const rows = await salesQuery<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_sample_tracker'`,
    []
  )
  cacheKolom = { kolom: new Set(rows.map((r) => r.column_name)), waktu: Date.now() }
  return cacheKolom.kolom
}

/** Label tahap jejak yang kolomnya TIDAK ada di view saat ini. */
export async function jejakTakTersedia(): Promise<string[]> {
  const ada = await kolomView()
  return URUTAN.filter((u) => !ada.has(u.kolom)).map((u) => u.label)
}

/** Saringan yang dipakai bersama seluruh tool lab. */
export interface Saringan {
  /** Rentang tanggal pada `order_created_at`. Kosong = seluruh data. */
  dari?: string
  sampai?: string
  category?: string
  test?: string
  account?: string
}

interface Terbangun {
  where: string
  params: unknown[]
}

function bangun(f: Saringan, dasar: string, mulai = 1): Terbangun {
  const bagian = [dasar]
  const params: unknown[] = []
  let n = mulai
  if (f.dari) {
    bagian.push(`order_created_at >= $${n++}::date`)
    params.push(f.dari)
  }
  if (f.sampai) {
    bagian.push(`order_created_at < ($${n++}::date + INTERVAL '1 day')`)
    params.push(f.sampai)
  }
  // ILIKE supaya user bisa menulis sebagian nama — tapi tetap parameter,
  // tidak pernah string yang disambung.
  if (f.category) {
    bagian.push(`category ILIKE $${n++}`)
    params.push(`%${f.category}%`)
  }
  if (f.test) {
    bagian.push(`test ILIKE $${n++}`)
    params.push(`%${f.test}%`)
  }
  if (f.account) {
    bagian.push(`account ILIKE $${n++}`)
    params.push(`%${f.account}%`)
  }
  return { where: bagian.join(' AND '), params }
}

/** Kapan tabel ETL terakhir diperbarui. Dipakai catatan kesegaran. */
export async function terakhirDiperbarui(): Promise<string | null> {
  const [r] = await salesQuery<{ t: string | null }>(
    `SELECT to_char(max(last_updated_at), 'YYYY-MM-DD HH24:MI') AS t FROM ${VIEW}`,
    []
  )
  return r?.t ?? null
}

// ------------------------------------------------------------------ backlog

export interface BarisBacklog {
  order_id: string
  test: string
  category: string
  account: string
  sample_status: string
  is_rns: boolean
  umur_hari: number
  order_created_at: string | null
  lab_sample_received_at: string | null
}

export interface RingkasanStatus {
  sample_status: string
  baris: number
  order: number
  umur_median: number | null
  umur_tertua: number | null
}

export interface HasilBacklog {
  totalBaris: number
  totalOrder: number
  perStatus: RingkasanStatus[]
  daftar: BarisBacklog[]
}

export async function backlog(f: Saringan, batas: number): Promise<HasilBacklog> {
  const { where, params } = bangun(f, BACKLOG_CLAUSE)

  const [total] = await salesQuery<{ baris: string; order: string }>(
    `SELECT count(*)::text AS baris, count(DISTINCT order_id)::text AS "order"
       FROM ${VIEW} WHERE ${where}`,
    params
  )

  const perStatus = await salesQuery<{
    sample_status: string
    baris: string
    order: string
    umur_median: string | null
    umur_tertua: string | null
  }>(
    `SELECT sample_status,
            count(*)::text AS baris,
            count(DISTINCT order_id)::text AS "order",
            round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (now() - ${JANGKAR_UMUR})) / 86400.0)::numeric, 1)::text AS umur_median,
            round(max(EXTRACT(EPOCH FROM (now() - ${JANGKAR_UMUR})) / 86400.0)::numeric, 1)::text AS umur_tertua
       FROM ${VIEW} WHERE ${where}
      GROUP BY 1 ORDER BY count(*) DESC`,
    params
  )

  // Yang paling lama menggantung lebih dulu — itu yang ditindaklanjuti orang lab.
  const daftar = await salesQuery<BarisBacklog>(
    `SELECT order_id, test, category, account, sample_status, is_rns,
            round(EXTRACT(EPOCH FROM (now() - ${JANGKAR_UMUR})) / 86400.0, 1)::float8 AS umur_hari,
            to_char(order_created_at, 'YYYY-MM-DD') AS order_created_at,
            to_char(lab_sample_received_at, 'YYYY-MM-DD') AS lab_sample_received_at
       FROM ${VIEW} WHERE ${where}
      ORDER BY ${JANGKAR_UMUR} ASC NULLS LAST
      LIMIT ${Math.max(1, Math.min(batas, 200))}`,
    params
  )

  return {
    totalBaris: Number(total?.baris ?? 0),
    totalOrder: Number(total?.order ?? 0),
    perStatus: perStatus.map((r) => ({
      sample_status: r.sample_status,
      baris: Number(r.baris),
      order: Number(r.order),
      umur_median: r.umur_median === null ? null : Number(r.umur_median),
      umur_tertua: r.umur_tertua === null ? null : Number(r.umur_tertua)
    })),
    daftar
  }
}

// -------------------------------------------------------------------- lacak

export interface Jejak {
  tahap: string
  waktu: string | null
}

export interface BarisLacak {
  order_id: string
  test: string
  category: string
  account: string
  payer_name: string
  sample_status: string
  is_rns: boolean
  notes: string | null
  umur_hari: number | null
  jejak: Jejak[]
}

/** Urutan penanda waktu, dipakai untuk menyusun jejak satu sampel. */
const URUTAN: Array<{ kolom: string; label: string }> = [
  { kolom: 'order_created_at', label: 'Order dibuat' },
  { kolom: 'order_validated_at', label: 'Order divalidasi' },
  { kolom: 'lab_sample_received_at', label: 'Sampel diterima lab' },
  { kolom: 'rns_at', label: 'Diputuskan RNS (sampel diambil ulang)' },
  { kolom: 'new_sample_received_date', label: 'Sampel pengganti diterima' },
  { kolom: 'preparation_started_at', label: 'Preparasi mulai' },
  { kolom: 'preparation_completed_at', label: 'Preparasi selesai' },
  { kolom: 'pathology_completed_at', label: 'Patologi selesai' },
  { kolom: 'result_created_at', label: 'Hasil mulai dibuat' },
  { kolom: 'result_validated_at', label: 'Hasil divalidasi analis' },
  { kolom: 'date_result', label: 'Hasil keluar ke pelanggan' },
  { kolom: 'canceled_at', label: 'Dibatalkan' }
]

export async function lacak(orderIdId: string): Promise<BarisLacak[]> {
  const ada = await kolomView()
  const urutan = URUTAN.filter((u) => ada.has(u.kolom))
  const pilih = urutan.map(
    (u) => `to_char(${u.kolom}, 'YYYY-MM-DD HH24:MI') AS "${u.kolom}"`
  ).join(', ')

  const rows = await salesQuery<Record<string, string | null>>(
    `SELECT order_id, test, category, account, payer_name, sample_status,
            is_rns, notes, ${pilih},
            round(EXTRACT(EPOCH FROM (COALESCE(date_result, now()) - ${JANGKAR_UMUR})) / 86400.0, 1)::text AS umur_hari
       FROM ${VIEW}
      WHERE upper(order_id) = upper($1)
      ORDER BY test`,
    [orderIdId]
  )

  return rows.map((r) => ({
    order_id: String(r.order_id),
    test: String(r.test),
    category: String(r.category),
    account: String(r.account),
    payer_name: String(r.payer_name),
    sample_status: String(r.sample_status),
    is_rns: (r.is_rns as unknown as boolean) === true,
    notes: r.notes ?? null,
    umur_hari: r.umur_hari === null ? null : Number(r.umur_hari),
    // Hanya tahap yang BENAR-BENAR terjadi; tahap kosong tidak dikirim sebagai
    // "null" berjajar supaya model tidak membacanya sebagai keterlambatan.
    jejak: urutan.filter((u) => r[u.kolom]).map((u) => ({
      tahap: u.label,
      waktu: r[u.kolom] as string
    }))
  }))
}

// ---------------------------------------------------------------------- RNS

export interface RingkasanRns {
  total: number
  penggantiDatang: number
  masihMenunggu: number
  hasilKeluarTanpaPengganti: number
  batal: number
  tungguMedianHari: number | null
  tungguP90Hari: number | null
}

export interface BarisRns {
  test: string
  category: string
  rns: number
  total: number
  persen: number
}

export async function ringkasanRns(f: Saringan): Promise<RingkasanRns> {
  const { where, params } = bangun(f, 'is_rns = true')
  const [r] = await salesQuery<Record<string, string | null>>(
    `SELECT count(*)::text AS total,
            count(new_sample_received_date)::text AS pengganti,
            count(*) FILTER (WHERE new_sample_received_date IS NULL
                               AND canceled_at IS NULL AND date_result IS NULL)::text AS menunggu,
            count(*) FILTER (WHERE new_sample_received_date IS NULL
                               AND date_result IS NOT NULL)::text AS tanpa_pengganti,
            count(*) FILTER (WHERE canceled_at IS NOT NULL)::text AS batal,
            round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (new_sample_received_date - rns_at)) / 86400.0)::numeric, 1)::text AS median,
            round(percentile_cont(0.9) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (new_sample_received_date - rns_at)) / 86400.0)::numeric, 1)::text AS p90
       FROM ${VIEW} WHERE ${where}`,
    params
  )
  const n = (v: string | null | undefined): number => Number(v ?? 0)
  return {
    total: n(r?.total),
    penggantiDatang: n(r?.pengganti),
    masihMenunggu: n(r?.menunggu),
    hasilKeluarTanpaPengganti: n(r?.tanpa_pengganti),
    batal: n(r?.batal),
    tungguMedianHari: r?.median == null ? null : Number(r.median),
    tungguP90Hari: r?.p90 == null ? null : Number(r.p90)
  }
}

/**
 * Peringkat RNS per pemeriksaan.
 *
 * ⚠️ `urut: 'persen'` WAJIB memakai ambang volume. Tanpa itu pemeriksaan
 * bervolume 2 yang sekali RNS tampil sebagai "50%" dan mengubur EGFR maupun
 * MammaPrint yang sungguhan.
 */
export async function peringkatRns(
  f: Saringan,
  urut: UrutRns,
  batas: number
): Promise<BarisRns[]> {
  const { where, params } = bangun(f, DIAKUI_CLAUSE)
  const having =
    urut === 'persen'
      ? `HAVING count(*) FILTER (WHERE is_rns) > 0 AND count(*) >= ${MIN_VOLUME_PERSEN}`
      : 'HAVING count(*) FILTER (WHERE is_rns) > 0'
  const orderBy =
    urut === 'persen'
      ? '(100.0 * count(*) FILTER (WHERE is_rns) / count(*)) DESC'
      : 'count(*) FILTER (WHERE is_rns) DESC'

  const rows = await salesQuery<{
    test: string
    category: string
    rns: string
    total: string
    persen: string
  }>(
    `SELECT test, category,
            count(*) FILTER (WHERE is_rns)::text AS rns,
            count(*)::text AS total,
            round(100.0 * count(*) FILTER (WHERE is_rns) / count(*), 2)::text AS persen
       FROM ${VIEW} WHERE ${where}
      GROUP BY 1, 2 ${having}
      ORDER BY ${orderBy}
      LIMIT ${Math.max(1, Math.min(batas, 50))}`,
    params
  )
  return rows.map((r) => ({
    test: r.test,
    category: r.category,
    rns: Number(r.rns),
    total: Number(r.total),
    persen: Number(r.persen)
  }))
}

// ---------------------------------------------------------------------- TAT

export interface BarisTat {
  kelompok: string
  n: number
  median: number | null
  p90: number | null
  terlama: number | null
}

/**
 * TAT satu tahap, dikelompokkan per kategori atau per pemeriksaan.
 *
 * Baris yang salah satu ujung tahapnya kosong TIDAK ikut — dan jumlah yang ikut
 * (`n`) dikembalikan supaya pemanggil bisa menyebutkannya. Diam soal itu membuat
 * tahap yang tidak universal terlihat seperti tahap yang cepat.
 */
export async function tat(
  f: Saringan,
  tahap: Tahap,
  per: 'category' | 'test',
  batas: number
): Promise<BarisTat[]> {
  const { where, params } = bangun(
    f,
    `${DIAKUI_CLAUSE} AND ${tahap.dari} IS NOT NULL AND ${tahap.ke} IS NOT NULL`
  )
  const lama = ekspresiLama(tahap)
  const rows = await salesQuery<{
    kelompok: string
    n: string
    median: string | null
    p90: string | null
    terlama: string | null
  }>(
    `SELECT ${per} AS kelompok,
            count(*)::text AS n,
            round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${lama})::numeric, 1)::text AS median,
            round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ${lama})::numeric, 1)::text AS p90,
            round(max(${lama})::numeric, 1)::text AS terlama
       FROM ${VIEW} WHERE ${where}
      GROUP BY 1 ORDER BY count(*) DESC
      LIMIT ${Math.max(1, Math.min(batas, 50))}`,
    params
  )
  return rows.map((r) => ({
    kelompok: r.kelompok,
    n: Number(r.n),
    median: r.median === null ? null : Number(r.median),
    p90: r.p90 === null ? null : Number(r.p90),
    terlama: r.terlama === null ? null : Number(r.terlama)
  }))
}

/** Berapa baris yang TIDAK bisa dihitung untuk tahap ini, supaya bisa disebut. */
export async function tahapTakTerpakai(f: Saringan, tahap: Tahap): Promise<number> {
  const { where, params } = bangun(
    f,
    `${DIAKUI_CLAUSE} AND (${tahap.dari} IS NULL OR ${tahap.ke} IS NULL)`
  )
  const [r] = await salesQuery<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${VIEW} WHERE ${where}`,
    params
  )
  return Number(r?.n ?? 0)
}

export { TAHAPAN }

// ------------------------------------------------- dashboard perbandingan TAT
//
// Dipakai `dashboard/lab.ts` (30 Sep 2026). Klausa pengakuan & penyaring SAMA
// dengan tool lab (`bangun` + `DIAKUI_CLAUSE`), jadi dashboard tidak bisa
// menghitung sampel yang ditolak tool.

export interface RingkasTat {
  n: number
  median: number | null
  p90: number | null
}

/**
 * Median & p90 TAT untuk SELURUH saringan dalam satu query.
 * ⚠️ Median keseluruhan TIDAK boleh dirata-rata dari median per kategori —
 * karena itu fungsi ini ada, bukan menjumlah hasil `tat()`.
 */
export async function tatRingkas(f: Saringan, tahap: Tahap): Promise<RingkasTat> {
  const { where, params } = bangun(f, `${DIAKUI_CLAUSE} AND ${tahap.dari} IS NOT NULL AND ${tahap.ke} IS NOT NULL`)
  const lama = ekspresiLama(tahap)
  const [r] = await salesQuery<{ n: string; median: string | null; p90: string | null }>(
    `SELECT count(*)::text AS n,
            round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${lama})::numeric, 1)::text AS median,
            round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ${lama})::numeric, 1)::text AS p90
       FROM ${VIEW} WHERE ${where}`,
    params
  )
  return {
    n: Number(r?.n ?? 0),
    median: r?.median == null ? null : Number(r.median),
    p90: r?.p90 == null ? null : Number(r.p90)
  }
}

/** Median TAT per BULAN order dibuat, untuk deret tren. */
export async function tatBulanan(f: Saringan, tahap: Tahap): Promise<Array<{ bulan: string; n: number; median: number | null }>> {
  const { where, params } = bangun(f, `${DIAKUI_CLAUSE} AND ${tahap.dari} IS NOT NULL AND ${tahap.ke} IS NOT NULL`)
  const lama = ekspresiLama(tahap)
  const rows = await salesQuery<{ bulan: string; n: string; median: string | null }>(
    `SELECT to_char(date_trunc('month', order_created_at), 'YYYY-MM') AS bulan,
            count(*)::text AS n,
            round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${lama})::numeric, 1)::text AS median
       FROM ${VIEW} WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    params
  )
  return rows.map((r) => ({ bulan: r.bulan, n: Number(r.n), median: r.median === null ? null : Number(r.median) }))
}

/** Volume order masuk: order unik (order_id) & baris pemeriksaan. */
export async function volumeOrder(f: Saringan): Promise<{ order: number; baris: number }> {
  const { where, params } = bangun(f, DIAKUI_CLAUSE)
  const [r] = await salesQuery<{ order: string; baris: string }>(
    `SELECT count(DISTINCT order_id)::text AS "order", count(*)::text AS baris FROM ${VIEW} WHERE ${where}`,
    params
  )
  return { order: Number(r?.order ?? 0), baris: Number(r?.baris ?? 0) }
}
