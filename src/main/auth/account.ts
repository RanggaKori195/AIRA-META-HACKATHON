import type { Role } from './roles'

// Pemeriksaan keadaan akun — murni, tanpa database. Menjawab satu pertanyaan:
// boleh atau tidak akun ini masuk, dan kalau tidak, karena apa.

/** Baris `tb_login_aira` sebagaimana dibutuhkan pemeriksaan ini. */
export interface Akun {
  username: string
  role: Role
  /** `null` = tanpa batas berlaku. */
  expDate: Date | null
  isBanned: boolean
  bannedReason: string | null
}

export type AlasanTolak =
  | 'user_tidak_ada'
  | 'password_salah'
  | 'kedaluwarsa'
  | 'diblokir'

export interface HasilPeriksa {
  ok: boolean
  /** Diisi hanya bila ditolak. Nilai ini yang masuk kolom `status` di tabel log. */
  alasan?: AlasanTolak
  /** Kalimat yang ditampilkan ke user. Sengaja bisa berbeda dari `alasan`. */
  pesan?: string
}

/**
 * Pesan untuk user vs alasan untuk log sengaja DIPISAH.
 *
 * "user tidak ada" dan "password salah" sama-sama dijawab satu kalimat yang sama
 * ke layar — kalau dibedakan, layar login berubah menjadi alat untuk memastikan
 * username direksi mana yang benar-benar terdaftar. Tapi log tetap menyimpan yang
 * sebenarnya, karena di situlah Super Admin membedakan "salah ketik password
 * sendiri" dari "ada yang menebak-nebak nama akun".
 */
export const PESAN_KREDENSIAL_SALAH = 'Username atau password salah.'

/**
 * Aturan penulisan username.
 *
 * Sengaja ketat. Pencocokan saat login memang case-insensitive, tapi kalau
 * username BOLEH ditulis bebas, yang tampil di daftar user bisa berbeda dari yang
 * harus diketik — dan user yang gagal masuk tidak punya cara tahu bedanya di mana.
 * Spasi paling parah: "Budi Santoso" dan "Budi  Santoso" terlihat sama di layar.
 * Jadi username dinormalkan ke huruf kecil tanpa spasi saat dibuat.
 */
const USERNAME_POLA = /^[a-z0-9][a-z0-9._-]{2,49}$/

export const USERNAME_ATURAN =
  'Username 3–50 karakter: huruf kecil atau angka, boleh titik, garis bawah, dan strip. Tanpa spasi. Contoh: budi.santoso'

/** Menormalkan lalu memeriksa. Mengembalikan username siap simpan, atau `null` bila tidak sah. */
export function normalkanUsername(raw: string): string | null {
  const username = raw.trim().toLowerCase()
  return USERNAME_POLA.test(username) ? username : null
}

/**
 * Awal hari untuk `saat` — `exp_date` bertipe DATE (tanpa jam), jadi akun yang
 * kedaluwarsa "hari ini" masih berlaku sepanjang hari itu.
 */
function awalHari(saat: Date): Date {
  return new Date(saat.getFullYear(), saat.getMonth(), saat.getDate())
}

export function sudahKedaluwarsa(expDate: Date | null, saat: Date): boolean {
  if (expDate === null) return false
  return awalHari(saat).getTime() > awalHari(expDate).getTime()
}

/**
 * Urutannya disengaja: **blokir diperiksa lebih dulu daripada kedaluwarsa.**
 * Akun yang diblokir DAN kedaluwarsa harus terbaca "diblokir" di log — itu
 * tindakan sengaja seorang Super Admin, dan tidak boleh tersamar menjadi
 * kejadian administratif biasa saat riwayatnya ditelusuri.
 */
export function periksaAkun(akun: Akun, saat: Date): HasilPeriksa {
  if (akun.isBanned) {
    const sebab = akun.bannedReason?.trim()
    return {
      ok: false,
      alasan: 'diblokir',
      pesan: sebab
        ? `Akun ini diblokir oleh Super Admin. Alasan: ${sebab}`
        : 'Akun ini diblokir oleh Super Admin. Hubungi Super Admin untuk membukanya.'
    }
  }
  if (sudahKedaluwarsa(akun.expDate, saat)) {
    const tanggal = akun.expDate!.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
    return {
      ok: false,
      alasan: 'kedaluwarsa',
      pesan: `Masa berlaku akun ini sudah habis pada ${tanggal}. Hubungi Super Admin untuk memperpanjang.`
    }
  }
  return { ok: true }
}
