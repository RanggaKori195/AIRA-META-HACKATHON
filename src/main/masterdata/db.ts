import { Pool } from 'pg'
import { BUNDLED } from '../bundled-config'
import { logger } from '../logger'
import { assertLocalDb } from '../hackathon/local-db'
import { INNO_PG_TYPES, toPgPlaceholders } from './sql-dialect'

// HACKATHON COPY: Master Data runs on the local dummy Postgres (schema `inno`), not MariaDB.
// The rules below still hold: read-only, human-written queries, a server-side statement timeout,
// one connection (same rule as every other pool — see CLAUDE.md on concurrent connections).

// Koneksi ke master data the lab (`inno_collection`, MariaDB 10.4 di 10.0.0.10).
// Read-only: semua query di modul ini SELECT yang ditulis & diuji manusia.
//
// ⚠️ Server ini melayani APLIKASI PRODUKSI lain (Master Data). Query berat dari AIRA
// bisa mengganggu pemakai sungguhan — terbukti 18 Agu 2026 saat satu query agregat
// tanpa index berjalan >16 menit dan memblokir antrean, dan tetap hidup di server
// walau prosesnya sudah dimatikan di sisi klien.
//
// Dua rem yang wajib ada:
//   1. `max_statement_time` (MariaDB) — server sendiri yang membunuh query kelamaan.
//      Hint MySQL `MAX_EXECUTION_TIME` TIDAK berlaku di MariaDB, jangan dipakai.
//   2. Semua query tool memakai kolom ber-index dan LIMIT.

const STATEMENT_TIMEOUT_MS = 20_000

let pool: Pool | null = null

export function innoDbConfigured(): boolean {
  return BUNDLED.innoDb.length > 0
}

function getPool(): Pool {
  if (!pool) {
    assertLocalDb(BUNDLED.innoDb, 'AIRA_INNO_DB')
    pool = new Pool({
      connectionString: BUNDLED.innoDb,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 0,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      options: '-c search_path=inno',
      // Dates as strings + NUMERIC as numbers, like mysql2 — scoped to this pool (sql-dialect.ts).
      types: INNO_PG_TYPES
    })
    pool.on('error', (err) => logger().warn({ err: String(err) }, 'inno pool error'))
  }
  return pool
}

/**
 * Keadaan koneksi TERAKHIR yang teramati dari query sungguhan (panel "Sumber
 * Data" di layar Ask Master Data). Sengaja tidak membuka koneksi sendiri —
 * server MariaDB ini dipakai aplikasi produksi (aturan 14). Batas waktu query
 * (`max_statement_time`) dihitung TERHUBUNG: servernya menjawab.
 */
let keadaanTerakhir: { terhubung: boolean; waktu: number } | null = null

const KODE_PUTUS = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|Connection terminated|connect/i
/** Postgres statement timeout (57014): the server answered, so it counts as connected. */
const KODE_TIMEOUT = '57014'

export function statusKoneksiInno(): {
  terkonfigurasi: boolean
  keadaan: 'terhubung' | 'gagal' | 'belum'
  waktu: number | null
} {
  if (!innoDbConfigured()) return { terkonfigurasi: false, keadaan: 'belum', waktu: null }
  if (!keadaanTerakhir) return { terkonfigurasi: true, keadaan: 'belum', waktu: null }
  return { terkonfigurasi: true, keadaan: keadaanTerakhir.terhubung ? 'terhubung' : 'gagal', waktu: keadaanTerakhir.waktu }
}

export async function innoQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!innoDbConfigured()) {
    throw new Error('database Master Data belum dikonfigurasi pada aplikasi ini')
  }
  const started = Date.now()
  let rows: unknown
  try {
    rows = (await getPool().query(toPgPlaceholders(sql), params)).rows
    keadaanTerakhir = { terhubung: true, waktu: Date.now() }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    const putus = e.code !== KODE_TIMEOUT && KODE_PUTUS.test(`${e.code ?? ''} ${e.message ?? ''}`)
    keadaanTerakhir = { terhubung: !putus, waktu: Date.now() }
    throw err
  }
  const list = (Array.isArray(rows) ? rows : []) as T[]
  logger().info({ ms: Date.now() - started, rows: list.length }, 'inno query')
  return list
}

export async function closeInnoPool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined)
    pool = null
  }
}
