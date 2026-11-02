// Aturan murni untuk data TAT sampel (`public.v_sample_tracker`).
//
// Modul ini SENGAJA tidak menyentuh database maupun Electron supaya bisa diuji
// penuh. Semua keputusan yang mudah salah — kolom mana yang boleh keluar, tahap
// mana yang sah dihitung, dari mana umur backlog diukur — lahir di sini, satu
// tempat, bukan tersebar di string SQL.

/**
 * ⚠️ DAFTAR-IZIN KOLOM. Yang tidak ada di sini TIDAK PERNAH keluar dari tool.
 *
 * Aturan 3 project melarang tool mengembalikan baris mentah, karena
 * `SalesRepository` memuat `dob`, `clin_diagnosis`, `pa_diagnosis`, `result`.
 * `v_sample_tracker` berbeda: seluruh kolomnya operasional KECUALI `patient`.
 * Karena itu tool lab boleh mengembalikan baris per sampel — dengan syarat
 * `patient` tidak pernah ikut.
 *
 * Ditegakkan sebagai daftar-izin, bukan daftar-larangan. Kolom baru yang muncul
 * di view (ETL berubah, kolom PII ditambahkan) otomatis TIDAK ikut, alih-alih
 * otomatis bocor. Arah kegagalannya dipilih sadar.
 */
export const KOLOM_AMAN = [
  'unique_key',
  'order_id',
  'category',
  'account',
  'payer_name',
  'price_type',
  'item_code',
  'test',
  'qty',
  'is_rns',
  'sample_status',
  'source_system',
  'order_created_at',
  'order_validated_at',
  'lab_sample_received_at',
  'rns_at',
  'new_sample_received_date',
  'preparation_started_at',
  'preparation_completed_at',
  'pathology_completed_at',
  'result_created_at',
  'result_validated_at',
  'date_result',
  'canceled_at',
  'notes',
  'last_updated_at'
] as const

export type KolomAman = (typeof KOLOM_AMAN)[number]

/** Kolom yang dilarang keluar walau ada di view. */
export const KOLOM_TERLARANG = ['patient'] as const

export function kolomBoleh(nama: string): boolean {
  return (KOLOM_AMAN as readonly string[]).includes(nama)
}

/**
 * Menyaring daftar kolom yang diminta jadi hanya yang boleh.
 * Melempar bila ada yang terlarang — diam-diam membuang justru menyembunyikan
 * niat pemanggil yang keliru.
 */
export function pastikanKolomAman(kolom: readonly string[]): void {
  const nakal = kolom.filter((k) => !kolomBoleh(k))
  if (nakal.length > 0) {
    throw new Error(
      `kolom tidak diizinkan keluar dari tool lab: ${nakal.join(', ')}. ` +
        'Kolom identitas pasien tidak pernah disajikan.'
    )
  }
}

// --------------------------------------------------------------- pengakuan

/**
 * Baris yang diakui. Sampel yang dibatalkan bukan backlog dan bukan bahan TAT —
 * setara `RECOGNIZED_CLAUSE` di sales. Terukur 393 dari 29.050 baris.
 */
export const DIAKUI_CLAUSE = 'canceled_at IS NULL'

/** Backlog = diakui, dan hasilnya belum keluar. */
export const BACKLOG_CLAUSE = `${DIAKUI_CLAUSE} AND date_result IS NULL`

// ------------------------------------------------------------------ tahapan

export interface Tahap {
  kode: string
  label: string
  dari: KolomAman
  ke: KolomAman
  /**
   * `false` bila tahap ini hanya berlaku pada sebagian kategori. Hasil tool WAJIB
   * menyebutkannya, kalau tidak nol dibaca sebagai temuan.
   */
  universal: boolean
  /**
   * `hari` = hanya boleh dihitung dalam hari kalender.
   *
   * ⚠️ `order_validated_at` SELALU tengah malam — terukur 29.050 dari 29.050
   * baris berjam `00:00:00`. Menghitungnya dalam jam membuat 19.441 baris (67%)
   * bernilai NEGATIF, terparah −18,5 jam, karena order dibuat pukul 08:10 lalu
   * "divalidasi" pukul 00:00 hari yang sama. Angka negatif yang dirata-ratakan
   * menghasilkan laporan yang meyakinkan dan salah.
   */
  ketelitian: 'jam' | 'hari'
}

