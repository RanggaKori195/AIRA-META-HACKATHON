// Pelanggan yang berhenti, melemah, dan baru.
//
// KONSEP. Membandingkan dua periode saja (seperti sales_movers untuk item) TIDAK cocok
// untuk pelanggan, karena irama ordernya sangat berbeda-beda. Terukur dari 13 bulan
// terakhir: 182 pelanggan order tiap bulan tanpa putus, sementara 313 pelanggan hanya
// order di 1 bulan saja. Bagi yang pertama, diam tiga minggu adalah alarm; bagi yang
// kedua, diam sebulan itu normal. Kalau keduanya diperlakukan sama, daftarnya penuh
// sampah dan orang berhenti mempercayainya.
//
// Jadi penilaiannya memakai tiga bahan:
//   1. irama    — berapa bulan pelanggan itu aktif dalam rentang pengamatan
//   2. diam     — berapa hari sejak order terakhirnya
//   3. nilai    — berapa rupiah yang dipertaruhkan
//
// Ambangnya sengaja TETAP (bukan menyesuaikan tiap pelanggan) supaya bisa dijelaskan
// saat manajemen bertanya "kenapa dia masuk daftar". Nilainya bisa diatur lewat parameter.
//
// Modul murni (tanpa I/O) supaya ter-cover unit test.

export const DEFAULT_MIN_BULAN_AKTIF = 4
export const DEFAULT_DIAM_HARI = 60
export const DEFAULT_JENDELA_HARI = 90
export const DEFAULT_MIN_TURUN_PERSEN = 30

export const STATUS_PELANGGAN = ['berhenti', 'melemah', 'baru'] as const
export type StatusPelanggan = (typeof STATUS_PELANGGAN)[number]

export const SEGMEN_PELANGGAN = ['institusi', 'pasien_pribadi', 'semua'] as const
export type SegmenPelanggan = (typeof SEGMEN_PELANGGAN)[number]

export interface BarisPelanggan {
  kode: string
  nama: string
  /** customer_type dari master; null bila pelanggan belum terdaftar di master. */
  tipe: string | null
  bulanAktif: number
  hariDiam: number
  hariSejakPertama: number
  nettTotal: number
  /** Nett pada jendela terkini (mis. 90 hari terakhir). */
  nettTerkini: number
  /** Nett pada jendela sepanjang itu tepat sebelumnya. */
  nettSebelum: number
}

/**
 * Pasien Pribadi adalah jalur komersial yang BERBEDA: pasien perorangan dengan harga
 * khusus dari dokter rumah sakit, bukan instansi yang bisa ditelepon oleh sales.
 * Karena itu default-nya dikeluarkan dari daftar pelanggan berhenti.
 *
 * Master `customer_type = 'PR'` adalah penanda utamanya. Tapi master TIDAK LENGKAP:
 * terukur 156 pelanggan yang bertransaksi 12 bulan terakhir tidak ada di master sama
 * sekali, dan 145 di antaranya bernama "Pasien Pribadi ...". Tanpa cadangan berbasis
 * nama, 145 akun itu akan salah masuk daftar institusi.
 */
export function isPasienPribadi(tipe: string | null, nama: string): boolean {
  if (typeof tipe === 'string' && tipe.trim().toUpperCase() === 'PR') return true
  if (tipe !== null && tipe !== undefined && String(tipe).trim() !== '') return false
  // Hanya dipakai sebagai cadangan saat tipe tidak diketahui.
  return /^\s*pasien\s+(pribadi|drive)/i.test(nama)
}

export function inSegmen(baris: BarisPelanggan, segmen: SegmenPelanggan): boolean {
  if (segmen === 'semua') return true
  const pp = isPasienPribadi(baris.tipe, baris.nama)
  return segmen === 'pasien_pribadi' ? pp : !pp
}

export interface Ambang {
  minBulanAktif?: number
  diamHari?: number
  jendelaHari?: number
  minTurunPersen?: number
}

function bulat1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface HasilPelanggan extends BarisPelanggan {
  /** Selisih rupiah jendela terkini vs jendela sebelumnya (khusus status melemah). */
  turunNett?: number
  persenTurun?: number | null
}

/**
 * BERHENTI — pelanggan yang dulunya rutin lalu diam.
 * Diurutkan menurut RUPIAH yang dipertaruhkan, bukan lamanya diam: kehilangan satu RS
 * besar lebih penting daripada sepuluh pelanggan kecil.
 */
export function pickBerhenti(rows: BarisPelanggan[], a: Ambang = {}): HasilPelanggan[] {
  const minBulan = a.minBulanAktif ?? DEFAULT_MIN_BULAN_AKTIF
  const diam = a.diamHari ?? DEFAULT_DIAM_HARI
  return rows
    .filter((r) => r.bulanAktif >= minBulan && r.hariDiam > diam)
    .sort((x, y) => y.nettTotal - x.nettTotal)
}

/**
 * MELEMAH — masih order, tapi jauh menurun. Sengaja TIDAK memuat yang sudah berhenti
 * supaya kedua daftar tidak tumpang tindih dan orang tidak menelepon dua kali.
 */
