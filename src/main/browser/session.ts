import { BrowserWindow } from 'electron'
import { logger } from '../logger'
import { ToolError } from '../tools/types'
import {
  galatBelumDibuka,
  galatDitutup,
  galatDitutupSaatMemuat,
  galatJanganBukaUlang,
  galatNavigasiGagal,
  galatNavigasiTimeout,
  galatUrlTidakSah,
  kunciSitus
} from './rules'

// Kontrol browser memakai Chromium bawaan Electron — tanpa dependensi tambahan.
// Jendela sengaja TERLIHAT: user harus bisa memantau dan mengambil alih kapan pun.
// Halaman web adalah konten untrusted, jadi jendela ini tidak punya preload,
// tanpa akses Node, dan session-nya terpisah dari aplikasi.

const PARTITION = 'persist:aira-browser'
const NAV_TIMEOUT_MS = 45_000
const MAX_TEXT_CHARS = 15_000

let win: BrowserWindow | null = null

/**
 * Keadaan terakhir yang diketahui, TETAP HIDUP sesudah jendelanya mati.
 *
 * Gunanya cuma satu: membedakan "belum pernah dibuka" dari "sudah dibuka lalu
 * ditutup user". Dua keadaan itu menuntut langkah berbeda dari model, dan
 * jendela yang sudah `destroyed` tidak bisa ditanya URL-nya lagi.
 */
let pernahDibuka = false
let urlTerakhir = ''

/**
 * Situs yang jendelanya DITUTUP USER pada giliran chat yang sedang berjalan.
 *
 * Dibersihkan tiap giliran baru (`mulaiGiliran`), jadi user tetap bisa menyuruh
 * "buka lagi" di pesan berikutnya — yang dicegah hanya model yang membuka ulang
 * sendiri di dalam satu jawaban.
 */
const ditutupUser = new Set<string>()
/** Penutupan yang dilakukan AIRA sendiri, bukan user. */
let sedangTutupSendiri = false
/** Kunci situs yang TERAKHIR DIMINTA lewat `navigate()`, sebelum redirect. */
let kunciDiminta = ''

/** Dipanggil orchestrator di awal tiap giliran chat. */
export function mulaiGiliran(): void {
  ditutupUser.clear()
}

/**
 * ⚠️ `win.isDestroyed()` SENDIRIAN TIDAK CUKUP, dan ini akar dari tiga ronde
 * perbaikan yang semuanya benar tapi tidak pernah aktif.
 *
 * `BrowserWindow` baru menjawab `isDestroyed() === true` sesudah event `closed`
 * selesai, sementara `webContents`-nya sudah mati lebih dulu. Terukur di log
 * 27 Agu 2026: `loadURL` menolak `ERR_FAILED` pada 696800 karena webContents
 * sudah hancur, `win.isDestroyed()` saat itu masih `false`, dan `closed` baru
 * menyusul **26 ms kemudian**. Akibatnya `navigate()` menyimpulkan "halaman
 * berhasil dibuka" untuk jendela yang sedang sekarat, dan seluruh penanganan
 * "ditutup user" duduk di belakang gerbang yang tidak pernah terbuka.
 *
 * 26 ms itu juga yang membedakan tebakan dari bukti: tidak ada manusia yang
 * menutup jendela 26 ms sesudah halaman selesai dimuat.
 */
function isAlive(): boolean {
  return win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()
}

/** Menyimpan URL selagi jendelanya masih hidup — dipakai pesan galat nanti. */
function catatUrl(): void {
  if (isAlive()) urlTerakhir = (win as BrowserWindow).webContents.getURL()
}

export function ensureWindow(): BrowserWindow {
  if (isAlive()) return win as BrowserWindow
  win = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'AIRA Browser',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  pernahDibuka = true

  // ⚠️ Ditandai di `close`, BUKAN `closed`.
  //
  // `close` terpicu saat user menekan X dan webContents-nya MASIH HIDUP, jadi
  // URL-nya masih bisa ditanya. `closed` baru menyusul sesudah semuanya hancur —
  // terlalu telat untuk merekam alamat, dan terbukti terlambat 26 ms dari saat
  // `loadURL` sudah tahu jendelanya mati.
  win.on('close', () => {
    if (sedangTutupSendiri) return
    catatUrl()
    // ⚠️ DUA kunci, dan keduanya perlu. `urlTerakhir` adalah alamat AKHIR
    // sesudah redirect — detik.com melemparkan ke `finance.detik.com`, yang
    // kuncinya tidak akan pernah cocok dengan `detik.com` yang diminta model
    // berikutnya. Menyimpan yang diminta saja juga tidak cukup, karena user
    // bisa menutup jendela sesudah menjelajah sendiri ke tempat lain.
    if (kunciDiminta) ditutupUser.add(kunciDiminta)
    if (urlTerakhir) ditutupUser.add(kunciSitus(urlTerakhir))
  })

  win.on('closed', () => {
    logger().info({ urlTerakhir, olehUser: !sedangTutupSendiri }, 'jendela browser ditutup')
    win = null
  })
  // URL terakhir direkam selagi jendelanya masih hidup; sesudah 'closed'
  // webContents-nya sudah tidak bisa ditanya.
  win.webContents.on('did-navigate', catatUrl)
  win.webContents.on('did-navigate-in-page', catatUrl)
  return win
}