export const TAHAPAN: readonly Tahap[] = [
  {
    kode: 'order_ke_validasi',
    label: 'Order dibuat → order divalidasi',
    dari: 'order_created_at',
    ke: 'order_validated_at',
    universal: true,
    ketelitian: 'hari'
  },
  {
    kode: 'validasi_ke_terima',
    label: 'Order divalidasi → sampel diterima lab',
    dari: 'order_validated_at',
    ke: 'lab_sample_received_at',
    universal: true,
    ketelitian: 'hari'
  },
  {
    kode: 'terima_ke_preparasi',
    label: 'Sampel diterima → preparasi mulai',
    dari: 'lab_sample_received_at',
    ke: 'preparation_started_at',
    universal: true,
    ketelitian: 'jam'
  },
  {
    kode: 'preparasi',
    label: 'Preparasi mulai → preparasi selesai',
    dari: 'preparation_started_at',
    ke: 'preparation_completed_at',
    universal: true,
    ketelitian: 'jam'
  },
  {
    kode: 'patologi',
    label: 'Preparasi selesai → patologi selesai',
    dari: 'preparation_completed_at',
    ke: 'pathology_completed_at',
    // Terukur: HPV DNA & LBC 0 dari 8.999; Histologi 41%; Molekuler 17%.
    universal: false,
    ketelitian: 'jam'
  },
  {
    kode: 'hasil_dibuat',
    label: 'Hasil mulai dibuat → hasil divalidasi analis',
    dari: 'result_created_at',
    ke: 'result_validated_at',
    universal: true,
    ketelitian: 'jam'
  },
  {
    kode: 'hasil_ke_kirim',
    label: 'Hasil divalidasi → hasil keluar ke pelanggan',
    dari: 'result_validated_at',
    ke: 'date_result',
    universal: true,
    ketelitian: 'jam'
  },
  {
    kode: 'total',
    label: 'TOTAL: sampel diterima lab → hasil keluar',
    dari: 'lab_sample_received_at',
    ke: 'date_result',
    universal: true,
    ketelitian: 'jam'
  }
]

export function tahapDari(kode: string): Tahap | null {
  return TAHAPAN.find((t) => t.kode === kode) ?? null
}

/**
 * Ekspresi lama tahap dalam HARI.
 *
 * Untuk tahap ber-ketelitian `hari`, keduanya dipotong ke tanggal lebih dulu.
 * Itu membuang jam yang memang tidak pernah ada, alih-alih memakainya dan
 * menghasilkan angka negatif.
 */
export function ekspresiLama(tahap: Tahap): string {
  if (tahap.ketelitian === 'hari') {
    return `(${tahap.ke}::date - ${tahap.dari}::date)::numeric`
  }
  return `(EXTRACT(EPOCH FROM (${tahap.ke} - ${tahap.dari})) / 86400.0)::numeric`
}

// -------------------------------------------------------------- umur backlog

/**
 * Jangkar umur backlog, BERJENJANG.
 *
 * ⚠️ Status `Order Validated by IP` (58 baris) belum punya
 * `lab_sample_received_at` — sampelnya memang belum sampai lab. Mengukur umur
 * dari kolom itu saja membuat baris-baris tersebut bernilai NULL dan HILANG
 * DIAM-DIAM dari laporan backlog. Justru mereka yang paling perlu dilihat:
 * order sudah divalidasi tapi sampelnya tidak kunjung datang.
 */
export const JANGKAR_UMUR = 'COALESCE(lab_sample_received_at, order_validated_at, order_created_at)'

/** Nama jangkar yang dipakai, untuk disebut di hasil tool. */
export const JANGKAR_UMUR_LABEL =
  'umur dihitung sejak sampel diterima lab; bila sampelnya belum diterima, ' +
  'sejak order divalidasi; bila itu pun kosong, sejak order dibuat'

// --------------------------------------------------------------------- RNS

/**
 * RNS = Retake New Sample — sampel harus diambil ulang (ketentuan pemilik data
 * 27 Agu 2026). `rns_at` = kapan diputuskan RNS. `new_sample_received_date` =
 * kapan sampel penggantinya diterima.
 *
 * ⚠️ Terukur: dari 327 RNS hanya 99 yang penggantinya sudah datang, 204 masih
 * menunggu, dan 24 hasilnya keluar tanpa catatan sampel pengganti. Tool WAJIB
 * memisahkan ketiganya — "jumlah RNS" saja menyembunyikan bahwa dua pertiganya
 * menggantung.
 */
export const RNS_MENUNGGU_CLAUSE =
  'is_rns = true AND new_sample_received_date IS NULL AND canceled_at IS NULL AND date_result IS NULL'

