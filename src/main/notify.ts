import { BrowserWindow, Notification } from 'electron'
import { logger } from './logger'
import { buatPegangan } from './notify-pegang'

// Notifikasi Windows untuk task yang berjalan lama.
// Catatan Windows: toast baru tampil andal setelah aplikasi ter-install (punya
// shortcut Start Menu dengan AppUserModelID yang cocok). Saat mode dev toast bisa
// diabaikan diam-diam, karena itu taskbar juga dikedipkan sebagai fallback yang
// selalu berhasil.

/**
 * Jendela utama, DIDAFTARKAN oleh `index.ts` saat dibuat.
 *
 * ⚠️ Dulu ditebak dengan `getAllWindows()[0]`. Itu bom waktu: aplikasi ini
 * membuka BrowserWindow lain yang tak terlihat — splash, peraster grafik,
 * penggambar lencana — dan begitu salah satunya kebetulan ada di urutan pertama,
 * notifikasi mengedipkan jendela yang tidak pernah dilihat siapa pun. Gejalanya
 * "notifikasi kadang tidak memunculkan aplikasi", yang mustahil ditelusuri.
 */
let utama: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  utama = win
}

export function mainWindow(): BrowserWindow | null {
  if (utama && !utama.isDestroyed()) return utama
  return null
}

function appIsFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())
}

export interface NotifyOptions {
  title: string
  body: string
  /** true = tampilkan walau aplikasi sedang aktif (mis. AIRA berhenti menunggu user). */
  force?: boolean
  /** Dijalankan saat toast diklik, SESUDAH jendela utama dimunculkan (mis. buka menu terkait). */
  onClick?: () => void
  /** Kelompok toast (mis. 'pemantau') — dipakai `tutupNotifikasi` saat user berganti/logout. */
  grup?: string
  /** Username pemilik isi toast. */
  pemilik?: string
}

/**
 * Notifikasi berklik dipegang sampai diklik — objek yang dibuang GC tidak lagi menerima
 * klik dari Action Center (lihat `notify-pegang.ts`).
 */
const pegangan = buatPegangan<Notification>()

/** Menutup toast `grup` milik siapa pun selain `kecualiPemilik` (null = semua). */
export function tutupNotifikasi(grup: string, kecualiPemilik: string | null): void {
  const n = pegangan.tutupMilikSelain(grup, kecualiPemilik)
  if (n > 0) logger().info({ grup, n }, 'notifikasi milik user lain ditutup')
}

export function notify({ title, body, force = false, onClick, grup, pemilik }: NotifyOptions): boolean {
  const focused = appIsFocused()
  if (!force && focused) return false

  // Fallback yang tidak bergantung izin toast: kedipkan ikon di taskbar.
  if (!focused) mainWindow()?.flashFrame(true)

  try {
    if (!Notification.isSupported()) {
      logger().warn('notifikasi tidak didukung sistem')
      return false
    }
    const notification = new Notification({
      title,
      body: body.replace(/\s+/g, ' ').trim().slice(0, 200),
      silent: false
    })
    if (onClick) pegangan.pegang(notification, grup ?? null, pemilik ?? null)
    notification.on('click', () => {
      pegangan.lepas(notification)
      // Dicatat: tanpa ini "layar berpindah sendiri" tidak bisa dibedakan dari klik
      // user di sidebar saat menelusuri laporan.
      logger().info({ title }, 'notifikasi diklik')
      const window = mainWindow()
      if (window) {
        if (window.isMinimized()) window.restore()
        // Jendela yang "ditutup" sebenarnya disembunyikan ke tray (aturan 62) —
        // focus() saja tidak memunculkannya, jadi klik toast tidak membuka apa pun.
        if (!window.isVisible()) window.show()
        window.flashFrame(false)
        window.focus()
      }
      onClick?.()
    })
    notification.on('failed', (_e, error) => logger().warn({ error }, 'notifikasi gagal tampil'))
    notification.show()
    logger().info({ title }, 'notifikasi ditampilkan')
    return true
  } catch (err) {
    logger().warn({ err: String(err) }, 'gagal menampilkan notifikasi')
    return false
  }
}

/** Berhenti mengedipkan taskbar saat user kembali ke aplikasi. */
export function clearAttention(): void {
  mainWindow()?.flashFrame(false)
}