export function closeWindow(): void {
  sedangTutupSendiri = true
  try {
    if (isAlive()) win?.close()
    win = null
  } finally {
    sedangTutupSendiri = false
  }
}

/** Apakah user sudah menutup jendela untuk situs ini pada giliran ini. */
export function ditutupUserPadaGiliranIni(url: string): boolean {
  return ditutupUser.has(kunciSitus(url))
}

function requireWindow(): BrowserWindow {
  if (!isAlive()) throw pernahDibuka ? galatDitutup(urlTerakhir) : galatBelumDibuka()
  return win as BrowserWindow
}

export interface NavResult {
  url: string
  title: string
  /** Status HTTP halaman utama. 0 = tidak terdeteksi. */
  status: number
  statusText: string
}

export async function navigate(url: string): Promise<NavResult> {
  if (!/^https?:\/\//i.test(url)) throw galatUrlTidakSah(url)
  // ⚠️ Diperiksa SEBELUM `ensureWindow()` — kalau tidak, jendelanya sudah
  // terlanjur muncul kembali di layar user sebelum penolakannya sempat berlaku.
  if (ditutupUserPadaGiliranIni(url)) throw galatJanganBukaUlang(url)
  kunciDiminta = kunciSitus(url)
  const target = ensureWindow()
  // ⚠️ Ditangkap SEKARANG, selagi hidup. Mengakses `target.webContents` sesudah
  // jendelanya hancur melempar "Object has been destroyed"; pegangan ini tetap
  // bisa ditanya `isDestroyed()` kapan pun, dan ia yang tahu duluan.
  const wc = target.webContents
  const sudahMati = (): boolean => target.isDestroyed() || wc.isDestroyed()
  let status = 0
  let statusText = ''
  // Bukti bahwa main frame BENAR-BENAR berpindah ke halaman baru. Ini yang
  // dipercaya, bukan janji dari `loadURL()` — lihat catatan di bawah.
  let terkomit = false
  const onNavigate = (
    _e: unknown,
    _url: string,
    responseCode: number,
    responseText: string
  ): void => {
    terkomit = true
    status = responseCode
    statusText = responseText
  }
  wc.on('did-navigate', onNavigate)

  // Tiga cara berakhir, dan ketiganya HARUS berakhir.
  //
  // ⚠️ `loadURL()` TIDAK pernah settle bila jendelanya dimatikan di tengah
  // pemuatan. Tanpa lomba 'closed' di bawah, menutup jendela berarti menunggu
  // timeout 45 detik untuk sesuatu yang sudah pasti gagal sejak detik pertama.
  let timer: NodeJS.Timeout | undefined
  let onClosed: () => void = () => {}
  let galatMuat: unknown = null
  try {
    await Promise.race([
      target.loadURL(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(galatNavigasiTimeout(url, NAV_TIMEOUT_MS / 1000)),
          NAV_TIMEOUT_MS
        )
      }),
      new Promise<never>((_, reject) => {
        onClosed = (): void => reject(galatDitutupSaatMemuat(url))
        target.once('closed', onClosed)
      })
    ])
  } catch (err) {
    // ⚠️ JANGAN langsung percaya penolakan ini. Lihat blok panjang di bawah.
    galatMuat = err
  } finally {
    // ⚠️ Timer WAJIB dibersihkan. Tanpa ini setiap navigasi yang berhasil
    // meninggalkan timer 45 detik yang menahan event loop, dan pada jendela
    // yang sudah mati ia melempar rejection tanpa penerima.
    if (timer) clearTimeout(timer)
    // ⚠️ `webContents` jendela yang sudah `destroyed` melempar
    // "Object has been destroyed" saat DIAKSES — termasuk di blok `finally`,
    // yang membuat galat aslinya tertimpa galat lain yang menyesatkan.
    if (!wc.isDestroyed()) wc.off('did-navigate', onNavigate)
    if (!target.isDestroyed()) target.off('closed', onClosed)
  }

  if (sudahMati()) throw galatDitutupSaatMemuat(url)

  // ⚠️ `loadURL()` MENOLAK untuk halaman yang sebenarnya terbuka dengan baik.
  //
  // Begitu ada navigasi baru dimulai sebelum yang pertama selesai, Chromium
  // membatalkan yang pertama dan `loadURL()` menolak dengan `ERR_ABORTED` /
  // `ERR_FAILED` — padahal jendelanya menampilkan halaman yang benar. Situs
  // beriklan melakukan itu terus-menerus.
  //
  // Terjadi nyata 27 Agu 2026 saat menguji perbaikan browser: detik.com
  // TERBUKA dan terbaca di layar, iklan vignette Google memicu navigasi
  // susulan (`urlTerakhir` di log: `https://www.detik.com/#google_vignette`),
  // `loadURL()` menolak `ERR_FAILED`, dan AIRA melaporkan ke user bahwa
  // "koneksi jaringan ke detik.com bermasalah" — dua kali, dengan yakin,
  // sementara situsnya terpampang di depan mata. Salah satu bentuk terburuk:
  // jawaban percaya diri yang berlawanan dengan yang dilihat user.
  //
  // Karena itu yang dipercaya adalah BUKTI dari jendelanya sendiri —
  // `did-navigate` yang benar-benar terjadi — bukan laporan `loadURL()`.
  // Pola yang sama dengan aturan project "verifikasi, jangan percaya ringkasan".
  if (galatMuat && !terkomit) {
    if (galatMuat instanceof ToolError) throw galatMuat
    throw galatNavigasiGagal(url, String((galatMuat as Error)?.message ?? galatMuat).slice(0, 160))
  }
  if (galatMuat) {
    logger().info(
      { url, err: String((galatMuat as Error)?.message ?? galatMuat).slice(0, 160) },
      'loadURL menolak tapi halaman sudah ter-commit — navigasi dianggap berhasil'
    )
  }

  urlTerakhir = wc.getURL()
  return {
    url: urlTerakhir,
    title: wc.getTitle(),
    status,
    statusText
  }
}

