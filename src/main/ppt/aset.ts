import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { berkasIkon, type WarnaIkon } from './ikon'

// Aset visual template the company: gambar latar slide dan berkas ikon.
//
// ⚠️ Pencarian folder sengaja memakai BANYAK jangkar, sama seperti `fonts.ts`.
// `app.getAppPath()` mengembalikan hal yang berbeda tergantung bagaimana proses
// dijalankan (terukur 21 Agu 2026: dari `scripts/` ia mengembalikan folder
// `scripts` itu sendiri), dan kalau seluruh kandidat meleset, hasilnya bukan
// error melainkan deck POLOS TANPA BRANDING yang tetap terbit dengan tenang.
//
// Karena kegagalannya sunyi, modul ini tidak pernah hanya mengembalikan `null`
// diam-diam: setiap aset yang tidak ketemu dicatat di `MASALAH_ASET` dan ikut
// dilaporkan ke user lewat `catatanHasil`.

/** Background images in `resources/ppt-theme` (made with Muse Image, `npm run ppt:theme`). */
export const LATAR = {
  sampul: 'cover.png',
  isi: 'content.png',
  penutup: 'closing.png'
} as const

export type NamaLatar = keyof typeof LATAR

function kandidatDir(sub: string): string[] {
  const appPath = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const jangkar = [appPath, join(appPath, '..'), process.cwd(), join(__dirname, '..', '..')]
  const dir: string[] = [join(process.resourcesPath ?? '', sub)]
  for (const j of jangkar) {
    if (!j) continue
    dir.push(join(j, 'resources', sub))
  }
  return [...new Set(dir.filter(Boolean))]
}

function cariFolder(sub: string, penanda: string): string | null {
  for (const dir of kandidatDir(sub)) {
    if (existsSync(join(dir, penanda))) return dir
  }
  return null
}

/** Folder gambar latar template, atau null bila tidak ada. */
export function folderTemplat(): string | null {
  return cariFolder('ppt-theme', LATAR.isi)
}

/** Folder ikon hasil `npm run buat:ikon`, atau null bila belum dibuat. */
export function folderIkon(): string | null {
  return cariFolder('ikon', berkasIkon('target', 'hijau'))
}

function dataUrl(dir: string, berkas: string, mime: string): string | null {
  try {
    return `data:${mime};base64,${readFileSync(join(dir, berkas)).toString('base64')}`
  } catch (err) {
    logger().warn({ berkas, err: String(err) }, 'aset PPT gagal dibaca')
    return null
  }
}

export interface Latar {
  /** Isi gambar sebagai data URL. */
  data: string
  /**
   * Petunjuk nama berkas untuk pptxgenjs, mis. `preencoded.jpg`.
   *
   * ⚠️ WAJIB diisi dan WAJIB berakhiran sesuai isi gambarnya. Terukur 21 Agu
   * 2026: `background: { data }` tanpa `path` membuat pptxgenjs memakai
   * `preencoded.png` sebagai bawaan, sehingga gambar JPEG disimpan sebagai
   * `.png` DAN didaftarkan sebagai `image/png` di `[Content_Types].xml`.
   * Isinya JPEG, namanya PNG — PowerPoint bisa menganggap berkasnya rusak dan
   * menawarkan "repair". Tertangkap `npm run coba:ppt`, bukan oleh mata.
   */
  path: string
}

export interface AsetPpt {
  latar: Partial<Record<NamaLatar, Latar>>
  ikon: (nama: string, warna: WarnaIkon) => string | null
  /**
   * Kalimat-kalimat tentang aset yang TIDAK ketemu. Kosong = semuanya lengkap.
   * Selalu ikut ke hasil tool; deck tanpa branding tidak boleh lolos diam-diam.
   */
  masalah: string[]
}

/**
 * Memuat seluruh aset sekali di awal pembuatan deck.
 *
 * Ikon dimuat malas (per pemakaian) karena satu deck biasanya hanya menyentuh
 * beberapa ikon dari puluhan yang tersedia.
 */
export function muatAset(): AsetPpt {
  const masalah: string[] = []
  const latar: Partial<Record<NamaLatar, Latar>> = {}

  const dirLatar = folderTemplat()
  if (!dirLatar) {
    masalah.push(
      'presentation background images were NOT found (resources/ppt-theme), ' +
        'so the slides have a plain white background'
    )
    logger().warn(
      { dicari: kandidatDir('ppt-theme') },
      'latar template PPT tidak ditemukan — deck akan polos'
    )
  } else {
    for (const [nama, berkas] of Object.entries(LATAR) as [NamaLatar, string][]) {
      const png = berkas.endsWith('.png')
      const url = dataUrl(dirLatar, berkas, png ? 'image/png' : 'image/jpeg')
      if (url) latar[nama] = { data: url, path: png ? 'preencoded.png' : 'preencoded.jpg' }
      else masalah.push(`gambar latar "${berkas}" gagal dibaca; slide terkait dibuat polos`)
    }
  }

  const dirIkon = folderIkon()
  if (!dirIkon) {
    logger().warn({ dicari: kandidatDir('ikon') }, 'folder ikon PPT tidak ditemukan')
  }
  const cacheIkon = new Map<string, string | null>()

  return {
    latar,
    masalah,
    ikon(nama, warna) {
      if (!dirIkon) return null
      const kunci = `${nama}|${warna}`
      if (!cacheIkon.has(kunci)) {
        cacheIkon.set(kunci, dataUrl(dirIkon, berkasIkon(nama, warna), 'image/png'))
      }
      return cacheIkon.get(kunci) ?? null
    }
  }
}
