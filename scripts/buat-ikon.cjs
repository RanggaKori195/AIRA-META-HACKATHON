// Mengubah ikon Lucide (SVG) menjadi PNG di `resources/ikon`.
//
// Jalankan:  npm run buat:ikon
//
// Kenapa PNG dan bukan SVG langsung ke PowerPoint: terukur 21 Agu 2026,
// pptxgenjs menerima SVG lalu menulis "fallback" PNG yang isinya justru byte
// SVG mentah. PowerPoint 365 selamat (membaca svgBlip), tapi PowerPoint lama,
// LibreOffice, dan pratinjau Windows menampilkan gambar rusak — tanpa pesan.
//
// Kenapa dijalankan di ELECTRON dan bukan Node biasa: mengubah SVG jadi piksel
// butuh mesin gambar. Chromium sudah ada di dalam Electron, jadi ini nol
// dependensi runtime baru — pola yang sama dengan `coba-pdf.cjs`.
//
// Kenapa saat build dan bukan saat aplikasi jalan: ikonnya tetap, jumlahnya
// puluhan, dan membuka jendela Chromium setiap kali user minta presentasi
// adalah biaya yang tidak perlu dibayar berulang.
//
// `lucide-static` hanya devDependency — yang ikut ke installer cuma PNG-nya.

process.env.AIRA_LOG_SILENT = '1'

const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const { IKON } = require('./.ikon-bundle.cjs')

const AKAR = join(__dirname, '..')
const SUMBER = join(AKAR, 'node_modules', 'lucide-static', 'icons')
const TUJUAN = join(AKAR, 'resources', 'ikon')

// 192 px untuk ikon yang dipakai 0,3-0,6 inci di slide. Pada 300 dpi, 0,6 inci
// = 180 px — jadi ini masih tajam saat deck-nya dicetak, bukan cuma di layar.
const SISI = 192
const TEPI = 12

const WARNA = { hijau: '#027733', putih: '#FFFFFF' }

/** SVG Lucide memakai `currentColor`; warnanya ditanam di sini. */
function svgBerwarna(nama, warna) {
  const berkas = join(SUMBER, `${nama}.svg`)
  if (!existsSync(berkas)) throw new Error(`ikon Lucide tidak ada: ${nama}.svg`)
  return readFileSync(berkas, 'utf8')
    .replace(/currentColor/g, warna)
    .replace(/width="24"/, `width="${SISI}"`)
    .replace(/height="24"/, `height="${SISI}"`)
}

async function main() {
  await app.whenReady()
  mkdirSync(TUJUAN, { recursive: true })

  const win = new BrowserWindow({
    show: false,
    width: SISI,
    height: SISI,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
  })
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<!doctype html><meta charset="utf-8"><body style="margin:0"><canvas id="c" width="${SISI}" height="${SISI}"></canvas>`
      )
  )

  const daftar = [...new Set(Object.values(IKON))].sort()
  let jadi = 0
  const gagal = []

  for (const nama of daftar) {
    for (const [labelWarna, kode] of Object.entries(WARNA)) {
      const svg = svgBerwarna(nama, kode)
      const url =
        'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
      // Digambar di dalam halaman: Chromium yang merender SVG-nya, lalu
      // canvas yang mengubahnya jadi PNG sungguhan.
      const dataUrl = await win.webContents.executeJavaScript(`
        new Promise((selesai, gagal) => {
          const c = document.getElementById('c')
          const ctx = c.getContext('2d')
          ctx.clearRect(0, 0, ${SISI}, ${SISI})
          const img = new Image()
          img.onload = () => {
            const isi = ${SISI} - ${TEPI} * 2
            ctx.drawImage(img, ${TEPI}, ${TEPI}, isi, isi)
            selesai(c.toDataURL('image/png'))
          }
          img.onerror = () => gagal(new Error('SVG gagal dimuat'))
          img.src = ${JSON.stringify(url)}
        })
      `)
      const png = Buffer.from(dataUrl.split(',')[1], 'base64')
      // Pemeriksaan yang menahan kegagalan sunyi: berkas HARUS PNG sungguhan
      // dan tidak boleh kosong. Kanvas yang gagal menggambar tetap
      // mengembalikan data URL yang sah — isinya saja yang transparan.
      if (png.length < 200 || png.subarray(1, 4).toString('latin1') !== 'PNG') {
        gagal.push(`${nama}-${labelWarna}`)
        continue
      }
      writeFileSync(join(TUJUAN, `${nama}-${labelWarna}.png`), png)
      jadi++
    }
  }

  console.log(`ikon dibuat: ${jadi} berkas (${daftar.length} ikon x 2 warna) -> ${TUJUAN}`)
  if (gagal.length) {
    console.error(`GAGAL: ${gagal.join(', ')}`)
    app.exit(1)
    return
  }
  app.exit(0)
}

main().catch((err) => {
  console.error('buat-ikon gagal:', err)
  app.exit(1)
})
