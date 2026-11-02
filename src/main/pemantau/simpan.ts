// Penyimpanan pemantau proaktif: penanda anti-ulang & riwayat peringatan di SQLite
// LOKAL (migrasi 15), saklar per user di config (pola `chatSenyap`).
//
// ⚠️ Modul MURNI: koneksi & saklar diterima dari luar (`nyata.ts`), supaya SQL di
// sini diuji SUNGGUHAN di `node:sqlite` — better-sqlite3 aplikasi dibangun untuk
// Electron dan tidak bisa dibuka dari test.
// ⚠️ Milik ORANG, bukan laptop (aturan 16): `username` (huruf kecil) ada di KLAUSA
// WHERE setiap baca/tulis. Laptop dipakai bergantian; penanda & riwayat Direktur
// tidak boleh terbaca atau tertimpa oleh orang yang login sesudahnya.

import type { AksiPemantau, HasilPemicu, ItemRiwayatPemantau, PemicuId } from '../../shared/ipc'
import { MAKS_RIWAYAT, type Penanda } from './rules'

/** Migrasi 15 (`db.ts`). Penanda per username × pemicu; riwayat dipangkas per user. */
export const DDL_PEMANTAU = `
  CREATE TABLE pemantau_penanda (
    username  TEXT NOT NULL,
    pemicu    TEXT NOT NULL,
    nilai     TEXT,
    diperiksa INTEGER,
    status    TEXT,
    PRIMARY KEY (username, pemicu)
  );
  CREATE TABLE pemantau_riwayat (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    pemicu   TEXT NOT NULL,
    judul    TEXT NOT NULL,
    isi      TEXT NOT NULL,
    aksi     TEXT NOT NULL,
    dibuat   INTEGER NOT NULL
  );
  CREATE INDEX idx_pemantau_riwayat ON pemantau_riwayat(username, id DESC);
  `

/** Hasil pemeriksaan terakhir yang ditampilkan panel Settings. */
export interface StatusTersimpan {
  hasil: HasilPemicu
  ringkas: string
  tidakDipantau?: string[]
}

export interface PenandaTersimpan extends Penanda {
  status: StatusTersimpan | null
}

/** Bagian kecil API better-sqlite3 / node:sqlite yang dipakai di sini. */
export interface DbMinimal {
  prepare(sql: string): {
    run(...p: unknown[]): unknown
    get(...p: unknown[]): unknown
    all(...p: unknown[]): unknown[]
  }
}

/** Daftar pemicu yang DIMATIKAN per user (kunci username huruf kecil). */
export interface SaklarConfig {
  baca(username: string): PemicuId[]
  tulis(username: string, mati: PemicuId[]): void
}

export interface Penyimpanan {
  baca(username: string, id: PemicuId): PenandaTersimpan
  /** Upsert penanda + status. */
  simpan(username: string, id: PemicuId, p: PenandaTersimpan): void
  /** Saklar dinyalakan ulang = dihitung dari keadaan sekarang (pola Jadwal). */
  kosongkan(username: string, id: PemicuId): void
  /** Dipangkas ke MAKS_RIWAYAT per user di sini, supaya tabelnya tidak tumbuh tanpa batas. */
  catatRiwayat(username: string, r: Omit<ItemRiwayatPemantau, 'id'>): void
  /** Terbaru dulu. */
  riwayat(username: string, batas: number): ItemRiwayatPemantau[]
  mati(username: string): PemicuId[]
  setelMati(username: string, id: PemicuId, mati: boolean): void
}

function bacaStatus(teks: string | null): StatusTersimpan | null {
  if (!teks) return null
  try {
    return JSON.parse(teks) as StatusTersimpan
  } catch {
    // Status yang rusak cukup dianggap belum pernah diperiksa — bukan alasan mematikan pemantau.
    return null
  }
}

export function buatPenyimpanan(db: DbMinimal, saklar: SaklarConfig): Penyimpanan {
  const u = (username: string): string => username.toLowerCase()
  return {
    baca(username, id) {
      const r = db
        .prepare('SELECT nilai, diperiksa, status FROM pemantau_penanda WHERE username = ? AND pemicu = ?')
        .get(u(username), id) as { nilai: string | null; diperiksa: number | null; status: string | null } | undefined
      if (!r) return { nilai: null, diperiksa: null, status: null }
      return {
        nilai: r.nilai ?? null,
        diperiksa: r.diperiksa === null || r.diperiksa === undefined ? null : Number(r.diperiksa),
        status: bacaStatus(r.status)
      }
    },

    simpan(username, id, p) {
      db.prepare(
        `INSERT INTO pemantau_penanda (username, pemicu, nilai, diperiksa, status) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (username, pemicu) DO UPDATE
            SET nilai = excluded.nilai, diperiksa = excluded.diperiksa, status = excluded.status`
      ).run(u(username), id, p.nilai, p.diperiksa, p.status ? JSON.stringify(p.status) : null)
    },

    kosongkan(username, id) {
      db.prepare('DELETE FROM pemantau_penanda WHERE username = ? AND pemicu = ?').run(u(username), id)
    },

    catatRiwayat(username, r) {
      db.prepare(
        'INSERT INTO pemantau_riwayat (username, pemicu, judul, isi, aksi, dibuat) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(u(username), r.pemicu, r.judul, r.isi, JSON.stringify(r.aksi), r.dibuat)
      db.prepare(
        `DELETE FROM pemantau_riwayat WHERE username = ? AND id NOT IN
           (SELECT id FROM pemantau_riwayat WHERE username = ? ORDER BY id DESC LIMIT ?)`
      ).run(u(username), u(username), MAKS_RIWAYAT)
    },

    riwayat(username, batas) {
      const rows = db
        .prepare(
          `SELECT id, pemicu, judul, isi, aksi, dibuat FROM pemantau_riwayat
            WHERE username = ? ORDER BY id DESC LIMIT ?`
        )
        .all(u(username), batas) as Array<{
        id: number
        pemicu: string
        judul: string
        isi: string
        aksi: string
        dibuat: number
      }>
      return rows.map((r) => ({
        id: Number(r.id),
        pemicu: r.pemicu as PemicuId,
        judul: r.judul,
        isi: r.isi,
        aksi: JSON.parse(r.aksi) as AksiPemantau,
        dibuat: Number(r.dibuat)
      }))
    },

    mati(username) {
      return [...new Set(saklar.baca(u(username)))]
    },

    setelMati(username, id, mati) {
      const lain = saklar.baca(u(username)).filter((x) => x !== id)
      saklar.tulis(u(username), mati ? [...lain, id] : lain)
    }
  }
}
