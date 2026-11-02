import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { BUNDLED } from '../bundled-config'
import { IPC_CHANNELS, type StatusUpdate } from '../../shared/ipc'
import { mainWindow, notify } from '../notify'
import { tandaiKeluar } from '../tray'
import { jumlahRunAktif } from '../agent/orchestrator'
import * as db from '../db'
import { logger } from '../logger'
import {
  JEDA_CEK_MS,
  TUNDA_CEK_AWAL_MS,
  URL_UPDATE_BAWAAN,
  terjemahkanGalatUpdate,
  urlUpdateSah
} from './rules'

/*
 * Auto-update AIRA (17 Sep 2026) — electron-updater, provider "generic".
 *
 * Server cukup berkas statis: `latest.yml`, `AIRA Setup x.y.z.exe`, dan
 * `.blockmap` (dihasilkan `npm run dist`). Alurnya:
 *   cek -> ada versi baru -> unduh di latar -> "siap dipasang"
 *   -> user menekan Pasang (atau otomatis saat AIRA benar-benar ditutup).
 *
 * ⚠️ Pemasangan TIDAK PERNAH dipaksa di tengah pekerjaan. Menutup AIRA saat
 * jawaban sedang ditulis membuang jawaban itu; karena itu `pasangSekarang`
 * menolak selama ada run aktif, dan sisanya diserahkan ke
 * `autoInstallOnAppQuit` (terpasang diam-diam saat AIRA ditutup lewat tray).
 *
 * ⚠️ Keadaannya diumumkan ke renderer lewat event, dan juga bisa DITANYAKAN
 * (`statusUpdate`) — event yang terkirim sebelum renderer berlangganan hilang
 * tanpa jejak (pelajaran `initAuth`).
 */

let status: StatusUpdate = {
  tahap: 'diam',
  versiSekarang: '0.0.0',
  versiBaru: null,
  persen: null,
  pesan: null,
  terakhirCek: null
}
let timer: NodeJS.Timeout | null = null
let sudahDipasang = false

function setel(ubah: Partial<StatusUpdate>): void {
  status = { ...status, ...ubah }
  const win = mainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.updateBerubah, status)
}

export function statusUpdate(): StatusUpdate {
  return status
}

/**
 * Alamat server yang dipakai. Urutan: `.env` saat build -> bawaan.
 * Di mode dev, `process.env.AIRA_UPDATE_URL` boleh menimpa (menguji dengan
 * server lokal); di aplikasi terpasang TIDAK — variabel lingkungan laptop user
 * tidak boleh bisa mengarahkan AIRA memasang program dari tempat lain.
 */
function alamatServer(): string | null {
  const dev = !app.isPackaged ? process.env.AIRA_UPDATE_URL : undefined
  return urlUpdateSah(dev || BUNDLED.updateUrl || URL_UPDATE_BAWAAN)
}

