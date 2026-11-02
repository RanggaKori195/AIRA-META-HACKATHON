// Menu Pustaka (30 Sep 2026) — aturan MURNI: dari mana isi pustaka, jenis apa,
// dan bagaimana dua sumber digabung. Tanpa Electron/DB supaya bisa diuji.
//
// Dua sumber:
//   1. `outputPath` hasil tool SUKSES di riwayat chat milik user (`berkasDiRiwayat`)
//      — laporan Word/PDF/Excel, presentasi, gambar dari chat, dll.
//   2. Galeri gambar milik user — termasuk gambar yang dibuat di layar Gambar,
//      yang TIDAK pernah lewat chat.
// ⚠️ Gambar UNGGAHAN (salinan dari komputer user) tidak ikut: itu bukan hasil AIRA.

import type { KategoriPustaka } from '../../shared/ipc'

const KATEGORI: Record<string, KategoriPustaka> = {
  doc: 'word',
  docx: 'word',
  pdf: 'pdf',
  xls: 'excel',
  xlsx: 'excel',
  csv: 'excel',
  ppt: 'ppt',
  pptx: 'ppt',
  png: 'gambar',
  jpg: 'gambar',
  jpeg: 'gambar',
  webp: 'gambar',
  gif: 'gambar',
  svg: 'gambar',
  html: 'diagram',
  htm: 'diagram'
}

export function ekstensi(nama: string): string {
  const i = nama.lastIndexOf('.')
  return i > 0 ? nama.slice(i + 1).toLowerCase() : ''
}

/** Jenis berkas dari ekstensinya. Yang tidak dikenal = 'lain' (tetap tampil, tidak dibuang). */
export function kategoriDari(nama: string): KategoriPustaka {
  return KATEGORI[ekstensi(nama)] ?? 'lain'
}

export interface SumberPustaka {
  path: string
  dibuat: number
  asal: 'chat' | 'gambar'
  sessionId: string | null
  judulSesi: string | null
  galeriId: string | null
  /** Prompt gambar dari galeri — judul yang bisa dibaca, karena nama berkasnya acak (UUID). */
  keterangan: string | null
}

/**
 * Gabungan dua sumber, satu baris per berkas (path, tanpa peka huruf besar —
 * Windows). Gambar dari chat tercatat di KEDUANYA; versi riwayat chat yang
 * menang karena membawa tautan ke percakapannya, id galerinya ditempelkan.
 * Urut terbaru di atas.
 */
export function gabungPustaka(riwayat: readonly SumberPustaka[], galeri: readonly SumberPustaka[]): SumberPustaka[] {
  const peta = new Map<string, SumberPustaka>()
  for (const r of riwayat) {
    const k = r.path.toLowerCase()
    if (!peta.has(k)) peta.set(k, { ...r })
  }
  for (const g of galeri) {
    const k = g.path.toLowerCase()
    const ada = peta.get(k)
    if (ada) {
      ada.galeriId ??= g.galeriId
      ada.keterangan ??= g.keterangan
    }
    else peta.set(k, { ...g })
  }
  return [...peta.values()].sort((a, b) => b.dibuat - a.dibuat)
}
