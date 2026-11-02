import { BrowserWindow } from 'electron'
import { keSvg, type SpekGrafik } from './svg'
import { logger } from '../logger'

// Mengubah SVG grafik jadi PNG, untuk Word & Excel yang tidak bisa menampilkan
// SVG dengan andal.
//
// ⚠️ Memakai Chromium yang SUDAH ADA di Electron — tanpa dependensi baru sama
// sekali. Alternatifnya (sharp, canvas, resvg) semuanya native module, dan
// native module adalah alasan Whisper-GPU dan Docker ditolak (§5b).
//
// PDF TIDAK melewati berkas ini: di sana SVG ditanam apa adanya dan digambar
// Chromium saat mencetak, jadi hasilnya vektor — tajam di zoom berapa pun.

/**
 * Skala render. 2× supaya gambar tetap tajam saat dokumen dicetak atau
 * di-zoom; PNG 1× terlihat kabur di Word pada layar HiDPI.
 */
const SKALA = 2

/**
 * Jendela offscreen dipakai ULANG. Membuat `BrowserWindow` per grafik memakan
 * ratusan milidetik, dan laporan bulanan memuat beberapa grafik sekaligus.
 */
let jendela: BrowserWindow | null = null

function ambilJendela(lebar: number, tinggi: number): BrowserWindow {
  if (jendela && !jendela.isDestroyed()) {
    jendela.setContentSize(lebar, tinggi)
    return jendela
  }
  jendela = new BrowserWindow({
    width: lebar,
    height: tinggi,
    show: false,
    webPreferences: {
      offscreen: true,
      // Halaman ini hanya memuat SVG yang KITA hasilkan sendiri, tapi tetap
      // dikunci: tidak ada Node, tidak ada preload. Kalau kelak ada teks dari
      // dokumen user yang masuk ke judul grafik, batasnya sudah terpasang.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  return jendela
}

export function tutupJendelaGrafik(): void {
  if (jendela && !jendela.isDestroyed()) jendela.destroy()
  jendela = null
}

/**
 * Menggambar spek jadi PNG.
 *
 * Mengembalikan `null` bila gagal — pemanggil WAJIB menanganinya dengan
 * menyebutkan bahwa grafiknya tidak ikut, bukan diam. Dokumen yang kehilangan
 * grafik tanpa keterangan terlihat seperti dokumen yang memang tidak punya
 * grafik.
 */
export async function keSvgPng(spek: SpekGrafik): Promise<Buffer | null> {
  return svgKePng(keSvg(spek), spek.lebar ?? 900, spek.tinggi ?? 460, spek.judul)
}

/** Sisi terpanjang PNG hasil. Diagram besar diperkecil skalanya, bukan dipotong. */
const MAKS_SISI_PNG = 5000

/**
 * SVG apa pun -> PNG (dipakai grafik laporan DAN diagram). `null` bila gagal —
 * pemanggil WAJIB menyebutkannya, bukan diam.
 */
export async function svgKePng(svg: string, lebar: number, tinggi: number, nama = ''): Promise<Buffer | null> {
  const skala = Math.max(1, Math.min(SKALA, MAKS_SISI_PNG / Math.max(lebar, tinggi)))
  try {
    const win = ambilJendela(lebar, tinggi)
    const html =
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<style>html,body{margin:0;padding:0;background:#fff;width:${lebar}px;height:${tinggi}px;overflow:hidden}` +
      `svg{display:block;width:${lebar}px;height:${tinggi}px}</style></head><body>${svg}</body></html>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // Satu putaran render sebelum menangkap; tanpa jeda ini, tangkapan bisa
    // berupa halaman putih pada mesin yang lambat.
    await new Promise((r) => setTimeout(r, 60))
    const gambar = await win.webContents.capturePage({ x: 0, y: 0, width: lebar, height: tinggi })
    const besar = gambar.resize({ width: Math.round(lebar * skala), height: Math.round(tinggi * skala), quality: 'best' })
    const png = besar.toPNG()
    if (png.length === 0) {
      logger().warn({ nama }, 'SVG menghasilkan PNG kosong')
      return null
    }
    return png
  } catch (err) {
    logger().warn({ nama, err: String(err).slice(0, 160) }, 'SVG gagal dirender ke PNG')
    return null
  }
}

export { keSvg }
export type { SpekGrafik }
