import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { logger } from '../logger'
import { halamanHtml, kakiHalaman, kepalaHalaman, type OpsiGaya } from './style'
import { markdownToHtml } from './markdown'
import { fontDataUrl, siapkanFontUntukCetak } from '../fonts'

// Pembuatan PDF lewat `printToPDF` bawaan Electron.
//
// Dipilih setelah menimbang tiga jalur (20 Agu 2026):
//   1. Ekspor lewat Word/COM  — menuntut Microsoft Office terpasang di tiap
//      laptop. Satu laptop tanpa Office = gagal di sana saja, dan itu jenis
//      kegagalan yang mahal ditelusuri dari jauh.
//   2. Library PDF (pdfkit/pdf-lib) — dependensi baru yang ikut ke installer,
//      ikut ke bytenode, dan tata letaknya harus disusun manual: pemenggalan
//      halaman, tabel, header. Banyak kerja, hasil biasanya jelek.
//   3. printToPDF Electron — NOL dependensi baru (sudah ada di dalam Electron),
//      tata letak penuh lewat CSS, tidak butuh Office, bukan native module
//      sehingga tidak menyentuh risiko build/bytecode.

export interface OpsiPdf extends OpsiGaya {
  /** Teks kecil di kiri kaki halaman, mis. nama laporan. */
  catatanKaki?: string
  /** Cetak dalam orientasi mendatar — untuk tabel lebar. */
  mendatar?: boolean
}

/**
 * Menulis PDF dari markdown.
 *
 * ⚠️ Jendela pencetak dibuat dengan JAVASCRIPT MATI dan tanpa akses Node.
 * Isinya bisa berasal dari model, dan tidak ada satu pun alasan halaman cetak
 * perlu menjalankan skrip. Ini penerapan aturan SOUL.md yang sama: isi yang
 * datang dari luar adalah DATA, bukan perintah.
 */
export async function tulisPdfDariMarkdown(
  markdown: string,
  tujuan: string,
  opsi: OpsiPdf = {}
): Promise<{ path: string; bytes: number; halaman: number }> {
  return tulisPdfDariHtml(markdownToHtml(markdown), tujuan, opsi)
}

export async function tulisPdfDariHtml(
  isiHtml: string,
  tujuan: string,
  opsi: OpsiPdf = {}
): Promise<{ path: string; bytes: number; halaman: number }> {
  // Ditulis ke file sementara lalu dimuat lewat loadFile, BUKAN data: URL —
  // data URL punya batas panjang yang berbeda-beda dan laporan panjang bisa
  // terpotong diam-diam di tengah.
  const dir = mkdtempSync(join(tmpdir(), 'aira-pdf-'))
  // Font disalin ke folder yang SAMA dengan halamannya, lalu dirujuk relatif —
  // lihat alasannya di `siapkanFontUntukCetak`.
  const fontFace = siapkanFontUntukCetak(dir)
  const html = halamanHtml(isiHtml, { ...opsi, fontFace })
  const berkasHtml = join(dir, 'dok.html')
  writeFileSync(berkasHtml, html, 'utf8')

  let win: BrowserWindow | null = null
  const t0 = Date.now()
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        javascript: false,
        webSecurity: true
      }
    })
    // Halaman cetak tidak boleh berpindah ke mana pun — termasuk kalau isinya
    // memuat tautan atau pengalihan.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    await win.loadFile(berkasHtml)

    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape: opsi.mendatar === true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: kepalaHalaman(),
      footerTemplate: kakiHalaman(opsi.catatanKaki, fontDataUrl('')),
      // Margin bawah dilebihkan agar kaki halaman tidak menimpa isi.
      margins: { top: 0.7, bottom: 0.75, left: 0.63, right: 0.63 }
    })

    writeFileSync(tujuan, data)
    // Jumlah halaman dihitung dari isi berkasnya sendiri, bukan ditaksir —
    // dipakai di hasil tool supaya AIRA bisa menyebutnya tanpa mengarang.
    const halaman = (data.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length || 1
    logger().info({ path: tujuan, bytes: data.length, halaman, ms: Date.now() - t0 }, 'PDF ditulis')
    return { path: tujuan, bytes: data.length, halaman }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Apakah pembuatan PDF bisa dilakukan (butuh Electron yang sudah siap). */
export function pdfSiap(): boolean {
  try {
    return app.isReady()
  } catch {
    return false
  }
}
