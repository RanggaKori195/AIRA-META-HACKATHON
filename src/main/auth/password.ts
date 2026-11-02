import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'crypto'

// Hashing password dengan scrypt — fungsi bawaan Node, TANPA dependency baru.
//
// Sengaja bukan bcrypt/argon2: keduanya modul native, dan native module harus
// ikut di-rebuild untuk Electron (`electron-builder install-app-deps`) lalu
// dibundel ke installer. Milestone berikutnya justru membangun `.exe` pertama
// kali; menambah satu native module sekarang berarti menambah satu hal baru yang
// bisa gagal di sana. scrypt sudah ada di runtime, dan memang KDF password
// (memory-hard), bukan hash cepat seperti SHA-256.
//
// Juga sengaja bukan pgcrypto: ekstensinya tidak terpasang di server (terperiksa
// 18 Agu 2026), dan hashing di sisi database berarti password polos ikut tercatat
// di log statement Postgres bila logging dinyalakan.

// Dibungkus manual, bukan lewat `promisify`: promisify memilih overload scrypt
// yang TANPA opsi, sehingga N/r/p tidak bisa dikirim (tsc menolaknya).
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

const N = 16_384
const R = 8
const P = 1
const KEYLEN = 32
const SALT_BYTES = 16

/** Batas atas panjang password. scrypt bekerja pada input berapa pun; ini rem terhadap DoS. */
export const PASSWORD_MAX = 200
export const PASSWORD_MIN = 5

/**
 * Menghasilkan `scrypt$N$r$p$salt$hash` (base64).
 *
 * Parameter ikut disimpan di dalam string supaya hash lama tetap bisa diverifikasi
 * kalau suatu saat N dinaikkan — tanpa ini, menaikkan biaya kerja akan mengunci
 * semua user yang sudah ada di luar aplikasi.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$')
}

/**
 * Membandingkan password dengan hash tersimpan.
 *
 * Selalu mengembalikan boolean — hash yang rusak/format asing dijawab `false`,
 * bukan dilempar sebagai error. Baris database yang korup tidak boleh menjadi
 * jalan masuk lewat exception yang tertangkap di tempat lain.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
    const salt = Buffer.from(parts[4], 'base64')
    const expected = Buffer.from(parts[5], 'base64')
    if (salt.length === 0 || expected.length === 0) return false
    const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p })
    // Panjangnya sudah pasti sama (keylen diambil dari expected), tapi timingSafeEqual
    // melempar bila beda — jadi tetap diperiksa.
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** Apakah string ini memang hash scrypt kita — dipakai seed agar tidak menimpa hash yang sudah benar. */
export function sudahDihash(value: string): boolean {
  return value.startsWith('scrypt$') && value.split('$').length === 6
}
