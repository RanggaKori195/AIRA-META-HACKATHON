// Aturan murni PEMANTAU PROAKTIF (20 Okt 2026) — pemeriksaan berkala yang HANYA
// MEMBACA data lalu memberi tahu user yang berizin menu terkait. Rancangan &
// keputusan user: RANCANGAN-PEMANTAU.md. Tidak menyentuh Electron/database supaya
// seluruh keputusannya bisa diuji.
//
// ⚠️ Ambang di bawah BUKAN tebakan: diuji ke data ±1 tahun sebelum dipilih user
// (spec §2). Contoh: "sales kemarin < 40% dari median hari yang sama 4 minggu,
// kecuali order ikut anjlok" = ±6 alarm/tahun; dengan 50% jadi ±16. Mengubah angka
// di sini = mengubah frekuensi notifikasi di SEMUA laptop — ukur ulang dulu.
// ⚠️ Jam & hari = jam LAPTOP (pola Jadwal: "jam kerja" berarti jam dinding di meja
// orangnya). Umur data & jendela sampel justru memakai jam DATABASE (lihat sql.ts).

import type { AksiPemantau, PemicuId } from '../../shared/ipc'
import { NAMA_HARI } from '../../shared/jadwal-pola'
import { rupiah } from '../sales/report'

/** Jam kerja pemantau: tidak ada query di luar [JAM_MULAI, JAM_SELESAI). */
export const JAM_MULAI = 8
export const JAM_SELESAI = 18
/**
 * Jeda acak per laptop. Puluhan laptop yang menyala pukul 08.00 tidak boleh
 * menembak database produksi pada detik yang sama.
 */
export const JEDA_ACAK_MAKS_MENIT = 10
/** Jarak minimal antar percobaan satu pemicu (juga jarak coba-ulang bila gagal/ditahan). */
export const INTERVAL_ULANG_MS = 60 * 60_000

/**
 * Data Sales macet: tak ada baris BARU (`created_at`) selama ini, jam hari Minggu tidak dihitung
 * (Senin–Jumat). Terukur 20 Okt 2026 (60 hari): jeda normal hari kerja ≤ 17,3 jam; umur tertinggi
 * di cek normal 18,8 jam (Senin pagi).
 */
export const AMBANG_DATA_SALES_JAM = 24
/** Data TAT macet: `max(last_updated_at)` view lebih tua dari ini. Normal ≤ 48 jam (Sabtu → Senin). */
export const AMBANG_DATA_TAT_JAM = 72

/** Batas wajar sampel = persentil ini dari lama terima-lab → hasil, per kategori. */
export const LAB_PERSENTIL = 0.9
/** Kategori baru punya batas bila sampel selesainya (dengan jam terima lab) sebanyak ini. */
export const LAB_MIN_SELESAI = 100
/** Jendela riwayat sampel selesai untuk menghitung batas. */
export const LAB_JENDELA_HARI = 90
/** Sampel diterima lebih lama dari ini tidak dipantau (status yang tidak pernah ditutup). */
export const LAB_UMUR_MAKS_HARI = 30
/** Pemeriksaan sampel terlambat dimulai jam ini — sesudah ETL malam masuk. */
export const LAB_JAM_PERIKSA = 9

/** Sales anjlok: nett hari yang dinilai di bawah rasio ini terhadap median pembanding. */
export const SALES_RASIO_ANJLOK = 0.4
/** Order masuk di bawah rasio ini = hari libur/tutup, BUKAN sales anjlok. */
export const SALES_RASIO_LIBUR = 0.5
/** Pembanding = hari yang sama sekian minggu ke belakang. */
export const SALES_MINGGU_PEMBANDING = 4
/** Minimal pembanding bernilai; kurang dari ini tidak dinilai. */
export const SALES_MIN_PEMBANDING = 3
/** Penilaian sales dimulai jam ini — sinkronisasi malam sudah berjalan. */
export const SALES_JAM_PERIKSA = 10
/**
 * Hari kerja yang tertinggal dinilai MENYUSUL paling jauh sekian hari kerja ke belakang
 * (`hariBelumDinilai`): Jumat→Senin (2) ditambah satu hari pemeriksaan yang terlewat (Senin
 * libur, laptop mati, VPN putus seharian). Satu hari per pemeriksaan (tiap 60 menit).
 */
