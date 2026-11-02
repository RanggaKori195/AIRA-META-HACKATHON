// Logika murni layar Akses Menu per Role & Divisi — draf, saringan, urutan, halaman.
//
// ⚠️ Impor NILAI memakai path relatif, bukan alias `@shared`: `tsx --test` tidak
// membaca alias itu (pelajaran `components/chat/bantu.ts`, aturan 64).
import { LOCKED_ROLES, ROLE_DIATUR } from '../../../../shared/ipc'
import type {
  AuthUserRow,
  Divisi,
  MenuId,
  RoleDivisionMatrix,
  RoleId,
  SelAkses
} from '../../../../shared/ipc'

/** Draf yang belum disimpan: kunci `menu|role|divisi` → nilai baru. */
export type Draf = Record<string, boolean>

export const kunciSel = (menu: MenuId, role: RoleId, divisi: string): string =>
  `${menu}|${role}|${divisi}`

/** Nilai TERSIMPAN. Kombinasi tanpa baris = tertutup (sama dengan `menuDiizinkan` di main). */
export const nilaiTersimpan = (
  akses: RoleDivisionMatrix,
  menu: MenuId,
  role: RoleId,
  divisi: string
): boolean => akses[menu]?.[role]?.[divisi] === true

/** Nilai yang TAMPIL: draf bila ada, selain itu yang tersimpan. */
export const nilaiTampil = (
  akses: RoleDivisionMatrix,
  draf: Draf,
  menu: MenuId,
  role: RoleId,
  divisi: string
): boolean => {
  const k = kunciSel(menu, role, divisi)
  return k in draf ? draf[k] : nilaiTersimpan(akses, menu, role, divisi)
}

/**
 * Mengubah satu sel di draf. Kembali ke nilai tersimpan = kuncinya DIBUANG, supaya
 * "centang lalu batal centang" tidak terhitung sebagai perubahan yang belum disimpan.
 */
export function ubahDraf(
  akses: RoleDivisionMatrix,
  draf: Draf,
  sel: { menu: MenuId; role: RoleId; divisi: string; diizinkan: boolean }[]
): Draf {
  const baru = { ...draf }
  for (const s of sel) {
    const k = kunciSel(s.menu, s.role, s.divisi)
    if (s.diizinkan === nilaiTersimpan(akses, s.menu, s.role, s.divisi)) delete baru[k]
    else baru[k] = s.diizinkan
  }
  return baru
}

/** Draf → daftar perubahan untuk disimpan. Hanya yang BENAR-BENAR berbeda dari tersimpan. */
export function daftarPerubahan(akses: RoleDivisionMatrix, draf: Draf): SelAkses[] {
  const hasil: SelAkses[] = []
  for (const [k, v] of Object.entries(draf)) {
    const [menu, role, divisi] = k.split('|') as [MenuId, RoleId, string]
    if (v !== nilaiTersimpan(akses, menu, role, divisi)) hasil.push({ menu, role, divisi, diizinkan: v })
  }
  return hasil
}

/** Username dengan role & divisi ini — siapa yang terkena satu centangan. */
export const penghuni = (users: AuthUserRow[], role: RoleId, divisi: string): string[] =>
  users.filter((u) => u.role === role && u.divisi.includes(divisi)).map((u) => u.username)

export type SaringStatus = 'all' | 'active' | 'inactive'
export type KolomUrut = 'no' | 'division' | RoleId
export interface Urutan {
  kolom: KolomUrut
  naik: boolean
}

export interface BarisDivisi extends Divisi {
  /** Nomor urut asli (1-based) dari daftar divisi — kolom "No". */
  no: number
}

/**
 * Menyaring & mengurutkan divisi.
 *
 * Urutan kolom role: yang tercentang dulu, lalu yang paling banyak user-nya —
 * pertanyaan yang biasanya diajukan ("divisi mana saja yang sudah dibuka untuk SPV").
 */
export function susunBaris(
  daftar: Divisi[],
  opsi: {
    cari: string
    status: SaringStatus
    urutan: Urutan
    nilai: (role: RoleId, divisi: string) => boolean
    jumlahUser: (role: RoleId, divisi: string) => number
  }
): BarisDivisi[] {
  const cari = opsi.cari.trim().toLowerCase()
  const baris = daftar
    .map((d, i) => ({ ...d, no: i + 1 }))
    .filter((d) => (cari === '' ? true : d.nama.toLowerCase().includes(cari)))
    .filter((d) => (opsi.status === 'all' ? true : opsi.status === 'active' ? d.aktif : !d.aktif))

  const { kolom, naik } = opsi.urutan
  const banding = (a: BarisDivisi, b: BarisDivisi): number => {
    if (kolom === 'no') return a.no - b.no
    if (kolom === 'division') return a.nama.localeCompare(b.nama, 'en')
    const va = opsi.nilai(kolom, a.kode) ? 1 : 0
    const vb = opsi.nilai(kolom, b.kode) ? 1 : 0
    if (va !== vb) return vb - va
    const ua = opsi.jumlahUser(kolom, a.kode)
    const ub = opsi.jumlahUser(kolom, b.kode)
    return ub !== ua ? ub - ua : a.no - b.no
  }
  return baris.sort((a, b) => (naik ? banding(a, b) : -banding(a, b)))
}

/** Satu halaman tabel. Halaman di luar jangkauan dijepit ke halaman terakhir. */
export function halamanDari<T>(
  baris: T[],
  halaman: number,
  perHalaman: number
): { isi: T[]; halaman: number; jumlahHalaman: number } {
  const jumlahHalaman = Math.max(1, Math.ceil(baris.length / perHalaman))
  const h = Math.min(Math.max(1, halaman), jumlahHalaman)
  return { isi: baris.slice((h - 1) * perHalaman, h * perHalaman), halaman: h, jumlahHalaman }
}

/**
 * Angka kartu statistik — semuanya dari data TERSIMPAN, bukan draf, supaya kartu
 * tidak berubah-ubah saat Super Admin baru mencoba-coba centangan.
 */
export function statistik(
  daftarDivisi: Divisi[],
  akses: RoleDivisionMatrix,
  users: AuthUserRow[],
  menu: readonly MenuId[]
): { divisi: number; divisiNonaktif: number; menuTerbuka: number; role: number; userBerdivisi: number } {
  const menuTerbuka = menu.filter((m) =>
    ROLE_DIATUR.some((r) => Object.values(akses[m]?.[r] ?? {}).some((v) => v === true))
  ).length
  return {
    divisi: daftarDivisi.length,
    divisiNonaktif: daftarDivisi.filter((d) => !d.aktif).length,
    menuTerbuka,
    role: ROLE_DIATUR.length,
    userBerdivisi: users.filter((u) => !LOCKED_ROLES.includes(u.role) && u.divisi.length > 0).length
  }
}
