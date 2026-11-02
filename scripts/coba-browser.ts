/**
 * BUKTI perilaku browser saat jendelanya DITUTUP — di runtime Electron.
 *
 * Kenapa ini ada, dan kenapa berbentuk skrip dan bukan unit test:
 *
 * Bug "AIRA sedang berpikir terus sesudah browser ditutup" butuh TIGA ronde
 * perbaikan (26–27 Agu 2026) dan tetap tidak selesai, karena setiap ronde
 * diuji dengan cara meminta user mencobanya sendiri lalu menebak dari
 * ceritanya. Dua ronde pertama benar tapi TIDAK PERNAH AKTIF: gerbangnya
 * memakai `win.isDestroyed()`, yang masih menjawab `false` sampai 26 ms
 * sesudah `webContents`-nya mati.
 *
 * Yang tidak bisa ditangkap unit test: `session.ts` mengimpor `electron`, dan
 * perilaku yang salah HANYA muncul di runtime Chromium sungguhan — persis
 * pelajaran yang sudah tertulis di HANDOFF §7 untuk `pool.connect()` dan PDF.
 * Karena itu skrip ini menutup jendelanya sendiri pada titik-titik waktu yang
 * bermasalah, dan memeriksa apa yang SEBENARNYA dilihat kode.
 *
 * Jalankan: npm run coba:browser
 */
import { app } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.AIRA_LOG_SILENT = '1'

import * as browser from '../src/main/browser/session'
import { kunciSitus } from '../src/main/browser/rules'

const masalah: string[] = []
let nomor = 0

function periksa(judul: string, lolos: boolean, detail: string): void {
  nomor++
  console.log(`${lolos ? 'OK  ' : 'GAGAL'} ${nomor}. ${judul}`)
  console.log(`       ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

/**
 * Server lokal supaya ujinya tidak bergantung jaringan the company maupun iklan
 * detik.com. `/lambat` sengaja menahan respons, untuk menguji penutupan yang
 * terjadi SELAGI halaman masih dimuat.
 */
function mulaiServer(): Promise<{ server: Server; asal: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const kirim = (): void => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><head><title>Halaman Uji</title></head><body><h1>halo</h1></body></html>')
      }
      if (req.url?.startsWith('/lambat')) setTimeout(kirim, 4000)
      else kirim()
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({ server, asal: `http://127.0.0.1:${port}` })
    })
  })
}

function pesan(err: unknown): string {
  return String((err as Error)?.message ?? err)
}

