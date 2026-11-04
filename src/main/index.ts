import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'path'
import { fakeMicActive } from '../shared/test-mic'
import { initDb, jumlahSesiTanpaPemilik } from './db'
import { registerIpcHandlers } from './ipc'
import { triggerAutoIndex } from './rag/auto'
import { killAll } from './tools/process-manager'
import { bersihkanRuangLama } from './uji/ruang'
import { clearAttention, setMainWindow } from './notify'
import { closeSplash, showSplash } from './splash'
import { BUNDLED } from './bundled-config'
import { checkLocalDbs } from './hackathon/local-db'
import { loadConfig, saveConfig } from './config'
import { setSecret } from './secrets'
import { invalidate as invalidateMcp } from './mcp/manager'
import { initAuth, setOnSesiBerubah, setOnSesiDicabut } from './auth/service'
import { hangatkanSalesPool } from './sales/db'
import { mulaiTersembunyi, pasangTray, samakanAutoStart, sedangKeluar } from './tray'
import { tutupJendelaLencana } from './chat/lencana'
import { hentikanPantauChat, mulaiPantauChat } from './chat/notifikasi'
import { hentikanKirimAktivitas, mulaiKirimAktivitas } from './monitoring/service'
import { hentikanUpdate, mulaiUpdate } from './update/service'
import { hentikanJadwal, mulaiJadwal } from './jadwal/service'
import { IPC_CHANNELS } from '../shared/ipc'
import { logger } from './logger'

// Crash-proofing: error tak tertangkap dicatat, bukan menjatuhkan aplikasi.
process.on('uncaughtException', (err) => {
  try {
    logger().error({ err: String(err?.stack ?? err) }, 'uncaughtException')
  } catch {
    /* logger sendiri gagal — tidak ada yang bisa dilakukan */
  }
})
process.on('unhandledRejection', (reason) => {
  try {
    logger().error({ err: String(reason) }, 'unhandledRejection')
  } catch {
    /* noop */
  }
})

// Single instance — klik icon kedua memfokuskan window yang ada.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/**
 * Mode produksi = dijalankan dari installer, bukan dari `npm run dev`.
 *
 * `app.isPackaged` dipakai, bukan `NODE_ENV`: variabel lingkungan bisa disetel
 * siapa pun saat menjalankan aplikasi, jadi memakainya sebagai penentu berarti
 * pengerasan di bawah bisa dimatikan dari luar tanpa menyentuh aplikasinya.
 */
const PRODUKSI = app.isPackaged

/**
 * Menutup DevTools di build produksi.
 *
 * Tanpa ini, seluruh pengerasan build tidak ada artinya: Ctrl+Shift+I membuka
 * inspector yang menampilkan kode renderer, isi state React, dan setiap pesan IPC
 * yang lewat — termasuk yang membawa data penjualan dan daftar user. Menu bawaan
 * Electron tetap memasang pintasan itu walau menu bar-nya disembunyikan.
 *
 * Dipasang di `web-contents-created` supaya berlaku untuk SEMUA webContents —
 * jendela utama, splash, dan halaman yang dibuka modul browser — bukan hanya
 * jendela yang kebetulan diingat di sini.
 */
function hardenWebContents(): void {
  if (!PRODUKSI) return
  // Menu bawaan Electron memuat butir "Toggle Developer Tools" beserta pintasannya.
  // `autoHideMenuBar` hanya MENYEMBUNYIKAN menunya — menekan Alt memunculkannya lagi.
  Menu.setApplicationMenu(null)
  app.on('web-contents-created', (_event, contents) => {
    contents.on('devtools-opened', () => contents.closeDevTools())
    contents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase()
      const toggleDevtools =
        key === 'f12' || (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c'))
      // Ctrl+R / F5 ikut ditutup: memuat ulang renderer di tengah run agent
      // meninggalkan run yatim di main process.
      const reload = key === 'f5' || (input.control && (key === 'r' || key === 'w'))
      if (toggleDevtools || reload) event.preventDefault()
    })
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#faf9f7',
    autoHideMenuBar: true,
    title: 'AIRA',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Hardening: renderer tidak punya akses Node sama sekali.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  setMainWindow(mainWindow)

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    // Dinyalakan Windows saat login -> langsung ke tray, jangan merebut layar
    // orang yang baru menyalakan laptop. Jendelanya tetap dimuat penuh, jadi
    // pesan masuk & notifikasi sudah jalan sejak detik pertama.
    if (mulaiTersembunyi()) {
      logger().info('AIRA dimulai tersembunyi di tray (autostart Windows)')
      return
    }
    mainWindow?.show()
  })

  // Tray dipasang SESUDAH jendelanya ada: ia yang memegang perilaku
  // "tutup = sembunyikan", dan tanpa jendela tidak ada yang bisa dikembalikan.
  pasangTray(mainWindow)
  // Hentikan kedipan taskbar begitu user kembali ke aplikasi.
  mainWindow.on('focus', () => clearAttention())

  // Link eksternal dibuka di browser OS, tidak pernah di dalam app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    // ⚠️ `show()` WAJIB ikut sejak jendela bisa disembunyikan ke tray. Tanpa
    // ini, mengklik ikon AIRA saat ia sedang di tray tidak melakukan apa pun:
    // instance kedua keluar karena kalah single-instance lock, dan yang pertama
    // hanya di-focus tanpa pernah terlihat.
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