export function pickMelemah(rows: BarisPelanggan[], a: Ambang = {}): HasilPelanggan[] {
  const diam = a.diamHari ?? DEFAULT_DIAM_HARI
  const minTurun = a.minTurunPersen ?? DEFAULT_MIN_TURUN_PERSEN
  return rows
    .filter((r) => r.hariDiam <= diam && r.nettSebelum > 0 && r.nettTerkini < r.nettSebelum)
    .map((r) => {
      const turun = r.nettSebelum - r.nettTerkini
      return { ...r, turunNett: turun, persenTurun: bulat1((turun / r.nettSebelum) * 100) }
    })
    .filter((r) => (r.persenTurun ?? 0) >= minTurun)
    .sort((x, y) => (y.turunNett ?? 0) - (x.turunNett ?? 0))
}

/**
 * BARU — order pertamanya jatuh di dalam jendela terkini.
 * Catatan kejujuran: "pertama" hanya sepanjang rentang pengamatan tool ini, bukan
 * seumur hidup pelanggan. Pelanggan lama yang kembali setelah vakum lebih dari rentang
 * pengamatan akan terlihat seperti baru — disebutkan di catatan hasil tool.
 */
export function pickBaru(rows: BarisPelanggan[], a: Ambang = {}): HasilPelanggan[] {
  const jendela = a.jendelaHari ?? DEFAULT_JENDELA_HARI
  return rows
    .filter((r) => r.hariSejakPertama <= jendela)
    .sort((x, y) => y.nettTotal - x.nettTotal)
}

const PEMILIH: Record<StatusPelanggan, (rows: BarisPelanggan[], a: Ambang) => HasilPelanggan[]> = {
  berhenti: pickBerhenti,
  melemah: pickMelemah,
  baru: pickBaru
}

/** Menyaring menurut segmen lalu menurut status. Urutan ini penting: segmen dulu. */
export function pilihPelanggan(
  rows: BarisPelanggan[],
  status: StatusPelanggan,
  segmen: SegmenPelanggan,
  ambang: Ambang = {}
): HasilPelanggan[] {
  return PEMILIH[status](rows.filter((r) => inSegmen(r, segmen)), ambang)
}

/**
 * SQL riwayat per pelanggan: irama, order terakhir & pertama, dan nilai pada dua
 * jendela berurutan. Dikunci di modul ini — bukan di sales-tools.ts — supaya string
 * yang diuji live-check benar-benar string yang dipakai produksi.
 *
 * ⚠️ Nama pelanggan diambil lewat `LATERAL … LIMIT 1`, JANGAN LEFT JOIN langsung:
 * `m_customer.customer_code_lis` tidak unik dan join langsung menggelembungkan angka.
 * Cadangan nama dari tabel transaksi dipakai karena master tidak lengkap — terukur 156
 * pelanggan bertransaksi 12 bulan terakhir tanpa ada di master, 145 di antaranya
 * bernama "Pasien Pribadi".
 *
 * Parameter: $1 tanggal mulai · $2 tanggal akhir · $3 panjang jendela (hari).
 * Filter tambahan menyusul mulai $4.
 */
export function customerHistorySql(opts: {
  table: string
  basisColumn: string
  filterClause: string
}): string {
  const b = opts.basisColumn
  return `WITH a AS (
           SELECT customer_id AS kode,
                  count(DISTINCT date_trunc('month', ${b}))::int      AS bulan_aktif,
                  max(${b})                                           AS terakhir,
                  min(${b})                                           AS pertama,
                  coalesce(sum(nett_sales),0)::float8                 AS nett_total,
                  coalesce(sum(nett_sales) FILTER (
                    WHERE ${b} > $2::date - $3::int),0)::float8        AS nett_terkini,
                  coalesce(sum(nett_sales) FILTER (
                    WHERE ${b} <= $2::date - $3::int
                      AND ${b} >  $2::date - ($3::int * 2)),0)::float8 AS nett_sebelum,
                  (array_agg(customer_name ORDER BY ${b} DESC))[1]     AS nama_transaksi
           FROM ${opts.table}
           WHERE ${b} BETWEEN $1::date AND $2::date${opts.filterClause}
           GROUP BY 1
         )
         SELECT a.kode,
                coalesce(nullif(trim(w.nama), ''), nullif(trim(a.nama_transaksi), ''), a.kode) AS nama,
                w.tipe,
                a.bulan_aktif                AS "bulanAktif",
                ($2::date - a.terakhir)::int AS "hariDiam",
                ($2::date - a.pertama)::int  AS "hariSejakPertama",
                a.terakhir::text             AS "orderTerakhir",
                a.nett_total                 AS "nettTotal",
                a.nett_terkini               AS "nettTerkini",
                a.nett_sebelum               AS "nettSebelum"
         FROM a
         LEFT JOIN LATERAL (
           SELECT c.customer_name AS nama, c.customer_type AS tipe
           FROM public.m_customer c
           WHERE c.customer_code_lis = a.kode
           ORDER BY (c.is_active = '1') DESC, c.id
           LIMIT 1
         ) w ON true`
}

export function isStatusPelanggan(v: unknown): v is StatusPelanggan {
  return typeof v === 'string' && (STATUS_PELANGGAN as readonly string[]).includes(v)
}

export function isSegmenPelanggan(v: unknown): v is SegmenPelanggan {
  return typeof v === 'string' && (SEGMEN_PELANGGAN as readonly string[]).includes(v)
}
