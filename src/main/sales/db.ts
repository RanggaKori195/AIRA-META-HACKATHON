import { Pool } from 'pg'
import { BUNDLED } from '../bundled-config'
import { assertLocalDb } from '../hackathon/local-db'
import { logger } from '../logger'
import { masalahKoneksi } from '../db-retry'

// Koneksi ke database penjualan. Read-only: semua query di modul sales adalah
// SELECT agregat yang ditulis manusia — model tidak pernah menyusun SQL sendiri.

const QUERY_TIMEOUT_MS = 20_000

/**
 * Batas untuk query berat yang jarang dipanggil (riwayat 12 bulan per pelanggan).
 * Terukur 18 Agu 2026: query itu 2–3 detik saat cache hangat, tapi **40 detik pada
 * pemanggilan pertama** karena membaca ~500 MB tabel dari disk. Dengan 20 detik,
 * pertanyaan pertama di pagi hari mati padahal querynya benar.
 */
const HEAVY_TIMEOUT_MS = 60_000

/*
 * Ukuran pool: SATU koneksi per pool.
 *
 * ⚠️ Bukan sekadar hemat. Terbukti 19 Agu 2026: yang rapuh di dalam Electron bukan
 * "membuka koneksi", melainkan **membuka beberapa koneksi BERSAMAAN**. Pada start
 * yang sama, pool auth (satu koneksi, berurutan) tersambung normal sementara
 * pemanasan sales yang menembakkan tiga permintaan sekaligus gagal seluruhnya —
 * masing-masing menggantung pas 15 detik. Dari proses Node biasa (tanpa Chromium),
 * enam pool serentak ke server yang sama selesai 334 ms; jadi ini perilaku khas
 * proses Electron yang menjalankan jendela, bukan database dan bukan jaringan.
 *
 * Dengan `max: 1`, pg mengantrekan query pada satu koneksi yang dibuka sekali di
 * awal dan tidak pernah ditutup. Tidak pernah ada lagi pembukaan koneksi serentak.
 * Cukup: orchestrator menjalankan tool secara berurutan, jadi query yang benar-benar
 * bersamaan dari satu orang hampir tidak ada.
 *
 * Bonusnya di sisi server: `max_connections` hanya 100 untuk SEMUA aplikasi, dan
 * karena koneksi tidak pernah ditutup, tiap AIRA yang terbuka menahan slotnya
 * selama aplikasi hidup. Tiga slot per orang, bukan delapan.
 */
const POOL_MAX = 1
const HEAVY_POOL_MAX = 1

let pool: Pool | null = null
let heavyPool: Pool | null = null

export function salesDbConfigured(): boolean {
  return BUNDLED.salesDb.length > 0
}

function buatPool(statementTimeout: number, max: number): Pool {
  assertLocalDb(BUNDLED.salesDb, 'AIRA_SALES_DB')
  const p = new Pool({
    connectionString: BUNDLED.salesDb,
    max,
    connectionTimeoutMillis: 15_000,
    /*
     * ⚠️ 0 = koneksi menganggur TIDAK pernah ditutup. Ini bukan penghematan,
     * melainkan menghindari membuka koneksi baru sesering mungkin.
     *
     * Dulu 30 detik, dan itu berarti hampir SETIAP pertanyaan user harus membuka
     * koneksi baru — orang tidak bertanya tiap setengah menit. Terukur 19 Agu 2026:
     * empat pertanyaan beruntun berhasil, lalu aplikasi menganggur 66 detik, dan
     * pertanyaan berikutnya gagal TIGA KALI ("Connection terminated due to
     * connection timeout", masing-masing pas 15 detik) sebelum akhirnya berhasil
     * sendiri. Yang dilihat user: AIRA bilang "panggilan pertama gagal, saya coba
     * lagi" lalu menempuh jalan memutar lewat tool lain.
     *
     * Dipasangkan dengan `keepAlive` di bawah: tanpa itu, koneksi yang dipegang
     * lama bisa diputus diam-diam oleh firewall/NAT dan baru ketahuan saat dipakai.
     */
    idleTimeoutMillis: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Lindungi database produksi dari query yang menggantung.
    statement_timeout: statementTimeout
  })
  p.on('error', (err) => logger().warn({ err: String(err) }, 'sales pool error'))
  return p
}

function getPool(): Pool {
  if (!pool) pool = buatPool(QUERY_TIMEOUT_MS, POOL_MAX)
  return pool
}

/**
 * Pool terpisah untuk query berat.
 *
 * ⚠️ Sengaja TIDAK memakai `pool.connect()` + `SET statement_timeout` pada satu client.
 * Cara itu sempat dipakai dan GAGAL di dalam Electron: `connect()` selalu berakhir
 * "Connection terminated due to connection timeout" setelah 10 detik, padahal dari
 * proses Node biasa connect ke server yang sama hanya 120 ms (terukur 18 Agu 2026,
 * tiga kali berturut-turut). Jalur `pool.query()` terbukti bekerja, jadi batas waktunya
 * dipasang sebagai opsi pool — bukan lewat client yang dipegang sendiri.
 */
