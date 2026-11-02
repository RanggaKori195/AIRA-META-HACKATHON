import type { AksiPemantau } from '@shared/ipc'

// Pembantu MURNI kartu Pemantau (20 Okt 2026) — diuji di tests/pemantau.test.ts.
// Hanya impor TIPE dari alias `@shared`; nilai wajib lewat path relatif (tsx tidak
// membaca alias).

/**
 * Apakah aksi klik notifikasi/riwayat boleh dijalankan untuk menu yang dimiliki
 * sesi saat ini. Ini KENYAMANAN: main tetap menolak `chatSend` tanpa izin. Tanpa
 * pemeriksaan ini, klik riwayat lama sesudah menu dicabut membuka layar menu yang
 * kotak tanyanya pasti ditolak.
 */
export function aksiBoleh(aksi: AksiPemantau, menu: readonly string[]): boolean {
  return aksi.tujuan === 'panel' || menu.includes(aksi.mode)
}

/**
 * Gulir ke kartu Pemantau SEKALI per aktivasi `fokus` (Settings dibuka dari klik
 * notifikasi), begitu kartunya termuat. Status yang dimuat ulang sesudahnya — detak di
 * latar, saklar, "Periksa sekarang" — tidak menggulir lagi: dulu halaman melompat kembali
 * ke kartu walau user sedang membaca bagian lain (temuan review akhir 20 Okt 2026).
 * `fokus` padam = aktivasi berikutnya menggulir lagi. `sudah` = keadaan ref di kartu.
 */
export function langkahGulir(sudah: boolean, fokus: boolean, termuat: boolean): { gulir: boolean; sudah: boolean } {
  if (!fokus) return { gulir: false, sudah: false }
  if (sudah || !termuat) return { gulir: false, sudah }
  return { gulir: true, sudah: true }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dua = (n: number): string => String(n).padStart(2, '0')
const hariSama = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "today 10:32" | "yesterday 09:05" | "Sat Oct 17 10:00" — jam laptop. */
export function waktuRingkas(ms: number, sekarang: number): string {
  const d = new Date(ms)
  const clock = `${dua(d.getHours())}:${dua(d.getMinutes())}`
  const kini = new Date(sekarang)
  if (hariSama(d, kini)) return `today ${clock}`
  const kemarin = new Date(kini)
  kemarin.setDate(kemarin.getDate() - 1)
  if (hariSama(d, kemarin)) return `yesterday ${clock}`
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`
}
