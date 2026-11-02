import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'

// Ruang uji: folder milik APLIKASI tempat AIRA boleh menulis dan menjalankan
// kode tanpa menyentuh berkas user.
//
// Kenapa bukan langsung di folder user: permintaan aslinya adalah "pastikan
// dulu jangan sampai salah". Menguji perbaikan langsung di berkas asli berarti
// setiap percobaan yang gagal meninggalkan kerusakan — dan `edit_file` yang
// menimpa berkas kerja orang adalah persis hal yang paling mahal untuk salah.
// Jadi: salin ke ruang uji -> perbaiki -> jalankan sampai lolos -> baru tulis
// balik ke berkas asli (lewat edit_file/write_file yang TETAP minta persetujuan).
//
// Isolasinya adalah isolasi FOLDER. Lihat peringatan di `rules.ts`: jangan
// pernah mengklaim lebih dari itu.

/** Umur maksimum ruang uji sebelum dibersihkan saat aplikasi start. */
const UMUR_MAKS_MS = 7 * 24 * 60 * 60 * 1000

export function ruangUjiRoot(): string {
  const dir = join(app.getPath('userData'), 'uji')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Nama folder aman untuk sebuah sessionId (id-nya UUID, tapi jangan percaya). */
export function namaRuang(sessionId: string): string {
  const bersih = sessionId.replace(/[^\w-]/g, '_').slice(0, 64)
  return bersih || 'tanpa-sesi'
}

/**
 * Path ruang uji sebuah sesi TANPA membuatnya.
 *
 * Dipakai system prompt, yang disusun ulang setiap giliran chat — termasuk
 * percakapan yang tidak ada hubungannya dengan kode. Membuat folder di situ
 * berarti menumpuk ribuan folder kosong untuk pekerjaan yang tidak pernah
 * terjadi.
 */
export function pathRuangUji(sessionId: string): string {
  return join(ruangUjiRoot(), namaRuang(sessionId))
}

/** Path ruang uji, dibuat bila belum ada. Dipakai saat benar-benar akan dipakai. */
export function ruangUji(sessionId: string): string {
  const dir = pathRuangUji(sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Membuang ruang uji satu sesi — dipanggil saat sesi chat dihapus. */
export function hapusRuangUji(sessionId: string): void {
  const dir = join(ruangUjiRoot(), namaRuang(sessionId))
  if (!existsSync(dir)) return
  try {
    rmSync(dir, { recursive: true, force: true })
    logger().info({ sessionId }, 'ruang uji dibuang')
  } catch (err) {
    logger().warn({ sessionId, err: String(err) }, 'gagal membuang ruang uji')
  }
}

/**
 * Membersihkan ruang uji yang sudah lama saat aplikasi start.
 *
 * ⚠️ Dijalankan sekali dan errornya ditelan: kegagalan membersihkan folder
 * sementara tidak boleh menggagalkan start aplikasi. Tapi tetap dicatat —
 * pembersihan yang diam-diam gagal berarti folder ini tumbuh selamanya tanpa
 * ada yang tahu.
 */
export function bersihkanRuangLama(): void {
  let root: string
  try {
    root = ruangUjiRoot()
  } catch {
    return
  }
  const sekarang = Date.now()
  let dibuang = 0
  for (const nama of readdirSync(root)) {
    const dir = join(root, nama)
    try {
      const stat = statSync(dir)
      if (!stat.isDirectory()) continue
      if (sekarang - stat.mtimeMs < UMUR_MAKS_MS) continue
      rmSync(dir, { recursive: true, force: true })
      dibuang++
    } catch (err) {
      logger().warn({ dir, err: String(err) }, 'ruang uji lama gagal dibuang')
    }
  }
  if (dibuang > 0) logger().info({ dibuang }, 'ruang uji lama dibersihkan')
}

// ── Izin menarik dependensi ────────────────────────────────────────────────
//
// Ketentuan user 21 Agu 2026: boleh, tapi user menyetujuinya SEKALI per sesi.
// Alasan tidak "tiap kali": `npm install` di tengah loop perbaikan akan
// memunculkan popup berkali-kali, dan user yang dihujani popup menekan
// "izinkan" tanpa membaca — gerbang persetujuan justru kehilangan artinya.
// Alasan tidak "sekali selamanya": memasang paket berarti menjalankan skrip
// pihak ketiga di laptop the company, dan itu layak disadari per pekerjaan.

const izinJaringan = new Set<string>()

export function sudahBolehJaringan(sessionId: string): boolean {
  return izinJaringan.has(sessionId)
}

export function catatIzinJaringan(sessionId: string): void {
  izinJaringan.add(sessionId)
}

export function lupakanIzinJaringan(sessionId: string): void {
  izinJaringan.delete(sessionId)
}

/** Semua izin dicabut saat user logout — laptop bisa dipakai orang berikutnya. */
export function lupakanSemuaIzin(): void {
  izinJaringan.clear()
}
