import { LOCKED_ROLES, MENU_VALUES, ROLE_VALUES } from '../../shared/ipc'
import { HIDDEN_MENUS } from '../hackathon/flags'

// Role, divisi, menu, dan aturan siapa boleh melihat apa.
//
// Modul ini SENGAJA murni: tidak menyentuh database, tidak menyentuh Electron.
// Semua keputusan akses lahir di sini supaya bisa diuji, dan supaya hanya ada
// SATU tempat yang menjawab "orang ini boleh buka menu itu atau tidak".

export const ROLES = ROLE_VALUES
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  direktur: 'Director',
  manager: 'Manager',
  spv: 'SPV',
  staff: 'Staff'
}

/** Menu yang aksesnya bisa diatur. Mode "umum" (Task Baru) selalu terbuka untuk semua role. */
export const MENUS = MENU_VALUES
export type Menu = (typeof MENUS)[number]

export const MENU_LABELS: Record<Menu, string> = {
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365',
  reagent: 'Reagent Check'
}

/**
 * Role yang aksesnya TIDAK bisa dicabut lewat Settings.
 *
 * Daftarnya tinggal di `shared/ipc.ts` supaya panel Super Admin mengunci checkbox
 * untuk role yang sama persis dengan yang dikunci di sini. Ditegakkan di
 * `menuDiizinkan`, bukan dengan menyembunyikan checkbox: baris matriks yang salah
 * di database pun tidak boleh mengubah hasilnya.
 */
export const AKSES_TAK_TERCABUT: readonly Role[] = LOCKED_ROLES

