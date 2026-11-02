import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'

// Font korporat company serif font untuk hal-hal DI LUAR jendela utama: splash screen
// dan pembuatan PDF. Antarmuka utama memuatnya lewat CSS renderer (styles.css).
//
// ⚠️ Berkas fontnya dicari di beberapa lokasi karena jalurnya berbeda antara
// mode dev dan aplikasi terpasang — pola yang sama dengan `skills.ts` dan
// `splash.ts`. Kalau tidak ketemu, aplikasi TETAP JALAN dengan font cadangan;
// font yang hilang tidak sepadan dengan aplikasi yang gagal terbuka.

export const KELUARGA_FONT = "'company serif font', 'Segoe UI', system-ui, serif"

/** Bobot yang benar-benar dipakai di dokumen cetak. */
export const BOBOT_PDF = [
  { berkas: 'CompanySerif-Regular.woff2', bobot: 400 },
  { berkas: 'CompanySerif-Medium.woff2', bobot: 500 },
  { berkas: 'CompanySerif-SemiBold.woff2', bobot: 600 },
  { berkas: 'CompanySerif-Bold.woff2', bobot: 700 }
] as const

/**
 * Tempat berkas font mungkin berada.
 *
 * ⚠️ Daftarnya panjang dengan sengaja. `app.getAppPath()` mengembalikan hal
 * yang BERBEDA tergantung bagaimana proses dijalankan — terukur 21 Agu 2026:
 * saat skrip dijalankan dari `scripts/`, ia mengembalikan folder `scripts`
 * sendiri, sehingga seluruh kandidat meleset dan PDF terbit dengan font
 * cadangan tanpa satu pun pesan. Kegagalannya sunyi: berkasnya tetap jadi,
 * hanya hurufnya bukan yang diminta.
 *
 * Karena itu jangkar pencariannya lebih dari satu: folder resources aplikasi
 * terpasang, folder aplikasi, folder kerja, dan letak berkas kode ini sendiri.
 */
function kandidatDir(): string[] {
  const appPath = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const jangkar = [appPath, join(appPath, '..'), process.cwd(), join(__dirname, '..', '..')]
  const dir: string[] = [join(process.resourcesPath ?? '', 'fonts')]
  for (const j of jangkar) {
    if (!j) continue
    dir.push(join(j, 'resources', 'fonts'))
    dir.push(join(j, 'src', 'renderer', 'src', 'assets', 'fonts'))
  }
  return [...new Set(dir)]
}

/** Folder berisi berkas font, atau `null` bila tidak ada satu pun ditemukan. */
export function folderFont(): string | null {
  for (const dir of kandidatDir()) {
    if (existsSync(join(dir, 'CompanySerif-Regular.woff2'))) return dir
  }
  logger().warn({ dicari: kandidatDir() }, 'berkas company serif font tidak ditemukan — memakai font cadangan')
  return null
}

/**
 * Font sebagai data URL — untuk halaman yang dimuat dari string HTML (splash),
 * yang tidak punya folder tempat menaruh berkas pendamping.
 */
export function fontDataUrl(berkas: string): string | null {
  const dir = folderFont()
  if (!dir) return null
  try {
    return `data:font/woff2;base64,${readFileSync(join(dir, berkas)).toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Menyalin berkas font ke `tujuan` supaya halaman cetak bisa memuatnya lewat
 * URL RELATIF.
 *
 * ⚠️ Sengaja disalin, bukan dirujuk dengan `file:///` absolut ke folder
 * aplikasi. Halaman cetak dimuat dari folder sementara, dan Chromium membatasi
 * akses berkas lintas folder dari halaman `file://` — pembatasan yang gagalnya
 * SUNYI: fontnya tidak muat, PDF tetap jadi, hanya hurufnya berubah tanpa
 * pesan apa pun. Menyalin beberapa ratus KB per pencetakan jauh lebih murah
 * daripada laporan yang diam-diam tidak berhuruf the company.
 *
 * Mengembalikan CSS @font-face, atau string kosong bila fontnya tidak ada.
 */
export function siapkanFontUntukCetak(tujuan: string): string {
  const dir = folderFont()
  if (!dir) return ''

  const aturan: string[] = []
  for (const { berkas, bobot } of BOBOT_PDF) {
    try {
      copyFileSync(join(dir, berkas), join(tujuan, berkas))
      aturan.push(
        `@font-face { font-family: 'company serif font'; src: url('${berkas}') format('woff2'); ` +
          `font-weight: ${bobot}; font-style: normal; }`
      )
    } catch (err) {
      logger().warn({ berkas, err: String(err) }, 'gagal menyalin font untuk cetak')
    }
  }
  return aturan.join('\n')
}
