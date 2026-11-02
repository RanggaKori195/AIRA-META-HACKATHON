import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { loadConfig, saveConfig } from './config'
import { logger } from './logger'

/*
 * Ikon tray + "tutup jendela ≠ keluar" + ikut menyala saat Windows login.
 *
 * ⚠️ Ini bagian yang paling menentukan apakah chat AIRA berguna, dan ia bukan
 * fitur chat. Sebelum ini, menutup jendela = aplikasi mati = tidak ada satu pun
 * cara menghubungi orang itu, dan yang mengirim TIDAK TAHU — pesannya terlihat
 * terkirim, cuma tidak pernah sampai. Notifikasi sebagus apa pun tidak menolong
 * aplikasi yang sudah tidak berjalan.
 */

let tray: Tray | null = null
/** true = user benar-benar minta keluar, bukan sekadar menutup jendela. */
let benarBenarKeluar = false

/** Argumen yang dipakai saat AIRA dinyalakan Windows: langsung ke tray. */
export const ARG_TERSEMBUNYI = '--tersembunyi'

export function mulaiTersembunyi(): boolean {
  return process.argv.includes(ARG_TERSEMBUNYI)
}

/**
 * Menandai bahwa aplikasi memang akan keluar (dipakai auto-update).
 *
 * ⚠️ Tanpa ini, `quitAndInstall` bisa tertahan handler "tutup = sembunyikan":
 * jendela hanya disembunyikan, AIRA tidak pernah benar-benar keluar, dan
 * installer update tidak pernah berjalan.
 */
export function tandaiKeluar(): void {
  benarBenarKeluar = true
}

export function sedangKeluar(): boolean {
  return benarBenarKeluar
}

function ikon(): Electron.NativeImage {
  // Beberapa jangkar: dev (`resources/` di root project) dan terpasang
  // (`process.resourcesPath`). Pola yang sama dengan pencarian folder font &
  // tree-sitter — kalau salah satu meleset, yang lain menutup.
  const calon = [
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(__dirname, '../../resources/icon.ico'),
    join(process.resourcesPath, 'icon.ico')
  ]
  for (const p of calon) {
    if (!existsSync(p)) continue
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
  }
  // ⚠️ Tray tanpa ikon di Windows = kotak kosong yang tidak bisa diklik, dan
  // user tidak punya cara mengembalikan jendelanya. Lebih baik diketahui di log.
  logger().warn({ calon }, 'ikon tray tidak ditemukan')
  return nativeImage.createEmpty()
}

/**
 * "Tutup jendela" = sembunyikan ke tray, BUKAN keluar.
 *
 * ⚠️ `before-quit` WAJIB ikut dijaga: event itu juga dipicu saat Windows
 * shutdown/restart. Tanpa penanda di sana, handler `close` di bawah membatalkan
 * penutupan jendela dan MENAHAN proses shutdown Windows — pengguna melihat
 * "aplikasi ini mencegah Windows dimatikan", dan penyebabnya kita.
 */
function pasangTutupKeTray(win: BrowserWindow): void {
  app.on('before-quit', () => {
    benarBenarKeluar = true
  })
  win.on('close', (event) => {
    if (benarBenarKeluar) return
    event.preventDefault()
    win.hide()
  })
}

function tampilkan(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

export function pasangTray(win: BrowserWindow): void {
  // ⚠️ Handler `close` dipasang SEBELUM penjagaan "tray sudah ada" di bawah.
  // `createWindow()` bisa dipanggil lagi (event `activate`), dan kalau perilaku
  // "tutup = sembunyikan" ikut dilewati bersama pembuatan tray, jendela yang
  // baru itu akan benar-benar tertutup — aplikasinya mati diam-diam sementara
  // ikon tray-nya masih terlihat di taskbar. Memasangnya dua kali tidak apa:
  // yang kedua hanya menjalankan `hide()` pada jendela yang sudah disembunyikan.
  pasangTutupKeTray(win)
  if (tray && !tray.isDestroyed()) return
  try {
    tray = new Tray(ikon())
  } catch (err) {
    logger().warn({ err: String(err) }, 'tray gagal dipasang — aplikasi tetap jalan')
    return
  }
  tray.setToolTip('AIRA')

  const susunMenu = (): void => {
    const config = loadConfig()
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Buka AIRA', click: () => tampilkan(win) },
        { type: 'separator' },
        {
          label: 'Nyalakan otomatis saat Windows login',
          type: 'checkbox',
          checked: config.autoStart,
          click: (item) => {
            setAutoStart(item.checked)
            susunMenu()
          }
        },
        { type: 'separator' },
        {
          // ⚠️ Label sengaja "Keluar (pesan tidak akan masuk)". Tanpa keterangan
          // itu, orang menekan Keluar untuk merapikan taskbar lalu heran kenapa
          // tidak ada yang bisa menghubunginya — dan itu persis kegagalan yang
          // paling merusak kepercayaan pada chat.
          label: 'Keluar (pesan tidak akan masuk)',
          click: () => {
            benarBenarKeluar = true
            app.quit()
          }
        }
      ])
    )
  }
  susunMenu()

  tray.on('click', () => tampilkan(win))
  tray.on('double-click', () => tampilkan(win))

}

export function lepasTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}

/**
 * Menyalakan/mematikan autostart Windows.
 *
 * ⚠️ Keadaan sebenarnya dipegang OS, config hanya menyimpan pilihan user. Kalau
 * kelak keduanya berbeda (mis. admin mematikannya lewat Task Manager), yang
 * dipercaya adalah OS — lihat `samakanAutoStart`.
 */
export function setAutoStart(nyala: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: nyala,
      // Menyala langsung ke tray. Tanpa ini, tiap orang menyalakan laptop akan
      // disambut jendela AIRA yang merebut layar — dan mereka akan mematikan
      // autostart-nya, yang berarti chatnya kembali tidak bisa diandalkan.
      args: nyala ? [ARG_TERSEMBUNYI] : []
    })
    const config = loadConfig()
    config.autoStart = nyala
    config.autoStartDitanya = true
    saveConfig(config)
    logger().info({ nyala }, 'autostart Windows diubah')
  } catch (err) {
    logger().warn({ err: String(err) }, 'gagal mengubah autostart')
  }
}

/** Keadaan autostart menurut OS, bukan menurut config. */
export function autoStartAktif(): boolean {
  try {
    return app.getLoginItemSettings({ args: [ARG_TERSEMBUNYI] }).openAtLogin
  } catch {
    return false
  }
}

/**
 * Menyamakan config dengan keadaan OS saat start.
 *
 * Tanpa ini, Settings bisa menampilkan "menyala" untuk autostart yang sudah
 * dimatikan orang lewat Task Manager — dan saklar yang berbohong lebih buruk
 * daripada tidak ada saklar.
 */
export function samakanAutoStart(): void {
  try {
    const os = autoStartAktif()
    const config = loadConfig()
    if (config.autoStart !== os) {
      config.autoStart = os
      saveConfig(config)
      logger().info({ os }, 'config autostart disamakan dengan keadaan Windows')
    }
  } catch {
    /* config korup — biarkan, bukan alasan menggagalkan start */
  }
}