async function jalan(): Promise<void> {
  const { server, asal } = await mulaiServer()

  // ---- 1. Halaman biasa: harus berhasil, tanpa drama -----------------------
  browser.mulaiGiliran()
  const hasil = await browser.navigate(`${asal}/`)
  periksa(
    'halaman normal terbuka dan dilaporkan berhasil',
    hasil.title === 'Halaman Uji' && browser.isOpen(),
    `title="${hasil.title}" status=${hasil.status} isOpen=${browser.isOpen()}`
  )

  // ---- 2. Ditutup SESUDAH termuat: tool lain harus tahu --------------------
  //
  // Inilah kasus demo. Sebelum perbaikan, `browser_read` melempar Error biasa
  // sehingga model cuma diberi tahu "tool gagal dijalankan".
  browser.ensureWindow().close()
  await new Promise((r) => setTimeout(r, 50))
  let galatBaca = ''
  try {
    await browser.readPage()
  } catch (err) {
    galatBaca = pesan(err)
  }
  periksa(
    'membaca halaman sesudah jendela ditutup menyebut sebabnya',
    /DITUTUP OLEH USER/.test(galatBaca),
    galatBaca.slice(0, 120) || '(tidak melempar apa pun — ini bug)'
  )
  periksa(
    'pesannya melarang membuka ulang sendiri',
    /JANGAN membukanya ulang/.test(galatBaca),
    galatBaca.includes('JANGAN membukanya ulang') ? 'larangan ada' : 'larangan TIDAK ada'
  )
  periksa(
    'isOpen() jujur bahwa jendelanya sudah tidak ada',
    browser.isOpen() === false,
    `isOpen=${browser.isOpen()}`
  )

  // ---- 3. Buka ulang di giliran yang SAMA harus DITOLAK --------------------
  //
  // Terjadi 27 Agu 2026: user menutup jendela, model membukanya lagi, user
  // menutup lagi, model minta izin untuk KETIGA kalinya.
  let galatUlang = ''
  try {
    await browser.navigate(`${asal}/`)
  } catch (err) {
    galatUlang = pesan(err)
  }
  periksa(
    'membuka ulang situs yang baru ditutup user DITOLAK',
    /DITOLAK dengan sengaja/.test(galatUlang),
    galatUlang.slice(0, 120) || '(jendela dibuka lagi — ini bug yang dikeluhkan user)'
  )
  periksa(
    'penolakan terjadi TANPA memunculkan jendela baru',
    browser.isOpen() === false,
    `isOpen=${browser.isOpen()}`
  )

  // ---- 4. Giliran baru: user berhak minta lagi -----------------------------
  browser.mulaiGiliran()
  const lagi = await browser.navigate(`${asal}/`)
  periksa(
    'giliran baru boleh membuka situs yang sama',
    lagi.title === 'Halaman Uji' && browser.isOpen(),
    `title="${lagi.title}" isOpen=${browser.isOpen()}`
  )

  // ---- 5. Ditutup SELAGI memuat: gagal seketika, bukan menunggu 45 detik ---
  //
  // ⚠️ Ini gerbang yang selama tiga ronde tidak pernah terbuka: `loadURL`
  // menolak ERR_FAILED karena webContents sudah mati, tapi `win.isDestroyed()`
  // masih `false`, sehingga kodenya menyimpulkan "berhasil".
  browser.mulaiGiliran()
  browser.closeWindow()
  await new Promise((r) => setTimeout(r, 50))
  const mulai = Date.now()
  let galatMuat = ''
  const menuju = browser.navigate(`${asal}/lambat`).catch((err) => {
    galatMuat = pesan(err)
    return null
  })
  setTimeout(() => {
    if (browser.isOpen()) browser.ensureWindow().close()
  }, 600)
  await menuju
  const lama = Date.now() - mulai
  periksa(
    'ditutup selagi memuat: dilaporkan sebagai penutupan, bukan "berhasil"',
    /ditutup sebelum/.test(galatMuat),
    galatMuat.slice(0, 120) || '(navigasi dilaporkan BERHASIL padahal jendelanya ditutup — ini bug)'
  )
  periksa(
    'gagalnya seketika, tidak menunggu timeout 45 detik',
    lama < 5000,
    `${lama} ms`
  )

  // ---- 6. Kunci situs: varian www tidak boleh jadi celah -------------------
  periksa(
    'www dan telanjang dihitung situs yang sama',
    kunciSitus('https://www.detik.com/') === kunciSitus('https://detik.com'),
    `${kunciSitus('https://www.detik.com/')} vs ${kunciSitus('https://detik.com')}`
  )

  browser.closeWindow()
  server.close()
}

// ⚠️ Tanpa ini Electron KELUAR sendiri begitu jendela browser ditutup —
// dan seluruh uji ini memang bekerja dengan cara menutup jendela. Gejalanya
// menyesatkan: skripnya berhenti diam-diam sesudah pemeriksaan pertama,
// tanpa error, seolah menggantung.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  try {
    await jalan()
  } catch (err) {
    masalah.push(`skrip berhenti: ${pesan(err)}`)
    console.error(err)
  }
  console.log('')
  if (masalah.length) {
    console.log(`ADA ${masalah.length} MASALAH:`)
    for (const m of masalah) console.log(`  - ${m}`)
  } else {
    console.log(`Semua ${nomor} pemeriksaan lolos.`)
  }
  app.exit(masalah.length ? 1 : 0)
})