/** Hanya Super Admin yang boleh membuka panel pengaturan user, divisi & matriks menu. */
export function bolehKelolaUser(role: Role): boolean {
  return role === 'super_admin'
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function isMenu(value: unknown): value is Menu {
  return typeof value === 'string' && (MENUS as readonly string[]).includes(value)
}

// ------------------------------------------------------------------ divisi

/**
 * Mengubah nama divisi jadi kode penyimpanan: "PA TP" → `pa_tp`.
 *
 * Kode dipisahkan dari nama supaya nama bisa diperbaiki (salah ketik, ganti
 * sebutan) tanpa memutus seluruh baris `tb_user_divisi_aira` dan
 * `tb_menu_divisi_aira` yang menunjuk ke sana. Mengembalikan `null` bila namanya
 * tidak menyisakan karakter yang sah.
 */
export function kodeDivisi(nama: string): string | null {
  const kode = nama
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return kode.length > 0 && kode.length <= 40 ? kode : null
}

export type AturanDivisi = 'tanpa' | 'satu' | 'banyak'

/**
 * Berapa divisi yang WAJIB dimiliki tiap role (ketentuan user 19 Agu 2026).
 *
 * - Direktur & Super Admin melihat lintas divisi, jadi tidak punya divisi sama sekali.
 *   Keduanya juga ada di `AKSES_TAK_TERCABUT`, sehingga pemeriksaan divisi memang
 *   tidak pernah sampai ke mereka — dua aturan ini harus tetap sejalan.
 * - Manager & SPV kerap memegang 2–3 divisi sekaligus.
 * - Staff melekat pada tepat satu divisi.
 */
export const DIVISI_PER_ROLE: Record<Role, AturanDivisi> = {
  super_admin: 'tanpa',
  direktur: 'tanpa',
  manager: 'banyak',
  spv: 'banyak',
  staff: 'satu'
}

export function butuhDivisi(role: Role): boolean {
  return DIVISI_PER_ROLE[role] !== 'tanpa'
}

/**
 * Memeriksa jumlah divisi terhadap aturan rolenya.
 * Mengembalikan pesan kesalahan, atau `null` bila sah.
 */
export function validasiDivisi(role: Role, divisi: readonly string[]): string | null {
  const unik = new Set(divisi.filter((d) => d.trim().length > 0))
  switch (DIVISI_PER_ROLE[role]) {
    case 'tanpa':
      return unik.size > 0
        ? `${ROLE_LABELS[role]} sees across divisions, so no division needs to be chosen.`
        : null
    case 'satu':
      if (unik.size === 0) return `${ROLE_LABELS[role]} must have one division.`
      if (unik.size > 1) return `${ROLE_LABELS[role]} may only have one division.`
      return null
    case 'banyak':
      return unik.size === 0 ? `${ROLE_LABELS[role]} must have at least one division.` : null
  }
}

// ------------------------------------------------------------ matriks akses

/**
 * Matriks menu → role → kode divisi, dari `tb_menu_role_divisi_aira` (30 Sep 2026).
 * Lihat `RoleDivisionMatrix` di `shared/ipc.ts` untuk alasan satu matriks tiga
 * dimensi menggantikan dua matriks dua dimensi.
 */
export type MatriksAksesMenu = Partial<Record<Menu, Partial<Record<Role, Record<string, boolean>>>>>

/** Siapa yang sedang diperiksa. `divisi` berisi kode divisi miliknya. */
export interface KonteksAkses {
  role: Role
  divisi: readonly string[]
}

/**
 * Apakah orang ini boleh membuka `menu`.
 *
 *   1. Role di `AKSES_TAK_TERCABUT` selalu boleh — baris database diabaikan.
 *   2. Selain itu, pasangan (role-nya, SALAH SATU divisinya) harus dicentang untuk
 *      menu itu. Centangan milik role lain di divisi yang sama TIDAK berlaku —
 *      itulah yang membuat "Manager PA TP boleh, SPV PA TP tidak" bisa diatur.
 *
 * ⚠️ Kombinasi yang tidak punya baris = tertutup. Menu baru dan divisi baru lahir
 * tertutup: yang lupa diatur gagal TERLIHAT ("kok menunya tidak muncul") alih-alih
 * diam-diam terbuka.
 */
export function menuDiizinkan(ctx: KonteksAkses, menu: Menu, matriks: MatriksAksesMenu): boolean {
  if (AKSES_TAK_TERCABUT.includes(ctx.role)) return true
  const sel = matriks[menu]?.[ctx.role] ?? {}
  return ctx.divisi.some((kode) => sel[kode] === true)
}

/** Daftar menu yang boleh dilihat — dipakai UI dan guard IPC. */
export function menuUntuk(ctx: KonteksAkses, matriks: MatriksAksesMenu): Menu[] {
  return MENUS.filter((menu) => !HIDDEN_MENUS.includes(menu) && menuDiizinkan(ctx, menu, matriks))
}

/**
 * Matriks lama (19 Agu–30 Sep 2026): role × menu DAN divisi × menu, terpisah.
 * Hanya dipakai untuk MEMBUKTIKAN migrasi — hasil akses sesudah pindah ke matriks
 * baru wajib identik dengan hasil aturan lama untuk setiap orang.
 */
export type MatriksRoleLama = Partial<Record<Role, Partial<Record<Menu, boolean>>>>
export type MatriksDivisiLama = Partial<Record<Menu, Record<string, boolean>>>

/** Aturan lama, dipertahankan apa adanya sebagai pembanding migrasi. */
export function menuDiizinkanLama(
  ctx: KonteksAkses,
  menu: Menu,
  matriksRole: MatriksRoleLama,
  matriksDivisi: MatriksDivisiLama
): boolean {
  if (AKSES_TAK_TERCABUT.includes(ctx.role)) return true
  if (matriksRole[ctx.role]?.[menu] !== true) return false
  const divisiMenu = matriksDivisi[menu] ?? {}
  return ctx.divisi.some((kode) => divisiMenu[kode] === true)
}

/**
 * Menerjemahkan matriks lama ke matriks baru: sel (menu, role, divisi) = role
 * dicentang DAN divisi dicentang. Rumus yang SAMA dengan INSERT migrasi di
 * `schema.ts`; test membuktikan hasilnya identik dengan `menuDiizinkanLama`.
 */
export function matriksDariLama(
  matriksRole: MatriksRoleLama,
  matriksDivisi: MatriksDivisiLama,
  kodeDivisiSemua: readonly string[]
): MatriksAksesMenu {
  const hasil: MatriksAksesMenu = {}
  for (const menu of MENUS) {
    for (const role of ROLES) {
      if (AKSES_TAK_TERCABUT.includes(role)) continue
      const sel: Record<string, boolean> = {}
      for (const kode of kodeDivisiSemua) {
        sel[kode] = matriksRole[role]?.[menu] === true && matriksDivisi[menu]?.[kode] === true
      }
      hasil[menu] = { ...hasil[menu], [role]: sel }
    }
  }
  return hasil
}
