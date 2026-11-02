// Aturan murni menu "Jadwal" (29 Sep 2026) — tugas yang dijalankan AIRA sendiri
// pada jam tertentu. Tidak menyentuh Electron/SQLite supaya bisa diuji langsung.
//
// Keputusan user 29 Sep 2026: tugas berjalan DI LAPTOP, selama AIRA menyala
// (termasuk tersembunyi di tray) — bukan di server. Konsekuensinya ditulis jujur
// di layar: laptop mati/sleep = tugas tertunda, lalu DISUSULKAN SEKALI begitu AIRA
// menyala lagi. Tidak diulang sebanyak yang terlewat — laptop yang mati seminggu
// tidak boleh menembakkan tujuh laporan harian sekaligus ke gateway bersama.
//
// ⚠️ Semua jam dihitung di ZONA WAKTU LAPTOP (Date lokal), karena "jam 08.00"
// yang diketik user berarti jam dinding di mejanya.

import type { ChatMode, PolaJadwal } from '../../shared/ipc'
import { bacaJam, bacaTanggal, berikutnya, uraianPola, NAMA_HARI, kejadianDalam } from '../../shared/jadwal-pola'

// Aturan WAKTU (berikutnya, uraian) tinggal di shared/jadwal-pola.ts supaya
// kalender di layar memakai rumus yang SAMA dengan penjadwal. Diekspor ulang di
// sini agar pemanggil lama tidak berubah.
export { berikutnya, uraianPola, NAMA_HARI, kejadianDalam }

export const MAKS_JADWAL_PER_USER = 20
export const MAKS_NAMA = 80
export const MAKS_PROMPT = 5_000
/** Riwayat jalan yang DIKIRIM per tugas ke daftar — cukup untuk "kemarin jalan tidak?". */
export const MAKS_RIWAYAT = 10
/**
 * Riwayat jalan yang DISIMPAN per tugas. Lebih panjang dari yang tampil di kartu
 * karena kalender & "Tugas selesai bulan ini" membacanya — tugas harian butuh
 * ±31 baris per bulan; 100 memberi tiga bulan ke belakang.
 */
export const MAKS_SIMPAN_RIWAYAT = 100
/**
 * Selisih di atas ini dianggap TERLAMBAT (laptop mati/sleep, AIRA ditutup, user
 * lain yang login). Di bawahnya hanya jitter pemeriksaan berkala.
 */
export const AMBANG_TERLAMBAT_MS = 5 * 60_000

/** Mode yang boleh dijadwalkan — sama dengan mode percakapan. Izinnya diperiksa saat JALAN. */
export const MODE_JADWAL: ChatMode[] = ['general', 'sales', 'masterdata', 'lab', 'onedrive']

export class JadwalError extends Error {}

function jamMenit(jam: string): [number, number] {
  const hm = bacaJam(jam)
  if (!hm) throw new JadwalError(`Jam "${jam}" tidak sah — tulis seperti 08:00.`)
  return hm
}

/** Memeriksa bentuk pola. Dipanggil sebelum disimpan — pola rusak tidak pernah masuk database. */
export function pastikanPola(pola: PolaJadwal): PolaJadwal {
  jamMenit(pola.jam)
  switch (pola.jenis) {
    case 'sekali': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pola.tanggal)) throw new JadwalError('Tanggal wajib berbentuk YYYY-MM-DD.')
      if (!bacaTanggal(pola.tanggal)) throw new JadwalError(`Tanggal ${pola.tanggal} tidak ada.`)
      return pola
    }
    case 'harian':
    case 'hari_kerja':
      return pola
    case 'mingguan': {
      if (pola.hari.some((h) => !Number.isInteger(h) || h < 0 || h > 6)) {
        throw new JadwalError('Daftar hari tidak sah.')
      }
      const hari = [...new Set(pola.hari)].sort((a, b) => a - b)
      if (hari.length === 0) throw new JadwalError('Pilih minimal satu hari.')
      return { ...pola, hari }
    }
    case 'bulanan':
      if (!Number.isInteger(pola.tanggal) || pola.tanggal < 1 || pola.tanggal > 31) {
        throw new JadwalError('Tanggal bulanan wajib 1–31.')
      }
      return pola
    default:
      throw new JadwalError('Jenis jadwal tidak dikenal.')
  }
}

/**
 * Apakah tugas ini jatuh tempo SEKARANG.
 * `berikut` null = tidak dijadwalkan lagi.
 */
export function jatuhTempo(berikut: number | null, aktif: boolean, sekarang: number): boolean {
  return aktif && berikut !== null && berikut <= sekarang
}

/** Menit keterlambatan, atau 0 bila tepat waktu (di bawah ambang jitter). */
export function menitTerlambat(dijadwalkan: number, mulai: number): number {
  const selisih = mulai - dijadwalkan
  return selisih > AMBANG_TERLAMBAT_MS ? Math.round(selisih / 60_000) : 0
}

/**
 * Pesan yang dikembalikan ke model bila tugas terjadwal meminta operasi yang
 * butuh persetujuan.
 *
 * ⚠️ Tugas terjadwal berjalan saat orangnya mungkin tidak di depan laptop.
 * Menunggu persetujuan berarti tugasnya menggantung 5 menit lalu tetap ditolak;
 * dan dialog persetujuan yang muncul di layar yang sedang dipakai untuk hal lain
 * akan diklik tanpa dibaca (§25/§57). Jadi operasi yang mengubah/menghapus/
 * menjalankan DITOLAK LANGSUNG — janji SOUL.md "setiap tindakan berisiko minta
 * izin dulu" tetap utuh. Membuat laporan (tier `write`) tetap boleh.
 * Kalimat ini menyebut jalan keluarnya supaya model tidak mengarang alasan lain.
 */
export const TOLAK_TERJADWAL =
  'Ditolak: ini TUGAS TERJADWAL yang berjalan tanpa ada orang yang bisa menyetujui. ' +
  'Operasi yang mengubah, memindah, menghapus, atau menjalankan perintah tidak dilakukan. ' +
  'Lanjutkan tanpa operasi ini, dan sebutkan di jawaban bahwa langkah ini perlu dijalankan ' +
  'user sendiri dari percakapan biasa.'