export const SALES_SUSULAN_HARI_KERJA = 3

/** Riwayat peringatan yang DISIMPAN per user. */
export const MAKS_RIWAYAT = 100
/** Riwayat peringatan yang TAMPIL di Settings. */
export const RIWAYAT_TAMPIL = 20
/** "Periksa sekarang" paling sering sekali per jeda ini per user. */
export const JEDA_PERIKSA_MANUAL_MS = 60_000

export interface DefinisiPemicu {
  id: PemicuId
  /** Menu yang WAJIB diizinkan untuk memeriksa & menerima pemicu ini. */
  menu: 'sales' | 'lab'
  judul: string
  /** Hari diperiksa: `Date.getDay()` lokal (0 = Minggu). */
  hari: readonly number[]
}

const SENIN_JUMAT = [1, 2, 3, 4, 5] as const
const SENIN_SABTU = [1, 2, 3, 4, 5, 6] as const

/**
 * Urutan di sini = urutan diperiksa dan urutan tampil di Settings.
 * ⚠️ Data Sales TIDAK dicek Sabtu: ETL Sabtu tidak teratur (terukur 20 Okt: baris
 * pertama Sabtu bisa baru masuk pukul 17.20), jadi Sabtu pagi akan selalu "macet".
 */
export const PEMICU: readonly DefinisiPemicu[] = [
  { id: 'data_sales', menu: 'sales', judul: 'Data Sales berhenti diperbarui', hari: SENIN_JUMAT },
  { id: 'data_tat', menu: 'lab', judul: 'Data TAT Sample berhenti diperbarui', hari: SENIN_SABTU },
  { id: 'sampel_terlambat', menu: 'lab', judul: 'Sampel lab melewati batas wajar', hari: SENIN_SABTU },
  { id: 'sales_anjlok', menu: 'sales', judul: 'Sales kemarin anjlok', hari: SENIN_SABTU }
]

export function definisi(id: PemicuId): DefinisiPemicu {
  const d = PEMICU.find((p) => p.id === id)
  if (!d) throw new Error(`pemicu tidak dikenal: ${id}`)
  return d
}

/**
 * Penanda anti-ulang satu pemicu milik satu user. Arti `nilai` per pemicu:
 * data macet = waktu data terakhir yang sudah diberitahukan; sampel = akhir jendela
 * pemeriksaan terakhir (ISO, jam database); sales = tanggal TERAKHIR yang sudah dinilai —
 * hanya maju, dan hari sampai tanggal itu tidak dinilai lagi (`hariBelumDinilai`).
 */
export interface Penanda {
  nilai: string | null
  /** Epoch ms percobaan terakhir (sukses, ditahan, atau gagal). */
  diperiksa: number | null
}

export function jedaAcakMs(acak: () => number = Math.random): number {
  return Math.floor(acak() * (JEDA_ACAK_MAKS_MENIT * 60_000 + 1))
}