function getHeavyPool(): Pool {
  if (!heavyPool) heavyPool = buatPool(HEAVY_TIMEOUT_MS, HEAVY_POOL_MAX)
  return heavyPool
}

/**
 * `heavy: true` mengarahkan query ke pool dengan batas waktu lebih longgar.
 * Dipakai oleh query yang memang berat dan jarang dipanggil.
 */
/**
 * Keadaan koneksi TERAKHIR yang teramati dari query sungguhan (panel "Sumber
 * Data" di layar Tanya Data Sales).
 *
 * ⚠️ Sengaja TIDAK membuka koneksi sendiri untuk "cek status": membuka koneksi
 * database bersamaan dari main process adalah akar tiga bug lama (lihat CLAUDE.md
 * "Jangan pernah membuka BEBERAPA koneksi database BERSAMAAN"). Yang dilaporkan
 * adalah apa yang terakhir TERJADI, lengkap dengan jamnya — bukan tebakan.
 * `statement_timeout` dihitung TERHUBUNG: servernya menjawab, query-nya yang berat.
 */
let keadaanTerakhir: { terhubung: boolean; waktu: number } | null = null

export function statusKoneksiSales(): {
  terkonfigurasi: boolean
  keadaan: 'terhubung' | 'gagal' | 'belum'
  waktu: number | null
} {
  if (!salesDbConfigured()) return { terkonfigurasi: false, keadaan: 'belum', waktu: null }
  if (!keadaanTerakhir) return { terkonfigurasi: true, keadaan: 'belum', waktu: null }
  return {
    terkonfigurasi: true,
    keadaan: keadaanTerakhir.terhubung ? 'terhubung' : 'gagal',
    waktu: keadaanTerakhir.waktu
  }
}

export async function salesQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[],
  opts?: { heavy?: boolean }
): Promise<T[]> {
  if (!salesDbConfigured()) {
    throw new Error('database penjualan belum dikonfigurasi pada aplikasi ini')
  }
  const started = Date.now()
  const berat = opts?.heavy === true
  const jalankan = async (): Promise<T[]> => {
    try {
      const result = await (berat ? getHeavyPool() : getPool()).query(sql, params)
      keadaanTerakhir = { terhubung: true, waktu: Date.now() }
      return result.rows as T[]
    } catch (err) {
      keadaanTerakhir = { terhubung: !masalahKoneksi(err), waktu: Date.now() }
      throw err
    }
  }

  try {
    const rows = await jalankan()
    logger().info({ ms: Date.now() - started, rows: rows.length, berat }, 'sales query')
    return rows
  } catch (err) {
    /*
     * Sekali coba lagi, HANYA untuk kegagalan mendapatkan koneksi.
     *
     * Jaring pengaman untuk koneksi pertama sesudah aplikasi start, dan untuk
     * koneksi yang diputus diam-diam di jaringan. Tanpa ini, kegagalan sesaat
     * sampai ke model sebagai "tool error" — dan model lalu menempuh jalan memutar
     * yang menghasilkan angka dari tool yang berbeda, persis yang terjadi 19 Agu 2026.
     *
     * `statement_timeout` sengaja TIDAK diulang (lihat `masalahKoneksi`): query
     * yang kelamaan memang berat, dan mengulanginya menggandakan beban database
     * produksi tanpa peluang berhasil.
     */
    if (masalahKoneksi(err)) {
      logger().warn(
        { ms: Date.now() - started, berat, err: String(err) },
        'sales query gagal karena koneksi, mencoba sekali lagi'
      )
      try {
        const rows = await jalankan()
        logger().info({ ms: Date.now() - started, rows: rows.length, berat }, 'sales query (percobaan ke-2)')
        return rows
      } catch (err2) {
        logger().error({ ms: Date.now() - started, berat, err: String(err2) }, 'sales query gagal (2x)')
        throw err2
      }
    }
    // Lama gagalnya ikut dicatat — membedakan "tidak dapat koneksi" (gagal cepat di
    // batas connectionTimeoutMillis) dari "query kelamaan" (gagal di statement_timeout).
    logger().error({ ms: Date.now() - started, berat, err: String(err) }, 'sales query gagal')
    throw err
  }
}

/**
 * Membuka koneksi pertama di latar belakang saat aplikasi start.
 *
 * Memindahkan satu-satunya percobaan koneksi yang paling rawan — yang pertama —
 * dari "saat user menunggu jawaban" ke "saat aplikasi baru dibuka". Kegagalannya
 * cukup dicatat di log; user tidak perlu diberi tahu apa pun karena ia belum
 * meminta apa-apa.
 */
export function hangatkanSalesPool(): void {
  if (!salesDbConfigured()) return
  // BERURUTAN, bukan bersamaan — membuka dua koneksi sekaligus persis yang gagal.
  // Keduanya dibuka sekali di sini lalu dipakai ulang seumur aplikasi.
  void (async () => {
    await salesQuery('SELECT 1', []).catch(() => undefined)
    await salesQuery('SELECT 1', [], { heavy: true }).catch(() => undefined)
  })()
}

export async function closeSalesPool(): Promise<void> {
  for (const p of [pool, heavyPool]) {
    if (p) await p.end().catch(() => undefined)
  }
  pool = null
  heavyPool = null
}
