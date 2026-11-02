import { BrowserWindow, app } from 'electron'
import { readFileSync } from 'fs'
import { fontDataUrl } from './fonts'
import { join } from 'path'

// Splash screen saat aplikasi dibuka. Ditampilkan sampai jendela utama siap,
// supaya user tidak melihat layar kosong saat database & index disiapkan.

let splash: BrowserWindow | null = null

function logoDataUrl(): string {
  // Di dev berkas ada di sumber; setelah di-package ikut ke resources.
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'aira-logo.png')
  ]
  for (const file of candidates) {
    try {
      return `data:image/png;base64,${readFileSync(file).toString('base64')}`
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return ''
}

export function showSplash(): void {
  splash = new BrowserWindow({
    width: 420,
    height: 480,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#ffffff',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  })

  // Splash dimuat dari string HTML, jadi fontnya harus ikut TERTANAM sebagai
  // data URL — tidak ada folder tempat menaruh berkas pendamping. ~37 KB, dan
  // hanya dibaca sekali saat aplikasi dibuka.
  const font = fontDataUrl('CompanySerif-Regular.woff2')
  const fontCss = font
    ? `@font-face { font-family:'company serif font'; src:url('${font}') format('woff2'); font-weight:400; font-display:block; }`
    : ''

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  ${fontCss}
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:22px; background:#ffffff; font-family:'company serif font','Segoe UI',system-ui,serif; user-select:none;
  }
  img { width:230px; animation:rise .6s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
  .bar { width:190px; height:4px; border-radius:2px; background:#e6e3da; overflow:hidden; }
  .bar i { display:block; width:40%; height:100%; border-radius:2px; background:linear-gradient(90deg,#7ac143,#1f3b34); animation:slide 1.15s ease-in-out infinite; }
  @keyframes slide { 0% { transform:translateX(-110%); } 100% { transform:translateX(360%); } }
  p { font-size:12px; letter-spacing:.4px; color:#6d6a62; }
</style></head><body>
  <img src="${logoDataUrl()}" alt="AIRA" />
  <div class="bar"><i></i></div>
  <p>Menyiapkan asisten…</p>
</body></html>`

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash?.show())
}

export function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}