/**
 * Semua kredensial dibawa aplikasi (dari .env saat build) — user tidak pernah
 * diminta mengisi apa pun. Nilai dari bundle selalu menang supaya rotasi key
 * cukup dilakukan lewat build baru, dan tetap disimpan terenkripsi (DPAPI).
 */
function applyBundledCredentials(): void {
  try {
    const config = loadConfig()

    if (BUNDLED.apiKey) {
      setSecret('llmApiKey', BUNDLED.apiKey)
      config.endpoint = BUNDLED.endpoint
      config.modelId = BUNDLED.modelId
    }
    if (BUNDLED.youKey) setSecret('youApiKey', BUNDLED.youKey)

    // MCP Exa dipasang otomatis dengan key dari bundle.
    if (BUNDLED.exaKey) {
      const url = `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(BUNDLED.exaKey)}`
      const existing = config.mcpServers.find((s) => s.name === 'exa')
      if (!existing || existing.url !== url) {
        config.mcpServers = [
          ...config.mcpServers.filter((s) => s.name !== 'exa'),
          { name: 'exa', url, requireApproval: false, enabled: true }
        ]
        invalidateMcp('exa')
      }
    }

    saveConfig(config)
    logger().info(
      {
        endpoint: config.endpoint,
        model: config.modelId,
        webSearch: Boolean(BUNDLED.youKey),
        exa: Boolean(BUNDLED.exaKey)
      },
      'bundled credentials applied'
    )
  } catch (err) {
    logger().warn({ err: String(err) }, 'failed to apply bundled credentials')
  }
}

// Wajib di Windows agar notifikasi tampil dengan nama & ikon aplikasi.
app.setAppUserModelId('ai.aira.hackathon')

