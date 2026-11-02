import { Pool } from 'pg'
import { BUNDLED } from '../bundled-config'
import { logger } from '../logger'

// Koneksi ke tabel login.
//
// ⚠️ Ini SATU-SATUNYA pool di aplikasi yang boleh menulis. Pool `sales/db.ts` dan
// `masterdata/db.ts` keduanya melayani query agregat yang ditulis manusia dan tidak
// pernah menulis apa pun. Pool ini menyentuh tiga tabel saja — tb_login_aira,
// tb_login_aira_log, tb_menu_akses_aira — dan tidak pernah dipakai tool mana pun:
// hanya kode login yang memanggilnya, model tidak punya jalan ke sini.
//
// ⚠️ TIDAK memakai `pool.connect()`. Cara itu sudah terbukti gagal di dalam
// Electron: `Connection terminated due to connection timeout` tepat di 10 detik,
// padahal dari proses Node biasa connect ke server yang sama hanya 120 ms
// (terukur 18 Agu 2026, tiga kali berturut-turut, lihat catatan di `sales/db.ts`).
// Semua query di sini lewat `pool.query()`.

const QUERY_TIMEOUT_MS = 15_000

let pool: Pool | null = null

export function loginDbConfigured(): boolean {
  return BUNDLED.loginDb.length > 0
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: BUNDLED.loginDb,
      // Satu cukup: semua query auth sudah diserialkan (`serialkan` di bawah),
      // jadi slot kedua tidak akan pernah terpakai — dan tiap slot yang dipegang
      // ikut memakan `max_connections` server yang hanya 100 untuk semua aplikasi.
      max: 1,
      connectionTimeoutMillis: 15_000,
      // Sama alasannya dengan `sales/db.ts`: koneksi menganggur TIDAK ditutup,
      // supaya aplikasi sesedikit mungkin membuka koneksi baru — bagian yang
      // terbukti rapuh di dalam Electron. `keepAlive` menjaga koneksi yang
      // dipegang lama tidak diputus diam-diam oleh firewall/NAT.
      idleTimeoutMillis: 0,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      statement_timeout: QUERY_TIMEOUT_MS
    })
    pool.on('error', (err) => logger().warn({ err: String(err) }, 'auth pool error'))
  }
  return pool
}

/**
 * Antrean serialisasi. Semua query auth berjalan SATU PER SATU.
 *
 * ⚠️ Ini bukan optimasi — ini penangkal kerapuhan yang sudah terdokumentasi:
 * membuat koneksi BARU di dalam main process Electron tidak bisa diandalkan
 * (lihat catatan `pool.connect()` di `sales/db.ts` dan HANDOFF). Selama pool hanya
 * memakai ulang koneksi yang sudah hidup, semuanya baik; begitu beberapa query
 * datang SERENTAK dan pool harus membuka koneksi kedua, sebagiannya gagal dengan
 * "timeout exceeded when trying to connect" lalu beruntun menjatuhkan sisanya.
 *
 * Terjadi nyata 19 Agu 2026: panel Settings menembakkan ~8 query bersamaan
 * (daftar user + konfigurasi akses + riwayat login) dan SELURUH panel tampil
 * kosong. Dari proses Node biasa, 8 query serentak pada pool `max: 2` yang sama
 * selesai dalam 80 ms — jadi ini murni perilaku di dalam Electron, bukan database
 * maupun ukuran pool.
 *
 * Diletakkan di sini, bukan di pemanggilnya, supaya tidak ada kode baru yang bisa
 * mengulangi kesalahan yang sama hanya dengan menulis satu `Promise.all` lagi.
 * Biayanya kecil: tiap query ~10 ms, dan lapisan ini hanya berjalan saat login
 * dan saat panel Super Admin dibuka.
 */
let antrean: Promise<unknown> = Promise.resolve()

function serialkan<T>(kerja: () => Promise<T>): Promise<T> {
  // `.then(kerja, kerja)` — bukan `.then(kerja)`: kalau query sebelumnya gagal,
  // antreannya tetap harus jalan. Tanpa itu satu kegagalan mengunci seluruh
  // antrean selamanya.
  const hasil = antrean.then(kerja, kerja)
  antrean = hasil.catch(() => undefined)
  return hasil
}

export async function authQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!loginDbConfigured()) {
    throw new Error('database login belum dikonfigurasi pada aplikasi ini')
  }
  const started = Date.now()
  try {
    const result = await serialkan(() => getPool().query(sql, params))
    logger().info({ ms: Date.now() - started, rows: result.rowCount }, 'auth query')
    return result.rows as T[]
  } catch (err) {
    // ⚠️ `err` TIDAK boleh ikut apa adanya kalau params memuat password — tapi
    // params di modul ini tidak pernah memuat password polos (yang dikirim ke
    // database selalu hash), jadi aman. Jangan ubah itu.
    logger().error({ ms: Date.now() - started, err: String(err) }, 'auth query gagal')
    throw err
  }
}

/**
 * Menjalankan beberapa statement sekaligus (DDL migrasi).
 *
 * pg mengizinkan multi-statement HANYA pada simple query — yaitu tanpa parameter.
 * Jadi migrasi tidak boleh membawa nilai dari luar; nilainya ditulis literal di
 * `schema.ts` dan semuanya konstanta. Ini juga alasan seed user memakai query
 * berparameter terpisah, bukan ditempel ke string DDL.
 */
export async function authExec(sql: string): Promise<void> {
  if (!loginDbConfigured()) {
    throw new Error('database login belum dikonfigurasi pada aplikasi ini')
  }
  await serialkan(() => getPool().query(sql))
}

export async function closeAuthPool(): Promise<void> {
  if (pool) await pool.end().catch(() => undefined)
  pool = null
}