/** Ringkasan singkat halaman untuk dilampirkan otomatis pada hasil browser_open. */
export async function pageSnapshot(maxChars = 1200): Promise<string> {
  try {
    return await run<string>(
      `((document.body ? document.body.innerText : '') || '').replace(/\\s+/g,' ').trim().slice(0, ${maxChars})`
    )
  } catch {
    return ''
  }
}

export function isSecure(): boolean {
  return currentUrl().toLowerCase().startsWith('https://')
}

async function run<T>(script: string): Promise<T> {
  const target = requireWindow()
  return (await target.webContents.executeJavaScript(script, true)) as T
}

/** Ringkasan halaman: teks terlihat + daftar elemen interaktif untuk dijadikan target aksi. */
export async function readPage(): Promise<string> {
  const script = `(() => {
    const clip = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
    const text = clip(document.body ? document.body.innerText : '', ${MAX_TEXT_CHARS});
    const pick = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: clip(el.getAttribute('aria-label') || el.innerText || el.value || '', 60)
    });
    const inputs = Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 40).map(pick);
    const clickables = Array.from(document.querySelectorAll('button,a[href],[role=button],input[type=submit]'))
      .slice(0, 60).map(pick).filter(e => e.label || e.id || e.name);
    return JSON.stringify({ url: location.href, title: document.title, text, inputs, clickables });
  })()`
  return run<string>(script)
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

/** Klik berdasarkan CSS selector, atau teks yang terlihat bila selector tidak diberikan. */
export async function click(target: { selector?: string; text?: string }): Promise<string> {
  const script = `(() => {
    const sel = ${jsString(target.selector ?? '')};
    const txt = ${jsString(target.text ?? '')};
    let el = null;
    if (sel) el = document.querySelector(sel);
    if (!el && txt) {
      const cands = Array.from(document.querySelectorAll('button,a,[role=button],input[type=submit],input[type=button]'));
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const want = norm(txt);
      el = cands.find(c => norm(c.innerText || c.value) === want)
        || cands.find(c => norm(c.innerText || c.value).includes(want));
    }
    if (!el) return JSON.stringify({ ok: false, error: 'elemen tidak ditemukan' });
    el.scrollIntoView({ block: 'center' });
    el.click();
    return JSON.stringify({ ok: true, clicked: (el.innerText || el.value || el.id || '').slice(0, 80) });
  })()`
  return run<string>(script)
}

/**
 * Mengisi field. Memakai native setter supaya framework (React/Vue) ikut mendeteksi
 * perubahan. `secret: true` menandai nilai tidak boleh muncul di log/hasil.
 */
export async function fillField(selector: string, value: string, secret = false): Promise<string> {
  const script = `(() => {
    const el = document.querySelector(${jsString(selector)});
    if (!el) return JSON.stringify({ ok: false, error: 'field tidak ditemukan' });
    const val = ${jsString(value)};
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    if (setter && setter.set) setter.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ ok: true, field: el.name || el.id || ${jsString(selector)} });
  })()`
  const result = await run<string>(script)
  if (secret) logger().info({ selector }, 'field rahasia diisi (nilai tidak dicatat)')
  return result
}

export async function pressEnter(selector?: string): Promise<string> {
  const script = `(() => {
    const el = ${selector ? `document.querySelector(${jsString(selector)})` : 'document.activeElement'};
    if (!el) return JSON.stringify({ ok: false, error: 'elemen tidak ditemukan' });
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
    return JSON.stringify({ ok: true });
  })()`
  return run<string>(script)
}

export async function screenshotDataUrl(): Promise<string> {
  const target = requireWindow()
  const image = await target.webContents.capturePage()
  return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`
}

export function currentUrl(): string {
  return isAlive() ? (win as BrowserWindow).webContents.getURL() : ''
}

export function isOpen(): boolean {
  return isAlive()
}