app.whenReady().then(() => {
  // A test launch left running hears a recording instead of the user — say so in the log (the mascot shows it too).
  if (fakeMicActive((s) => app.commandLine.hasSwitch(s))) logger().warn('fake microphone switch is on — voice turns hear a test recording')
  // Hackathon build: refuse to run at all if ANY database variable points off this machine —
  // before a pool, a migration or a window exists (pools also check, but only when first used).
  const nonLocal = checkLocalDbs({
    AIRA_SALES_DB: BUNDLED.salesDb,
    AIRA_LOGIN_DB: BUNDLED.loginDb,
    AIRA_INNO_DB: BUNDLED.innoDb
  })
  if (nonLocal.length > 0) {
    logger().error({ nonLocal }, 'non-local database refused')
    console.error(`non-local database refused: ${nonLocal.join(' | ')}`)
    dialog.showErrorBox('AIRA hackathon build', nonLocal.join('\n'))
    app.exit(1)
    return
  }
  hardenWebContents()
  showSplash()
  initDb()
  // Sesi dari sebelum riwayat dipisah per user tidak punya pemilik, jadi tidak
  // lagi muncul di sidebar siapa pun (lihat migrasi 5 di `db.ts`). Datanya tidak
  // dihapus. Dicatat di sini supaya keluhan "riwayat chat saya hilang" bisa
  // dijawab dengan angka dari log, bukan dengan tebakan — dan supaya kita tahu
  // sejak awal berapa banyak yang terdampak.
  const yatim = jumlahSesiTanpaPemilik()
  if (yatim > 0) {
    logger().info(
      { sesi: yatim },
      'ada riwayat chat lama tanpa pemilik — tidak ditampilkan, tapi tidak dihapus'
    )
  }
  applyBundledCredentials()
  registerIpcHandlers()

  // Sesi yang dicabut di tengah jalan (user diblokir Super Admin, atau masa berlaku
  // akunnya habis saat aplikasi sedang terbuka) harus melempar user kembali ke layar
  // login — bukan menunggu sampai ia menutup aplikasi. Tanpa ini, pilihan "ingat
  // sampai logout manual" berarti pemblokiran tidak berlaku sampai laptopnya restart.
  setOnSesiDicabut(() => {
    mainWindow?.webContents.send(IPC_CHANNELS.authRevoked)
  })
  // Menu/divisi/role berubah saat aplikasi terbuka (Super Admin mengubah matriks,
  // revalidasi 5 menit). Tanpa ini sidebar memegang daftar menu dari saat login.
  setOnSesiBerubah((s) => {
    mainWindow?.webContents.send(IPC_CHANNELS.authSessionChanged, s)
  })

  // Keadaan autostart dibaca dari OS, bukan dari config — saklar yang berbohong
  // lebih buruk daripada tidak ada saklar.
  samakanAutoStart()

  createWindow()
  logger().info(
    { version: app.getVersion(), tersembunyi: mulaiTersembunyi() },
    'AIRA started'
  )

  // Ruang uji percakapan lama dibuang saat start. Sesi yang dihapus user sudah
  // membersihkan ruangnya sendiri, tapi percakapan yang tidak pernah dihapus
  // meninggalkan foldernya — dan folder yang tumbuh diam-diam adalah persis
  // jenis kegagalan sunyi yang berulang di project ini.
  bersihkanRuangLama()

  // Skema login + pemulihan sesi berjalan di latar: kalau database sedang tidak
  // terjangkau, jendela tetap muncul dan user melihat layar login dengan pesan
  // yang bisa ditindaklanjuti — bukan splash yang menggantung.
  //
  // Selesainya TIDAK diberitahukan lewat event. Jendela bisa selesai memuat lebih
  // dulu atau lebih belakangan daripada ini, dan event yang terkirim sebelum
  // renderer sempat berlangganan akan hilang tanpa jejak — renderer lalu menunggu
  // selamanya. Renderer menanyakan `auth:state` sampai `initialized` bernilai true.
  void initAuth().then((sesi) => {
    logger().info({ sesi: sesi ? `${sesi.username}/${sesi.role}` : null }, 'auth siap')
  })

  // Buka koneksi database penjualan lebih awal, di latar belakang. Percobaan
  // koneksi pertama adalah yang paling rawan gagal di dalam Electron — lebih baik
  // itu terjadi saat aplikasi baru dibuka daripada saat user menunggu jawaban.
  setTimeout(() => hangatkanSalesPool(), 2000)

  // Index dokumen berjalan otomatis di background, jangan blokir startup.
  setTimeout(() => triggerAutoIndex('startup'), 5000)

  // Pengawas pesan chat masuk. Dimulai sekali dan berjalan seumur aplikasi —
  // siapa yang diawasi dibaca ulang dari sesi tiap putaran, jadi login, logout,
  // dan pergantian user tidak perlu disambungkan satu per satu.
  mulaiPantauChat()

  // Pengirim catatan pemakaian (antrean SQLite -> tb_aktivitas_aira). Berjalan
  // seumur aplikasi; catatan yang belum terkirim tetap di antrean saat offline.
  mulaiKirimAktivitas()

  // Auto-update (hanya aplikasi terpasang). Pemeriksaan pertama ditunda satu
  // menit supaya tidak berebut jaringan dengan login & pemanasan database.
  mulaiUpdate()

  // Tugas terjadwal (menu Jadwal). Berjalan seumur aplikasi — termasuk saat
  // jendelanya tersembunyi di tray; hanya tugas milik user yang sedang login.
  mulaiJadwal()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  killAll()
  hentikanPantauChat()
  hentikanKirimAktivitas()
  hentikanUpdate()
  hentikanJadwal()
  tutupJendelaLencana()
})

app.on('window-all-closed', () => {
  // ⚠️ Sejak jendela bisa disembunyikan ke tray, event ini hanya boleh
  // mematikan aplikasi bila user memang MEMINTA keluar. Tanpa penjagaan ini,
  // aplikasi tetap mati begitu jendelanya ditutup — dan seluruh gunanya tray
  // (pesan tetap masuk saat jendelanya dirapikan) hilang tanpa jejak.
  if (sedangKeluar() || process.platform !== 'win32') app.quit()
})
