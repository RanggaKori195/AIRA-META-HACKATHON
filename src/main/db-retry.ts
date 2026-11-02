// Membedakan "gagal mendapat koneksi" dari "query-nya sendiri bermasalah".
//
// Modul murni — tidak menyentuh pg maupun Electron — supaya bisa diuji langsung.
//
// Latar belakangnya: membuka koneksi BARU dari main process Electron tidak bisa
// diandalkan. Sudah terlihat tiga kali di project ini:
//   1. `pool.connect()` selalu timeout di 10 detik (18 Agu 2026)
//   2. ~8 query auth serentak membuat panel Settings tampil kosong (19 Agu 2026)
//   3. `sales_summary` gagal tiga kali beruntun sesudah aplikasi menganggur
//      ~66 detik, lalu berhasil sendiri (19 Agu 2026)
// Ketiganya dari proses Node biasa ke server yang sama: 20–200 ms, selalu berhasil.

/**
 * Pesan galat yang menandakan masalah MENDAPATKAN koneksi, bukan masalah query.
 *
 * Dicocokkan pada teks pesan, bukan pada kelas error: pg melempar `Error` biasa
 * untuk kasus-kasus ini, dan `code`-nya tidak konsisten antar jalur kegagalan.
 */
const POLA_KONEKSI = [
  'connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'connection terminated unexpectedly',
  'connection ended unexpectedly',
  'econnreset',
  'econnrefused',
  'epipe',
  'socket hang up'
]

/**
 * Apakah kegagalan ini layak dicoba ulang.
 *
 * ⚠️ `statement_timeout` SENGAJA tidak termasuk. Query yang kelamaan berarti
 * memang berat; mengulanginya menggandakan beban di database produksi dan hampir
 * pasti gagal lagi dengan cara yang sama. Yang diulang hanya kegagalan
 * mendapatkan koneksi — itu terbukti berhasil pada percobaan berikutnya.
 */
export function masalahKoneksi(err: unknown): boolean {
  const pesan = String((err as { message?: string })?.message ?? err).toLowerCase()
  if (pesan.includes('statement timeout') || pesan.includes('canceling statement')) return false
  return POLA_KONEKSI.some((p) => pesan.includes(p))
}
