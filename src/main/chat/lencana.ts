import { BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { labelLencana } from './rules'
import { logger } from '../logger'

// Lencana angka di ikon taskbar — "ada 3 pesan yang belum dibaca", terlihat
// tanpa membuka jendelanya.
//
// ⚠️ `app.setBadgeCount()` TIDAK bekerja di Windows (hanya macOS & Linux). Yang
// bekerja adalah `setOverlayIcon`, dan ia menuntut GAMBAR — jadi angkanya harus
// digambar sendiri.
//
// ⚠️ Digambar lewat Chromium offscreen yang SUDAH ADA di Electron, pola yang
// sama dengan raster grafik: tanpa dependensi baru. sharp/canvas/resvg semuanya
// native module, dan native module adalah alasan Whisper-GPU dan Docker ditolak.
//
// Hanya ada SEPULUH gambar yang mungkin (1–9 dan "9+"), jadi hasilnya disimpan
// di memori. Tanpa cache, tiap pesan masuk berarti satu putaran render Chromium
// untuk gambar 32 piksel — mahal untuk sesuatu yang berubah setiap saat.

const UKURAN = 32
const cache = new Map<string, NativeImage>()

let jendela: BrowserWindow | null = null

function ambilJendela(): BrowserWindow {
  if (jendela && !jendela.isDestroyed()) return jendela
  jendela = new BrowserWindow({
    width: UKURAN,
    height: UKURAN,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  return jendela
}

export function tutupJendelaLencana(): void {
  if (jendela && !jendela.isDestroyed()) jendela.destroy()
  jendela = null
  cache.clear()
}

function svgLencana(teks: string): string {
  // Merah, bukan hijau aksen AIRA: lencana ini memberi tahu ada yang MENUNGGU,
  // dan warna aksen aplikasi tidak terbaca sebagai peringatan.
  const ukuranHuruf = teks.length > 1 ? 15 : 19
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${UKURAN}" height="${UKURAN}" viewBox="0 0 32 32">` +
    '<circle cx="16" cy="16" r="15" fill="#b3261e"/>' +
    `<text x="16" y="16" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="${ukuranHuruf}" ` +
    'font-weight="700" text-anchor="middle" dominant-baseline="central">' +
    teks +
    '</text></svg>'
  )
}

async function gambar(teks: string): Promise<NativeImage | null> {
  const tersimpan = cache.get(teks)
  if (tersimpan) return tersimpan
  try {
    const win = ambilJendela()
    const html =
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<style>html,body{margin:0;padding:0;background:transparent;width:${UKURAN}px;height:${UKURAN}px;overflow:hidden}` +
      `svg{display:block}</style></head><body>${svgLencana(teks)}</body></html>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((r) => setTimeout(r, 40))
    const tangkap = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: UKURAN,
      height: UKURAN
    })
    if (tangkap.isEmpty()) {
      logger().warn({ teks }, 'lencana taskbar menghasilkan gambar kosong')
      return null
    }
    const img = nativeImage.createFromBuffer(tangkap.toPNG())
    cache.set(teks, img)
    return img
  } catch (err) {
    logger().warn({ teks, err: String(err).slice(0, 160) }, 'lencana taskbar gagal digambar')
    return null
  }
}

/**
 * Memasang (atau melepas) lencana jumlah pesan belum dibaca.
 *
 * Gagal menggambar TIDAK dibiarkan diam: lencana lama dilepas, supaya yang
 * tertinggal di layar bukan angka basi. Angka yang salah lebih buruk daripada
 * tidak ada angka — orang akan mencari pesan yang sudah dibacanya.
 */
export async function pasangLencana(window: BrowserWindow | null, jumlah: number): Promise<void> {
  if (!window || window.isDestroyed()) return
  // setOverlayIcon hanya ada di Windows; di platform lain panggilannya dilewati
  // diam-diam oleh Electron, tapi lebih jelas kalau tidak dipanggil sama sekali.
  if (process.platform !== 'win32') return

  const teks = labelLencana(jumlah)
  if (!teks) {
    window.setOverlayIcon(null, '')
    return
  }
  const img = await gambar(teks)
  if (!img) {
    window.setOverlayIcon(null, '')
    return
  }
  window.setOverlayIcon(img, `${jumlah} pesan belum dibaca`)
}
