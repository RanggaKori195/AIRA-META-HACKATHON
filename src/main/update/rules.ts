// Aturan auto-update AIRA — modul MURNI (tanpa Electron), supaya keputusan
// "boleh cek ke mana" dan "galat ini artinya apa" bisa diuji tanpa build.
//
// Latar (17 Sep 2026): memasang ulang installer di laptop karyawan the company itu
// repot (KAV, antivirus korporat). AIRA terpasang PER-USER (`perMachine: false`),
// jadi pembaruan tidak butuh hak admin — cukup server berkas statis berisi
// `latest.yml`, installer `.exe`, dan `.blockmap`.

/**
 * Alamat server update bawaan.
 *
 * ⚠️ HARUS SAMA dengan `publish.url` di `electron-builder.yml` — test
 * `update.test.ts` memeriksanya. Keduanya berbeda = `latest.yml` dibuat untuk
 * satu alamat sementara aplikasi mengecek alamat lain, dan hasilnya "tidak ada
 * update" selamanya, tanpa satu pun galat.
 */
export const URL_UPDATE_BAWAAN = 'https://updates.invalid/aira/'

/** Pemeriksaan berkala. Rilis AIRA tidak terjadi tiap jam. */
export const JEDA_CEK_MS = 4 * 60 * 60 * 1000

/** Pemeriksaan pertama sesudah start — detik awal milik login & migrasi skema. */
export const TUNDA_CEK_AWAL_MS = 60_000

/**
 * Alamat update yang sah, atau null (fitur mati).
 *
 * ⚠️ WAJIB HTTPS. `latest.yml` membawa hash SHA-512 installer, dan hash itu
 * datang dari server yang SAMA dengan installernya. Lewat HTTP biasa, siapa pun
 * di jaringan yang sama bisa menukar keduanya sekaligus — dan AIRA akan
 * memasang program apa pun yang diberikan, di setiap laptop, tanpa bertanya.
 * Satu-satunya pengecualian: localhost, untuk menguji di laptop pengembang.
 */
export function urlUpdateSah(mentah: string | null | undefined): string | null {
  const teks = (mentah ?? '').trim()
  if (teks.length === 0) return null
  let url: URL
  try {
    url = new URL(teks)
  } catch {
    return null
  }
  const lokal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && lokal)) return null
  if (url.username || url.password) return null
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

export type TahapUpdate =
  | 'mati'
  | 'diam'
  | 'memeriksa'
  | 'mengunduh'
  | 'siap'
  | 'terbaru'
  | 'galat'

/**
 * Menerjemahkan galat electron-updater jadi kalimat yang bisa ditindaklanjuti.
 *
 * ⚠️ Kegagalan update itu SUNYI dari sisi user: aplikasinya tetap jalan, hanya
 * versinya tertinggal. Tanpa kalimat yang jelas, "diblokir antivirus" dan
 * "server belum ada" terlihat sama — dan yang kedua bukan urusan IT security.
 */
export function terjemahkanGalatUpdate(err: unknown): string {
  const teks = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : String(err)
  const t = teks.toLowerCase()
  if (/enotfound|eai_again|getaddrinfo/.test(t)) {
    return 'Server update tidak ditemukan (nama domain belum terdaftar atau di luar jaringan).'
  }
  if (/econnrefused|etimedout|econnreset|socket hang up|net::err_/.test(t)) {
    return 'Server update tidak terjangkau. Pastikan tersambung ke jaringan.'
  }
  if (/cert|self[- ]signed|unable to verify|ssl|tls/.test(t)) {
    return 'Sertifikat HTTPS server update ditolak. Perlu diperiksa tim IT.'
  }
  if (/\b404\b|cannot find latest|latest\.yml/.test(t)) {
    return 'Belum ada rilis di server update (berkas latest.yml tidak ditemukan).'
  }
  if (/sha512|checksum|mismatch/.test(t)) {
    return 'Berkas update yang terunduh tidak cocok dengan yang diumumkan server, jadi TIDAK dipasang. Kemungkinan unduhan rusak atau berkas di server belum lengkap.'
  }
  if (/eperm|eacces|ebusy|virus|operation did not complete successfully/.test(t)) {
    return 'Berkas update diblokir di laptop ini — kemungkinan besar oleh antivirus (KAV). Minta tim IT memasukkan AIRA ke daftar pengecualian.'
  }
  if (/not signed|publisher|signature/.test(t)) {
    return 'Tanda tangan digital installer update tidak cocok, jadi TIDAK dipasang.'
  }
  return 'Pembaruan gagal. Detailnya tercatat di log AIRA.'
}

/** Perbandingan versi x.y.z sederhana — hanya untuk tampilan, bukan keputusan pasang. */
export function lebihBaru(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
