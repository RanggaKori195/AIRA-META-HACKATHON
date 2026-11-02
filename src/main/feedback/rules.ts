import {
  FEEDBACK_DAMPAK,
  FEEDBACK_JENIS,
  FEEDBACK_STATUS,
  type FeedbackDampak,
  type FeedbackJenis,
  type FeedbackStatus
} from '../../shared/ipc'
import { MIME_DIIZINKAN } from '../chat/rules'

// Aturan masukan user — modul MURNI (tanpa database, tanpa Electron), pola yang
// sama dengan `auth/account.ts` dan `auth/roles.ts`: keputusannya bisa diuji
// tanpa jaringan, dan hanya ada satu tempat yang menjawabnya.

/**
 * Batas panjang cuplikan percakapan yang ikut dikirim.
 *
 * ⚠️ Ini bukan angka hiasan. Satu jawaban AIRA bisa memuat hasil `read_pdf`
 * sepanjang 131 ribu karakter (terukur pada laporan 92 halaman, 19 Agu 2026).
 * Tanpa batas, satu laporan "angkanya salah" menulis ratusan kilobyte ke tabel
 * di database PRODUKSI yang `max_connections`-nya saja sudah sempit — dan yang
 * dibutuhkan untuk menelusuri keluhan hanya bagian awalnya.
 */
export const MAKS_CUPLIKAN = 4_000

/** Batas isi masukan yang diketik user. Cukup untuk beberapa paragraf. */
export const MAKS_ISI = 4_000

/**
 * Memotong teks panjang — dan MENGATAKAN bahwa ia dipotong.
 *
 * ⚠️ Penanda "[…dipotong…]" wajib ikut. Pelajaran 19 Agu 2026 yang berlaku sama
 * di sini: potongan yang membisu membuat pembacanya menyimpulkan yang salah.
 * Di `read_pdf` yang tertipu adalah model (ia mengarang "95 ribu karakter
 * terpotong" padahal 31 ribu); di sini yang tertipu manusia — Super Admin
 * membaca jawaban yang terputus di tengah kalimat dan mengira ITU-lah bug yang
 * dilaporkan, padahal potongan itu buatan kita sendiri.
 */
export function potongCuplikan(teks: string | null, maks = MAKS_CUPLIKAN): string | null {
  if (teks === null) return null
  const bersih = teks.trim()
  if (bersih.length === 0) return null
  if (bersih.length <= maks) return bersih
  const sisa = bersih.length - maks
  return `${bersih.slice(0, maks)}\n\n[…dipotong ${sisa.toLocaleString('id-ID')} karakter lagi oleh AIRA saat mengirim masukan ini…]`
}

export function isJenis(value: unknown): value is FeedbackJenis {
  return typeof value === 'string' && (FEEDBACK_JENIS as readonly string[]).includes(value)
}

export function isDampak(value: unknown): value is FeedbackDampak {
  return typeof value === 'string' && (FEEDBACK_DAMPAK as readonly string[]).includes(value)
}

/**
 * Status yang TIDAK dikenal ditampilkan apa adanya, tidak ditebak dan tidak
 * ditolak.
 *
 * Kolom `status` sengaja tanpa CHECK constraint di database (alasannya sama
 * dengan kolom `menu` di `tb_menu_akses_aira`): alur kerja tindak lanjut akan
 * berubah lebih sering daripada aplikasi dibangun ulang, dan mengubahnya tidak
 * boleh berarti mengubah skema database produksi. Konsekuensinya harus dijaga
 * di sini — baris berstatus asing tetap terbaca, bukan hilang dari daftar.
 */
export function isStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUS as readonly string[]).includes(value)
}

/**
 * Apakah isi masukan layak dikirim.
 *
 * Sengaja longgar — satu kalimat pendek pun sah. Yang ditolak hanya yang benar
 * benar kosong: form yang cerewet mengurangi jumlah orang yang mau mengisi, dan
 * yang dibutuhkan dari uji coba justru volumenya.
 */
export function validasiIsi(isi: string): string | null {
  const bersih = isi.trim()
  if (bersih.length === 0) return 'Tulis dulu masukannya.'
  if (bersih.length > MAKS_ISI) return `Masukan terlalu panjang (maksimal ${MAKS_ISI} karakter).`
  return null
}

/**
 * Apa yang benar-benar dikirim sebagai cuplikan, setelah pilihan user dihormati.
 *
 * Dipisah jadi fungsi sendiri supaya bisa diuji, dan supaya jawabannya cuma ada
 * di satu tempat: **kalau user mencabut centangnya, `pertanyaan` dan `jawaban`
 * TIDAK ikut** — sementara `mode` dan `toolLog` tetap ikut karena keduanya tidak
 * memuat data, hanya nama tool dan parameternya. Itu yang bikin laporan tetap
 * bisa ditelusuri walau isinya dirahasiakan.
 */
export function cuplikanUntukKirim(input: {
  sertakanChat: boolean
  pertanyaan: string | null
  jawaban: string | null
}): { pertanyaan: string | null; jawaban: string | null } {
  if (!input.sertakanChat) return { pertanyaan: null, jawaban: null }
  return {
    pertanyaan: potongCuplikan(input.pertanyaan),
    jawaban: potongCuplikan(input.jawaban)
  }
}

/**
 * Batas lampiran masukan. Sama dengan chat (5 MB) dan alasannya sama: disimpan
 * sebagai `bytea` di database PRODUKSI yang dipakai bersama aplikasi lain.
 * Mockup menulis 10 MB — sengaja tidak diikuti; tangkapan layar jarang lewat 1 MB.
 */
export const MAKS_LAMPIRAN_MASUKAN = 5 * 1024 * 1024

/**
 * Jenis berkas yang boleh dilampirkan — daftar IZIN milik chat, BUKAN salinan.
 * Dua daftar akan menyimpang dan yang longgar menang diam-diam (pola §15/§50).
 */
export function periksaLampiranMasukan(
  nama: string,
  mime: string,
  ukuran: number
): { ok: true } | { ok: false; alasan: string } {
  if (!nama.trim()) return { ok: false, alasan: 'Nama berkas kosong.' }
  if (ukuran <= 0) return { ok: false, alasan: 'Berkasnya kosong.' }
  if (ukuran > MAKS_LAMPIRAN_MASUKAN) {
    return {
      ok: false,
      alasan: `Berkas ${(ukuran / 1048576).toFixed(1)} MB melebihi batas ${MAKS_LAMPIRAN_MASUKAN / 1048576} MB.`
    }
  }
  if (!(MIME_DIIZINKAN as readonly string[]).includes(mime)) {
    return {
      ok: false,
      alasan: 'Jenis berkas ini tidak bisa dilampirkan (hanya gambar, PDF, teks, dan dokumen Office).'
    }
  }
  return { ok: true }
}