/**
 * Peringkat RNS punya DUA arti, dan keduanya wajib disajikan.
 *
 * ⚠️ Terukur 27 Agu 2026: per jumlah, EGFR teratas (75 kali, 4,69%). Per
 * persentase, MammaPrint jauh lebih parah (7 dari 40 = 17,50%) tapi tidak akan
 * pernah muncul di sepuluh besar berbasis jumlah. Menyajikan salah satunya saja
 * berarti menyembunyikan pemeriksaan yang paling sering gagal.
 */
export type UrutRns = 'jumlah' | 'persen'

/**
 * Ambang jumlah minimum sebelum persentase layak diperingkat.
 * Tanpa ini, satu pemeriksaan bervolume 2 yang sekali RNS tampil sebagai "50%".
 */
export const MIN_VOLUME_PERSEN = 20

// ------------------------------------------------------------- catatan hasil

/**
 * Kalimat pertanggungjawaban hasil — TIDAK PERNAH kosong, dan berupa KALIMAT.
 *
 * Pelajaran yang sudah dibayar berkali-kali di project ini (HANDOFF §7):
 * `read_file` mengembalikan `truncated: false` dan model TETAP mengarang cerita
 * tentang bagian yang terpotong; `inno_item_search` mengembalikan `jumlah: 50`
 * tanpa menyebut 499 sisanya dan model mengisi kekosongan itu dengan
 * "terpotong oleh sistem". Bendera boolean tidak menahan apa pun.
 */
export function catatanDaftar(
  ditampilkan: number,
  total: number,
  konteks: string
): string {
  if (total === 0) {
    return `Tidak ada satu pun baris yang cocok untuk ${konteks}. Ini hasil nyata dari database, bukan pemotongan — jangan menyebut data terpotong atau tidak lengkap.`
  }
  if (ditampilkan >= total) {
    return `Seluruh ${total} baris untuk ${konteks} ditampilkan di sini, tidak ada yang dipotong maupun disembunyikan.`
  }
  return `Ditampilkan ${ditampilkan} baris teratas dari total ${total} baris untuk ${konteks}. Sisanya ${total - ditampilkan} baris TIDAK ikut — sebutkan angka itu ke user bila relevan, dan jangan mengarang jumlah lain.`
}

/** Catatan kesegaran data. ETL, bukan real-time. */
export function catatanKesegaran(terakhir: string | null): string {
  if (!terakhir) {
    return 'Waktu pembaruan data tidak terbaca — jangan mengaku data ini real-time.'
  }
  return `Data berasal dari tabel hasil ETL, terakhir diperbarui ${terakhir}. Sebutkan waktu itu bila user menanyakan kesegaran data; jangan menyebutnya real-time.`
}

/** Catatan untuk tahap yang tidak berlaku di semua kategori. */
export function catatanTahap(tahap: Tahap): string {
  const dasar =
    tahap.ketelitian === 'hari'
      ? `Tahap "${tahap.label}" hanya dihitung dalam HARI KALENDER karena ${tahap.dari === 'order_validated_at' || tahap.ke === 'order_validated_at' ? 'order_validated_at tidak menyimpan jam (selalu 00:00)' : 'sumbernya tidak menyimpan jam'}. Jangan menyajikannya dalam jam atau menit.`
      : `Tahap "${tahap.label}" dihitung dari selisih waktu penuh.`
  if (tahap.universal) return dasar
  return (
    dasar +
    ' ⚠️ Tahap ini TIDAK berlaku untuk semua kategori — banyak pemeriksaan memang tidak melewatinya' +
    ' (mis. HPV DNA & LBC tidak pernah punya tahap patologi). Baris tanpa tahap ini bukan data hilang' +
    ' dan bukan keterlambatan; jangan melaporkannya sebagai temuan.'
  )
}

/**
 * Catatan pembeda order vs baris.
 *
 * ⚠️ Satu `order_id` bisa memuat beberapa pemeriksaan — terukur 25.716 order
 * untuk 29.050 baris. Dulu di sales dua angka seperti ini pernah dikirim sebagai
 * satu angka bernama "transaksi" dan selisihnya 22%.
 */
export function catatanOrderVsBaris(order: number, baris: number): string {
  if (order === baris) {
    return `${baris} baris pemeriksaan, dan kebetulan berasal dari ${order} order berbeda (satu order satu pemeriksaan).`
  }
  return `${baris} baris pemeriksaan dari ${order} order berbeda — satu order bisa memuat beberapa pemeriksaan. Jangan menyebut keduanya dengan istilah yang sama.`
}