/** Dipanggil sekali saat aplikasi siap. */
export function mulaiUpdate(): void {
  if (sudahDipasang) return
  sudahDipasang = true
  status.versiSekarang = app.getVersion()

  // Mode dev tidak bisa MEMASANG update (tidak ada installer yang menjalankannya),
  // tapi pemeriksaan & unduhannya bisa diuji dengan AIRA_UPDATE_DEV=1.
  const ujiDev = !app.isPackaged && process.env.AIRA_UPDATE_DEV === '1'
  if (!app.isPackaged && !ujiDev) {
    setel({ tahap: 'mati', pesan: 'Pembaruan otomatis hanya aktif di aplikasi terpasang.' })
    return
  }
  const url = alamatServer()
  if (!url) {
    setel({ tahap: 'mati', pesan: 'Alamat server update tidak sah (wajib HTTPS).' })
    logger().warn('auto-update mati: alamat server tidak sah')
    return
  }

  autoUpdater.logger = {
    info: (m: unknown) => logger().info({ updater: String(m) }, 'updater'),
    warn: (m: unknown) => logger().warn({ updater: String(m) }, 'updater'),
    error: (m: unknown) => logger().error({ updater: String(m) }, 'updater'),
    debug: (m: unknown) => logger().debug({ updater: String(m) }, 'updater')
  }
  autoUpdater.setFeedURL({ provider: 'generic', url })
  if (ujiDev) autoUpdater.forceDevUpdateConfig = true
  autoUpdater.autoDownload = true
  // Versi yang sudah terunduh terpasang diam-diam saat AIRA benar-benar ditutup.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  // Installer AIRA installer penuh, bukan web installer.
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('checking-for-update', () => setel({ tahap: 'memeriksa', pesan: null }))
  autoUpdater.on('update-not-available', () =>
    setel({ tahap: 'terbaru', pesan: null, terakhirCek: new Date().toISOString() })
  )
  autoUpdater.on('update-available', (info) => {
    logger().info({ versi: info.version }, 'update tersedia — mengunduh')
    db.audit('update', 'tersedia', `versi=${info.version}`)
    setel({
      tahap: 'mengunduh',
      versiBaru: info.version,
      persen: 0,
      pesan: null,
      terakhirCek: new Date().toISOString()
    })
  })
  autoUpdater.on('download-progress', (p) => {
    const persen = Math.floor(p.percent)
    if (persen !== status.persen) setel({ tahap: 'mengunduh', persen })
  })
  autoUpdater.on('update-downloaded', (info) => {
    logger().info({ versi: info.version }, 'update terunduh — siap dipasang')
    db.audit('update', 'siap', `versi=${info.version}`)
    setel({ tahap: 'siap', versiBaru: info.version, persen: 100, pesan: null })
    notify({
      title: `Pembaruan AIRA ${info.version} siap`,
      body: 'Pasang dari AIRA sekarang, atau biarkan terpasang otomatis saat AIRA ditutup.'
    })
  })
  autoUpdater.on('error', (err) => {
    const pesan = terjemahkanGalatUpdate(err)
    logger().warn({ err: String(err).slice(0, 300), pesan }, 'auto-update gagal')
    db.audit('update', 'galat', pesan.slice(0, 200))
    // Versi yang SUDAH siap tidak dibatalkan oleh galat pemeriksaan berikutnya.
    if (status.tahap !== 'siap') setel({ tahap: 'galat', pesan, persen: null })
  })

  const awal = setTimeout(() => void cekSekarang(), TUNDA_CEK_AWAL_MS)
  awal.unref()
  timer = setInterval(() => void cekSekarang(), JEDA_CEK_MS)
  timer.unref()
  logger().info({ url, ujiDev }, 'auto-update aktif')
}

export async function cekSekarang(): Promise<StatusUpdate> {
  if (status.tahap === 'mati' || status.tahap === 'siap') return status
  if (status.tahap === 'memeriksa' || status.tahap === 'mengunduh') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // Event 'error' sudah mengurus status; ini hanya supaya tidak jadi unhandled rejection.
    logger().debug({ err: String(err).slice(0, 160) }, 'cek update gagal')
  }
  return status
}

/** Menutup AIRA dan memasang versi yang sudah terunduh. */
export function pasangSekarang(): { ok: boolean; pesan: string } {
  if (status.tahap !== 'siap') {
    return { ok: false, pesan: 'Belum ada pembaruan yang siap dipasang.' }
  }
  if (!app.isPackaged) {
    return { ok: false, pesan: 'Mode dev tidak bisa memasang pembaruan — uji dari aplikasi terpasang.' }
  }
  const aktif = jumlahRunAktif()
  if (aktif > 0) {
    return {
      ok: false,
      pesan: 'AIRA masih mengerjakan jawaban. Tunggu sampai selesai, lalu pasang lagi.'
    }
  }
  logger().info({ versi: status.versiBaru }, 'memasang update atas permintaan user')
  db.audit('update', 'pasang', `versi=${status.versiBaru}`)
  tandaiKeluar()
  // Ditunda sedikit supaya balasan IPC sempat sampai ke renderer.
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 300)
  return { ok: true, pesan: 'AIRA akan ditutup, diperbarui, lalu dibuka kembali.' }
}

export function hentikanUpdate(): void {
  if (timer) clearInterval(timer)
  timer = null
}