const dua = (n: number): string => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' menurut zona waktu laptop. */
export function tanggalLokal(d: Date): string {
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`
}

// Tanggal 'YYYY-MM-DD' dihitung lewat UTC supaya tidak bergeser zona waktu laptop.
const keUtc = (tanggal: string): Date => new Date(`${tanggal}T00:00:00Z`)

export function tambahHari(tanggal: string, n: number): string {
  const d = keUtc(tanggal)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Hari kerja (Senin–Sabtu) terakhir SEBELUM `hariIniJakarta`. Minggu tutup, jadi
 * Senin menilai Sabtu. Hari berjalan tidak pernah dinilai: `date_result` bertipe
 * DATE dan hari ini selalu baru terisi sebagian.
 */
export function hariDinilai(hariIniJakarta: string): string {
  let d = tambahHari(hariIniJakarta, -1)
  if (keUtc(d).getUTCDay() === 0) d = tambahHari(d, -1)
  return d
}

/**
 * Antrean `sales_anjlok`, TERTUA dulu: hari kerja sesudah `penanda` sampai `hariDinilai`, paling
 * jauh SALES_SUSULAN_HARI_KERJA hari kerja ke belakang. Kosong = semuanya sudah dinilai.
 *
 * Hari yang belum sinkron pada hari pemeriksaannya DINILAI MENYUSUL, bukan dilewati (22 Okt 2026,
 * pilihan user). Terutama Jumat: baris baru hari Sabtu sering baru masuk ±17.20 atau tidak sama
 * sekali, dan Senin dulu langsung menilai Sabtu. Replay 63 hari kerja (7 Agu–19 Okt): 6 hari tidak
 * pernah dinilai — 5 Jumat + Sen 24 Agu (besoknya libur tanpa insert, lusa sudah menilai Selasa).
 *
 * Penanda kosong (user baru / saklar dinyalakan ulang) = hanya hari kerja terakhir: janji saklar
 * adalah keadaan SAAT ITU, bukan menyusul hari-hari sebelumnya.
 */
export function hariBelumDinilai(hariIniJakarta: string, penanda: string | null): string[] {
  const jendela = [hariDinilai(hariIniJakarta)]
  // hariDinilai(x) = hari kerja sebelum x.
  while (jendela.length < SALES_SUSULAN_HARI_KERJA) jendela.unshift(hariDinilai(jendela[0]))
  return penanda === null ? jendela.slice(-1) : jendela.filter((d) => d > penanda)
}

/** Hari yang SAMA 1..SALES_MINGGU_PEMBANDING minggu sebelumnya, terbaru dulu. */
export function tanggalPembanding(tanggal: string): string[] {
  return Array.from({ length: SALES_MINGGU_PEMBANDING }, (_, i) => tambahHari(tanggal, -7 * (i + 1)))
}

/**
 * Sudah boleh dicoba lagi sesudah percobaan `terakhir` (epoch ms, jam laptop)? Waktu
 * terakhir di MASA DEPAN berarti jam laptop melompat mundur (diubah manual, sinkronisasi
 * jam) — dianggap boleh, bukan "baru saja dicoba". Kalau tidak, pemeriksaan menunggu
 * sampai jam menyusul, bisa sehari penuh (temuan review akhir 20 Okt 2026). Dipakai
 * jarak antar-pemeriksaan DAN batas "Periksa sekarang" — satu aturan, bukan dua.
 */
export function bolehLagi(terakhir: number | null, kini: number, jedaMs: number): boolean {
  return terakhir === null || terakhir > kini || kini - terakhir >= jedaMs
}

function jamMulai(id: PemicuId): number {
  if (id === 'sampel_terlambat') return LAB_JAM_PERIKSA
  if (id === 'sales_anjlok') return SALES_JAM_PERIKSA
  return JAM_MULAI
}

/**
 * Boleh dinilai lewat "Periksa sekarang"? Hari & JAM MULAI pemicu tetap berlaku — itu
 * bagian dari ambangnya: data Sales tidak dinilai Sabtu/Minggu (ETL akhir pekan tidak
 * teratur = alarm palsu), sales kemarin tidak dinilai sebelum 10.00 (data hari itu
 * belum tentu lengkap, dan penandanya akan menutup penilaian resmi). Yang diabaikan:
 * jarak 60 menit, jeda acak, batas 18.00, dan "sudah dinilai hari ini" (temuan review
 * akhir 20 Okt 2026).
 */
export function bolehDiperiksaManual(id: PemicuId, sekarang: Date): boolean {
  if (!definisi(id).hari.includes(sekarang.getDay())) return false
  const awal = new Date(sekarang)
  awal.setHours(jamMulai(id), 0, 0, 0)
  return sekarang.getTime() >= awal.getTime()
}

/**
 * Apakah pemicu ini perlu diperiksa SEKARANG. Dipanggil tiap detak (30 dtk), jadi
 * wajib murah: hanya jam & penanda lokal, tidak menyentuh database.
 *
 * - data macet: tiap jam selama jam kerja harinya;
 * - sampel: sekali sehari sesudah evaluasi SUKSES (ditahan/gagal dicoba lagi tiap jam
 *   — satu VPN putus pukul 09.05 tidak boleh menghapus pemeriksaan sehari penuh);
 * - sales: sampai hari kerja terakhir sudah dinilai; hari yang tertinggal disusulkan lebih
 *   dulu, satu per pemeriksaan (`hariBelumDinilai`).
 */
export function jatuhTempo(
  id: PemicuId,
  sekarang: Date,
  jedaMs: number,
  p: Penanda,
  hariIniJakarta: string
): boolean {
  if (!definisi(id).hari.includes(sekarang.getDay())) return false
  const awal = new Date(sekarang)
  awal.setHours(jamMulai(id), 0, 0, 0)
  const akhir = new Date(sekarang)
  akhir.setHours(JAM_SELESAI, 0, 0, 0)
  const ms = sekarang.getTime()
  if (ms < awal.getTime() + jedaMs || ms >= akhir.getTime()) return false
  if (!bolehLagi(p.diperiksa, ms, INTERVAL_ULANG_MS)) return false
  if (id === 'sampel_terlambat') {
    return p.nilai === null || tanggalLokal(new Date(p.nilai)) < tanggalLokal(sekarang)
  }
  if (id === 'sales_anjlok') return p.nilai === null || p.nilai < hariDinilai(hariIniJakarta)
  return true
}

// ------------------------------------------------------------------ keputusan

/** Kesegaran satu sumber data. `terakhir` = 'YYYY-MM-DD HH:MI' jam database; `umurJam` dari `now()` database. */
export interface KesegaranData {
  terakhir: string | null
  umurJam: number | null
}

/**
 * Waktu data terakhir di MASA DEPAN: umur negatif, dihitung `now()` DATABASE. Penyebab
 * yang mungkin: baris bertanggal keliru, atau pengisi data menulis jam dengan zona waktu
 * salah. Satu baris seperti itu membuat `max()` selalu tampak baru, dan kemacetan
 * sungguhan tertutup selamanya (temuan review akhir 20 Okt 2026). Dianggap TIDAK BISA
 * DINILAI — bukan segar (aturan 33).
 */
export function waktuMasaDepan(k: KesegaranData): boolean {
  return k.umurJam !== null && k.umurJam < 0
}

const JAM_MS = 3_600_000
const HARI_MS = 24 * JAM_MS

/**
 * Umur data Sales yang DINILAI ambang `data_sales`: jam hari MINGGU tidak dihitung — lab tutup
 * hari Minggu, jadi tidak ada baris baru yang ditunggu. Sabtu tetap dihitung (hari kerja lab).
 * Terukur 20 Okt 2026 (60 hari): 2 dari 9 hari Minggu tanpa insert; tanpa aturan ini Senin
 * 12 Okt 08.05 berbunyi palsu (42,8 jam; insert Senin pertama 08.19).
 *
 * "Sekarang" = terakhir + umur (keduanya jam database), jadi jam laptop tidak ikut. Dibulatkan
 * 0,1 jam seperti `umur_jam` dari SQL. Umur tak terbaca, nol, atau negatif (masa depan)
 * dikembalikan apa adanya — itu urusan status "gagal", bukan aturan hari Minggu.
 */
export function umurTanpaMinggu(k: KesegaranData): number | null {
  if (k.terakhir === null || k.umurJam === null || k.umurJam <= 0) return k.umurJam
  const awal = new Date(`${k.terakhir.replace(' ', 'T')}:00Z`).getTime()
  if (Number.isNaN(awal)) return k.umurJam
  const akhir = awal + k.umurJam * JAM_MS
  let minggu = 0
  for (let hari = awal - (awal % HARI_MS); hari < akhir; hari += HARI_MS) {
    if (new Date(hari).getUTCDay() === 0) minggu += Math.min(akhir, hari + HARI_MS) - Math.max(awal, hari)
  }
  return Math.round((k.umurJam - minggu / JAM_MS) * 10) / 10
}

/**
 * Data macet berbunyi SEKALI per kemacetan: penanda menyimpan waktu data terakhir
 * yang sudah diberitahukan. Data bergerak lalu macet lagi = waktu baru = berbunyi lagi.
 * Umur tak terbaca bukan "macet" — itu urusan status gagal, bukan alarm (aturan 33).
 */
export function putuskanDataMacet(
  k: KesegaranData,
  ambangJam: number,
  nilai: string | null
): { macet: boolean; berbunyi: boolean } {
  const macet = k.umurJam !== null && k.umurJam > ambangJam
  return { macet, berbunyi: macet && k.terakhir !== nilai }
}

/** Satu kategori dari `SQL_SAMPEL_LEWAT_BATAS`. */
export interface BarisSampel {
  category: string
  batas_hari: number
  terlambat: number
  baru: number
}

/** Satu kategori dari `SQL_KATEGORI_BACKLOG`. */
export interface KategoriBacklog {
  category: string
  di_lab: number
  backlog: number
}

/**
 * Kategori yang punya backlog tapi TIDAK bisa dipantau — wajib disebut, bukan
 * didiamkan (PK & MB tidak pernah mencatat jam terima lab; Genme tidak pernah
 * punya tanggal hasil — terukur 20 Okt 2026).
 */
export function tidakDipantau(backlog: KategoriBacklog[], terpantau: readonly string[]): string[] {
  return backlog
    .filter((b) => !terpantau.includes(b.category))
    .sort((a, b) => a.category.localeCompare(b.category))
    .map(
      (b) =>
        `${b.category} (${b.di_lab === 0 ? 'jam terima lab tidak tercatat' : 'riwayat sampel selesai belum cukup'})`
    )
}

/**
 * Pemeriksaan pertama (penanda kosong) memberi tahu total yang SEDANG terlambat,
 * sekali; sesudahnya hanya sampel yang BARU melewati batas yang berbunyi.
 */
export function putuskanSampel(
  baris: BarisSampel[],
  pertamaKali: boolean
): { berbunyi: boolean; baru: number; terlambat: number } {
  const baru = baris.reduce((n, b) => n + b.baru, 0)
  const terlambat = baris.reduce((n, b) => n + b.terlambat, 0)
  return { berbunyi: pertamaKali ? terlambat > 0 : baru > 0, baru, terlambat }
}

export interface PenilaianSales {
  hasil: 'berbunyi' | 'normal' | 'libur' | 'kurang_data'
  tanggal: string
  nett: number
  order: number
  medianNett: number | null
  medianOrder: number | null
  rasioNett: number | null
  rasioOrder: number | null
  /**
   * Tanggal pembanding yang benar-benar dipakai — nett DAN order tercatat (> 0) — terbaru
   * dulu. SATU himpunan untuk kedua median, dan yang disebut di rincian.
   */
  pembanding: string[]
}

/** Median; minimal satu nilai (pemanggil menjamin ≥ SALES_MIN_PEMBANDING). */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Menilai satu hari: nett dibanding median hari yang SAMA 4 minggu sebelumnya.
 *
 * ⚠️ Order masuk yang ikut anjlok = hari libur/tutup (17 Agu, Idul Fitri, dst.),
 * bukan sales yang anjlok — terukur 15–16 hari libur setahun dikenali dengan benar.
 * ⚠️ Median, bukan rata-rata: satu hari libur di antara pembanding (nett kecil tapi
 * > 0) tidak boleh menyeret patokannya.
 * `rasioAnjlok` hanya diganti mode uji dev; produksi selalu memakai konstanta.
 */
export function nilaiSalesAnjlok(
  tanggal: string,
  nett: Record<string, number>,
  order: Record<string, number>,
  rasioAnjlok: number = SALES_RASIO_ANJLOK
): PenilaianSales {
  const nilai = (r: Record<string, number>, d: string): number => Number(r[d] ?? 0)
  // Satu himpunan tanggal untuk KEDUA median (temuan review akhir 20 Okt 2026): dulu
  // order punya himpunannya sendiri, jadi median order di rincian bukan median tanggal
  // yang disebut di sana. Hari tanpa sales atau tanpa order bukan pembanding yang wajar.
  const pembanding = tanggalPembanding(tanggal).filter((d) => nilai(nett, d) > 0 && nilai(order, d) > 0)
  const dasar = { tanggal, nett: nilai(nett, tanggal), order: nilai(order, tanggal), pembanding }
  if (pembanding.length < SALES_MIN_PEMBANDING) {
    return { ...dasar, hasil: 'kurang_data', medianNett: null, medianOrder: null, rasioNett: null, rasioOrder: null }
  }
  const medianNett = median(pembanding.map((d) => nilai(nett, d)))
  const medianOrder = median(pembanding.map((d) => nilai(order, d)))
  const rasioNett = dasar.nett / medianNett
  const rasioOrder = dasar.order / medianOrder
  const hasil = rasioOrder < SALES_RASIO_LIBUR ? 'libur' : rasioNett < rasioAnjlok ? 'berbunyi' : 'normal'
  return { ...dasar, hasil, medianNett, medianOrder, rasioNett, rasioOrder }
}

// ----------------------------------------------------------------------- teks
//
// ⚠️ Judul & isi toast HANYA jumlah & persen: layar bisa sedang dibagikan atau
// diproyeksikan (pola `chatPratinjau`), dan toast tidak bisa ditarik kembali.
// Rupiah hanya di `rincian`, yang tampil di riwayat DI DALAM aplikasi.

const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const BULAN_PANJANG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

const angkaId = (n: number): string => n.toLocaleString('id-ID')
const desimal1 = (n: number): string =>
  n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const persen = (r: number): number => Math.round(r * 100)
const jam = (h: number): string => `${dua(h)}.00`

/** '19 Okt' */
function tanggalSingkat(tanggal: string): string {
  const d = keUtc(tanggal)
  return `${d.getUTCDate()} ${BULAN_PENDEK[d.getUTCMonth()]}`
}
/** 'Sen 19 Okt' */
function labelTanggal(tanggal: string): string {
  return `${HARI_PENDEK[keUtc(tanggal).getUTCDay()]} ${tanggalSingkat(tanggal)}`
}
/** '19 Oktober 2026' */
function tanggalPanjang(tanggal: string): string {
  const d = keUtc(tanggal)
  return `${d.getUTCDate()} ${BULAN_PANJANG[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
/** 'YYYY-MM-DD HH:MI' → 'Kam 8 Okt 02.25' */
function labelWaktu(waktu: string): string {
  const [tgl, jamMenit] = waktu.split(' ')
  return `${labelTanggal(tgl)}${jamMenit ? ` ${jamMenit.replace(':', '.')}` : ''}`
}
/** '±36 jam' di bawah dua hari, selebihnya '12 hari'. */
function teksUmur(umurJam: number): string {
  return umurJam < 48 ? `±${Math.round(umurJam)} jam` : `${Math.floor(umurJam / 24)} hari`
}

/** Isi satu kejadian: judul & isi = toast; rincian = riwayat di aplikasi; aksi = saat diklik. */
export interface Kabar {
  judul: string
  isi: string
  rincian: string
  aksi: AksiPemantau
}

export function kabarDataMacet(jenis: 'sales' | 'tat', k: { terakhir: string; umurJam: number }): Kabar {
  const judul = `${jenis === 'sales' ? 'Data Sales' : 'Data TAT Sample'} belum diperbarui ${teksUmur(k.umurJam)}`
  const isi =
    jenis === 'sales'
      ? `Baris baru terakhir masuk ${labelWaktu(k.terakhir)}. Jawaban Tanya Data Sales memakai data sampai jam itu (bisa karena libur).`
      : `Terakhir ${labelWaktu(k.terakhir)}. Backlog & TAT yang dijawab AIRA tertinggal sejak itu; pemantau sampel terlambat ditahan.`
  return { judul, isi, rincian: isi, aksi: { tujuan: 'panel' } }
}

export function kabarSampel(baris: BarisSampel[], pertamaKali: boolean, tidak: string[]): Kabar {
  const { baru, terlambat } = putuskanSampel(baris, pertamaKali)
  const kunci = pertamaKali ? 'terlambat' : 'baru'
  const urut = baris
    .filter((b) => b[kunci] > 0)
    .sort((a, b) => b[kunci] - a[kunci] || b.terlambat - a.terlambat)
  const daftar = urut.map((b) => `${b.category} ${angkaId(b[kunci])} (> ${desimal1(b.batas_hari)} hari)`).join(', ')
  const judul = pertamaKali
    ? `${angkaId(terlambat)} sampel lab sedang melewati batas wajar`
    : `${angkaId(baru)} sampel lab baru melewati batas wajar`
  const isi = pertamaKali ? `${daftar}.` : `${daftar}. Total terlambat: ${angkaId(terlambat)}.`
  const rincian = isi + (tidak.length > 0 ? ` Tidak dipantau: ${tidak.join(', ')}.` : '')
  const sasaran = urut[0] ? `sampel ${urut[0].category}` : 'sampel'
  return {
    judul,
    isi,
    rincian,
    aksi: {
      tujuan: 'menu',
      mode: 'lab',
      tanya: `Tampilkan ${sasaran} yang sudah diterima lab tapi hasilnya belum keluar, urut dari yang paling lama`
    }
  }
}

export function kabarSales(p: PenilaianSales): Kabar {
  const hari = NAMA_HARI[keUtc(p.tanggal).getUTCDay()]
  // Jumlah pembanding yang SEBENARNYA dipakai (3 atau 4), dan tanggal yang dilewati disebut —
  // dulu selalu tertulis "4 minggu" (temuan review akhir 20 Okt 2026).
  const dilewati = tanggalPembanding(p.tanggal).filter((d) => !p.pembanding.includes(d))
  const tanggalMedian =
    p.pembanding.map(tanggalSingkat).join(', ') +
    (dilewati.length > 0 ? `; ${dilewati.map(tanggalSingkat).join(', ')} tidak dipakai — sales atau order nol` : '')
  return {
    judul: `Sales ${labelTanggal(p.tanggal)} anjlok: ${persen(p.rasioNett ?? 0)}% dari biasanya`,
    // "tidak ikut anjlok", BUKAN "normal": order 55% bukan normal — ia hanya di atas
    // ambang libur (review akhir 20 Okt 2026).
    isi: `Order masuk ${persen(p.rasioOrder ?? 0)}% dari biasanya (tidak ikut anjlok). Klik untuk menggali.`,
    rincian:
      `Nett ${tanggalPanjang(p.tanggal)}: ${rupiah(p.nett)}. Median ${p.pembanding.length} hari ${hari} ` +
      `sebelumnya (${tanggalMedian}): ${rupiah(p.medianNett ?? 0)}. ` +
      `Order masuk ${angkaId(p.order)} vs median ${angkaId(p.medianOrder ?? 0)}.`,
    aksi: {
      tujuan: 'menu',
      mode: 'sales',
      tanya: `Bandingkan sales ${tanggalPanjang(p.tanggal)} dengan ${tanggalPanjang(tambahHari(p.tanggal, -7))} per kategori layanan`
    }
  }
}

// --------------------------------------------------------- kalimat untuk layar

/**
 * "Periksa sekarang" yang kena batas DISEBUT — tombol yang ditekan tanpa akibat apa pun di
 * layar tampak seperti AIRA rusak (temuan review akhir 20 Okt 2026). `sisaMs` > 0.
 */
export function kalimatBatasManual(sisaMs: number): string {
  return (
    `Baru saja diperiksa — coba lagi dalam ${Math.max(1, Math.ceil(sisaMs / 1000))} detik ` +
    `(dibatasi sekali per ${Math.round(JEDA_PERIKSA_MANUAL_MS / 1000)} detik).`
  )
}

/** "Tidak bisa memeriksa" ≠ "data macet" (aturan 33) — tanpa toast, hanya status. */
export const RINGKAS_GAGAL = 'Gagal memeriksa: database tidak terjangkau.'

/**
 * Tidak satu pun kategori punya riwayat cukup untuk diberi batas. "Terlambat 0" di sini
 * berarti "tidak ada yang diperiksa", BUKAN "tidak ada yang terlambat" (aturan 33).
 */
export const RINGKAS_SAMPEL_KOSONG =
  'Tidak ada kategori yang bisa dipantau saat ini — riwayat sampel selesai dengan jam terima lab belum cukup.'

export function ringkasDataMacet(jenis: 'sales' | 'tat', k: KesegaranData, macet: boolean): string {
  if (k.terakhir === null || k.umurJam === null) return 'Waktu pembaruan data tidak terbaca.'
  if (waktuMasaDepan(k)) {
    return `Waktu data terakhir tercatat di masa depan (${labelWaktu(k.terakhir)}) — kemacetan tidak bisa dinilai.`
  }
  // Data Sales = baris BARU (created_at): updated_at tabel bisa lebih baru karena retry bridging.
  if (jenis === 'sales') {
    return macet
      ? `Tidak ada baris baru sejak ${labelWaktu(k.terakhir)} (${teksUmur(k.umurJam)}).`
      : `Baris baru terakhir ${labelWaktu(k.terakhir)} — normal.`
  }
  return macet
    ? `Belum diperbarui sejak ${labelWaktu(k.terakhir)} (${teksUmur(k.umurJam)}).`
    : `Data terakhir ${labelWaktu(k.terakhir)} — normal.`
}

export function ringkasSampel(
  d: { baru: number; terlambat: number } | { ditahanSejak: string | null } | { masaDepan: string }
): string {
  if ('masaDepan' in d) {
    return `Ditahan: waktu data TAT tercatat di masa depan (${labelWaktu(d.masaDepan)}) — kesegarannya tidak bisa dipastikan.`
  }
  if ('ditahanSejak' in d) {
    return d.ditahanSejak
      ? `Ditahan: data TAT belum diperbarui sejak ${labelWaktu(d.ditahanSejak)}.`
      : 'Ditahan: data TAT belum diperbarui.'
  }
  return `Sedang terlambat ${angkaId(d.terlambat)} sampel; ${angkaId(d.baru)} baru sejak pemeriksaan sebelumnya.`
}

export function ringkasSales(
  p:
    | PenilaianSales
    | { hasil: 'menunggu'; tanggal: string }
    | { hasil: 'masa_depan'; tanggal: string; terakhir: string }
): string {
  const tgl = labelTanggal(p.tanggal)
  if (p.hasil === 'menunggu') return `Menunggu sinkronisasi data ${tgl}.`
  if (p.hasil === 'masa_depan') {
    return `Waktu data Sales tercatat di masa depan (${labelWaktu(p.terakhir)}) — kelengkapan data ${tgl} tidak bisa dipastikan, belum dinilai.`
  }
  if (p.hasil === 'kurang_data') return `${tgl}: pembanding kurang dari ${SALES_MIN_PEMBANDING} hari — tidak dinilai.`
  const rN = persen(p.rasioNett ?? 0)
  const rO = persen(p.rasioOrder ?? 0)
  if (p.hasil === 'libur') return `${tgl}: order masuk hanya ${rO}% dari biasanya — dianggap libur.`
  if (p.hasil === 'berbunyi') return `${tgl}: ${rN}% dari biasanya — diberitahukan.`
  return `${tgl}: ${rN}% dari biasanya (order ${rO}%) — normal.`
}

/**
 * Kalimat aturan untuk Settings & Panduan — angkanya DARI KONSTANTA (aturan 61):
 * kalimat yang diketik tangan akan menyimpang dari kode tanpa ada yang tahu.
 */
export function kalimatAturan(id: PemicuId): string {
  const hari = definisi(id).hari.includes(6) ? 'Senin–Sabtu' : 'Senin–Jumat'
  switch (id) {
    case 'data_sales':
      return `Berbunyi bila tidak ada baris baru di data Sales lebih dari ${AMBANG_DATA_SALES_JAM} jam (jam hari Minggu tidak dihitung). Dicek tiap jam, ${hari} ${jam(JAM_MULAI)}–${jam(JAM_SELESAI)}.`
    case 'data_tat':
      return `Berbunyi bila data TAT Sample tidak diperbarui lebih dari ${AMBANG_DATA_TAT_JAM} jam. Dicek tiap jam, ${hari} ${jam(JAM_MULAI)}–${jam(JAM_SELESAI)}.`
    case 'sampel_terlambat':
      return (
        `Berbunyi bila ada sampel yang sudah diterima lab (maksimal ${LAB_UMUR_MAKS_HARI} hari) baru melewati batas ` +
        `wajar kategorinya: lebih lama dari ${persen(LAB_PERSENTIL)}% sampel sejenis yang selesai dalam ` +
        `${LAB_JENDELA_HARI} hari terakhir. Dicek sekali sehari mulai ${jam(LAB_JAM_PERIKSA)}, ${hari}; ditahan ` +
        'selama data TAT belum diperbarui.'
      )
    case 'sales_anjlok':
      return (
        `Berbunyi bila sales hari kerja terakhir (basis invoice) di bawah ${persen(SALES_RASIO_ANJLOK)}% dari median ` +
        `hari yang sama ${SALES_MINGGU_PEMBANDING} minggu sebelumnya, kecuali order masuk hari itu juga di bawah ` +
        `${persen(SALES_RASIO_LIBUR)}% (dianggap libur). Dicek mulai ${jam(SALES_JAM_PERIKSA)}, ${hari}; tiap hari ` +
        'dinilai sekali. Hari yang datanya belum lengkap saat diperiksa (biasanya Jumat — data Sabtu sering baru ' +
        `masuk sore) dinilai menyusul, paling jauh ${SALES_SUSULAN_HARI_KERJA} hari kerja ke belakang.`
      )
  }
}
