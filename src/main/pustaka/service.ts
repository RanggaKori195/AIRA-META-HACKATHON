import { statSync } from 'fs'
import { basename } from 'path'
import * as db from '../db'
import type { ItemPustaka } from '../../shared/ipc'
import type { SesiUser } from '../auth/service'
import { ekstensi, gabungPustaka, kategoriDari, type SumberPustaka } from './rules'

// Menu Pustaka — isi dibaca dari riwayat chat & galeri milik user yang SEDANG
// login (pemilik dari sesi, klausa WHERE di db.ts — pola §16/§69). Renderer tidak
// mengirim apa pun selain permintaan daftar.

/** Batas baris per sumber. Riwayat chat sendiri memindai ≤400 pesan terakhir. */
const BATAS = 500

export function daftarPustaka(sesi: SesiUser): ItemPustaka[] {
  const riwayat: SumberPustaka[] = db.berkasDiRiwayat(sesi.username, BATAS).map((b) => ({
    path: b.path,
    dibuat: b.dibuat,
    asal: 'chat',
    sessionId: b.sessionId,
    judulSesi: b.judul,
    galeriId: null,
    keterangan: null
  }))
  const galeri: SumberPustaka[] = db
    .daftarGaleri(sesi.username, { limit: BATAS })
    // Unggahan = salinan gambar milik user sendiri, bukan hasil AIRA.
    .filter((g) => g.sumber !== 'unggah')
    .map((g) => ({
      path: g.path,
      dibuat: g.dibuat,
      asal: g.sumber === 'chat' ? 'chat' : 'gambar',
      sessionId: g.sessionId,
      judulSesi: null,
      galeriId: g.id,
      keterangan: g.prompt?.trim() || null
    }))

  return gabungPustaka(riwayat, galeri).map((s) => {
    let ukuran: number | null = null
    try {
      const st = statSync(s.path)
      if (st.isFile()) ukuran = st.size
    } catch {
      /* hilang — ditandai, bukan disembunyikan */
    }
    const nama = basename(s.path)
    return {
      path: s.path,
      nama,
      ekstensi: ekstensi(nama),
      kategori: kategoriDari(nama),
      dibuat: s.dibuat,
      ukuran,
      hilang: ukuran === null,
      asal: s.asal,
      sessionId: s.sessionId,
      judulSesi: s.judulSesi,
      galeriId: s.galeriId,
      keterangan: s.keterangan
    }
  })
}
