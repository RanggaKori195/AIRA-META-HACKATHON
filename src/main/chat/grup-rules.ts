// Aturan murni grup chat (tahap 3 "WhatsApp lite", 16 Sep 2026).
//
// Tidak menyentuh database. Yang ada di sini hanya yang BISA diputuskan tanpa
// database: bentuk nama, penyaringan calon anggota, dan teks pesan sistem.
//
// ⚠️ Yang TIDAK ada di sini — dan sengaja: "siapa boleh membaca/mengirim/
// mengelola". Keputusan itu hidup di klausa WHERE `chat/grup.ts`, karena hanya
// di sana ia benar-benar menahan. Salinan murni dari aturan izin akan terlihat
// meyakinkan di test lalu menyimpang diam-diam dari SQL yang sebenarnya dipakai.

import type { PeriksaLampiran } from './rules'

/**
 * Batas anggota per grup.
 *
 * Bukan batas teknis. Grup 300 orang di jendela chat sekecil ini tidak terbaca,
 * dan setiap pesan berarti 300 toast — orang akan mematikan notifikasi AIRA
 * seluruhnya. Pengumuman ke seluruh divisi tempatnya email.
 */
export const MAKS_ANGGOTA = 100

export const MAKS_NAMA_GRUP = 60

export type PeranGrup = 'admin' | 'anggota'

/**
 * Jenis pesan sistem.
 *
 * ⚠️ Pesan sistem ada supaya perubahan grup TIDAK PERNAH diam-diam. Tanpa itu,
 * orang muncul dan hilang dari grup tanpa jejak, dan pertanyaan "sejak kapan si
 * X bisa membaca ini?" tidak punya jawaban.
 */
export type JenisSistem =
  | 'buat'
  | 'tambah'
  | 'keluar'
  | 'keluarkan'
  | 'jadi_admin'
  | 'lepas_admin'
  | 'admin_otomatis'
  | 'ganti_nama'

export type HasilNama = { ok: true; nama: string } | { ok: false; alasan: string }

export function periksaNamaGrup(nama: string): HasilNama {
  // Spasi beruntun dirapikan: "Tim  Lab" dan "Tim Lab" tidak boleh tampil
  // seperti dua grup berbeda di daftar.
  const bersih = nama.replace(/\s+/g, ' ').trim()
  if (!bersih) return { ok: false, alasan: 'Nama grup wajib diisi.' }
  if (bersih.length > MAKS_NAMA_GRUP) {
    return { ok: false, alasan: `Nama grup maksimal ${MAKS_NAMA_GRUP} karakter.` }
  }
  return { ok: true, nama: bersih }
}

/**
 * Menyaring daftar calon anggota: huruf kecil, tanpa duplikat, tanpa diri
 * sendiri, tanpa yang sudah jadi anggota.
 *
 * Membandingkan tanpa memandang besar-kecil huruf, sama seperti seluruh chat:
 * "Budi" dan "budi" adalah satu orang.
 */
export function saringCalonAnggota(
  calon: readonly string[],
  saya: string,
  sudahAnggota: readonly string[] = []
): string[] {
  const aku = saya.toLowerCase()
  const ada = new Set(sudahAnggota.map((x) => x.toLowerCase()))
  const hasil: string[] = []
  for (const c of calon) {
    const k = c.trim().toLowerCase()
    if (!k || k === aku || ada.has(k)) continue
    ada.add(k)
    hasil.push(k)
  }
  return hasil
}

export function periksaJumlahAnggota(sekarang: number, tambahan: number): PeriksaLampiran {
  if (sekarang + tambahan > MAKS_ANGGOTA) {
    return {
      ok: false,
      alasan:
        `Grup maksimal ${MAKS_ANGGOTA} anggota (sekarang ${sekarang}, akan ditambah ${tambahan}). ` +
        'Untuk pengumuman ke banyak orang, gunakan email.'
    }
  }
  return { ok: true }
}

// `teksSistem` tinggal di `shared/chat-sistem.ts` — dipakai layar DAN notifikasi.
// Dua salinan berarti suatu hari toast berbunyi "Andi menambahkan kamu" sementara
// layar menulis "andi menambahkan budi" untuk kejadian yang sama.
export { teksSistem } from '../../shared/chat-sistem'

/** Kunci senyap untuk grup — satu daftar dengan senyap percakapan pribadi. */
export function kunciSenyapGrup(grupId: string): string {
  return `grup:${grupId}`
}

/**
 * Apakah sebuah pesan grup berada di dalam rentang keanggotaan seseorang.
 *
 * Dipakai MENJELASKAN aturan di test; yang benar-benar menahan adalah klausa
 * WHERE yang sama bentuknya di `chat/grup.ts`.
 */
export function dalamRentang(pesanId: bigint, gabungId: bigint, keluarId: bigint | null): boolean {
  if (pesanId <= gabungId) return false
  if (keluarId !== null && pesanId > keluarId) return false
  return true
}
