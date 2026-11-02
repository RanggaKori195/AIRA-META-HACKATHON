// Bukti bahwa pembuatan presentasi benar-benar bekerja — dijalankan di runtime
// ELECTRON, sama seperti aplikasinya.
//
// Jalankan:  npm run coba:ppt
//
// Kenapa ada: pelajaran berulang di project ini adalah "hijau di test, salah di
// berkas hasilnya" (HANDOFF §7). Unit test hanya bisa mengunci hitungan muat dan
// aturan penolakan; yang TIDAK bisa dibuktikan unit test adalah bahwa berkas
// .pptx-nya sah, gambar latarnya benar-benar tertanam, ikonnya PNG SUNGGUHAN,
// dan tidak ada kotak yang keluar dari slide.
//
// Tiga pemeriksaan di bawah ini masing-masing lahir dari kegagalan yang SUNYI:
//   1. Kotak keluar slide     -> teks meluber, berkas tetap terbit tanpa error
//   2. Berkas media palsu     -> pptxgenjs menulis byte SVG ke dalam berkas .png
//   3. Font tidak terpasang   -> PowerPoint mengganti huruf tanpa pesan apa pun

process.env.AIRA_LOG_SILENT = '1'

import { app, BrowserWindow } from 'electron'
import { readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'
import { tulisPresentasi, type SlideSpec } from '../src/main/ppt/render'
import { FONT_DIPAKAI, SLIDE } from '../src/main/ppt/tema'
import { anggaran, barisTeks } from '../src/main/ppt/muat'

const CONTOH: SlideSpec[] = [
  {
    layout: 'sampul',
    judul: 'AURA Clinical GenAI',
    // Sengaja panjang: subjudul sepanjang inilah yang pada deck sungguhan
    // pertama menimpa judul dan catatan sekaligus.
    subjudul: 'Expertise Within — Platform AI Generatif On-Premise untuk the lab (the company)',
    catatan: 'Disusun oleh AIRA - 21 Agustus 2026'
  },
  {
    layout: 'agenda',
    item: [
      'Ringkasan kinerja',
      'Pencapaian terhadap target',
      'Item dengan pertumbuhan tertinggi',
      'Pelanggan yang melemah',
      'Proyeksi tutup bulan',
      'Rencana tindak lanjut'
    ]
  },
  { layout: 'bagian', judul: 'Ringkasan Kinerja', subjudul: 'Basis invoice, transfer batal dikecualikan' },
  {
    layout: 'angka',
    judul: 'Tiga angka yang perlu diketahui',
    kartu: [
      { nilai: 'Rp 4,11 M', label: 'Nett Agustus 2026 s.d. hari ini', ikon: 'uang' },
      { nilai: '+98,0%', label: 'Pertumbuhan YTD dibanding 2025', ikon: 'tren-naik' },
      { nilai: '5.711', label: 'Order masuk bulan berjalan', ikon: 'pelanggan' }
    ],
    catatan: 'Sumber: SalesRepository, hanya baris yang diakui.'
  },
  {
    layout: 'poin',
    judul: 'Temuan utama',
    poin: [
      { teks: 'Pertumbuhan ditopang kenaikan volume pemeriksaan, bukan kenaikan harga satuan.', ikon: 'tren-naik' },
      { teks: 'Cabang kedua mulai menyumbang di atas 20% sejak Mei 2026.', ikon: 'gedung' },
      { teks: 'Backlog order tanpa hasil masih 2.141 baris dan perlu ditelusuri bersama tim operasional.', ikon: 'peringatan' }
    ]
  },
  {
    layout: 'dua-kolom',
    judul: 'Yang menguat dan yang melemah',
    kiri: { judul: 'Menguat', poin: ['Panel imunologi', 'Pemeriksaan genomik', 'Paket MCU korporat'] },
    kanan: { judul: 'Melemah', poin: ['Pemeriksaan rutin walk-in', 'Paket promo lama', 'Kanal rujukan tertentu'] }
  },
  {
    layout: 'grafik',
    judul: 'Nett per bulan (Rp miliar)',
    jenis: 'batang',
    label: ['Mar', 'Apr', 'Mei', 'Jun', 'Jul'],
    seri: [{ nama: 'Nett', nilai: [2.8, 3.05, 3.4, 3.72, 4.02] }],
    catatan: 'Angka Juli sudah final; Agustus masih berjalan.'
  },
  {
    layout: 'tabel',
    judul: 'Lima item penyumbang terbesar',
    kolom: ['Item', 'Nett (Rp juta)', 'Kontribusi'],
    baris: [
      ['Panel Imunologi Lengkap', '812', '19,8%'],
      ['Pemeriksaan Genomik', '654', '15,9%'],
      ['MCU Korporat Silver', '498', '12,1%'],
      ['Kultur & Sensitivitas', '331', '8,1%'],
      ['Panel Alergi', '287', '7,0%']
    ],
    catatan: 'Kontribusi dihitung terhadap nett periode yang sama.'
  },
  // Sengaja dibuat kepanjangan: harus otomatis pecah jadi dua slide.
  {
    layout: 'poin',
    judul: 'Uji pemecahan otomatis',
    poin: Array.from(
      { length: 12 },
      (_, i) =>
        `Butir nomor ${i + 1} yang sengaja ditulis panjang supaya terlihat apakah pemecahan slide otomatis benar-benar bekerja saat isinya melebihi tinggi badan slide.`
    )
  },
  { layout: 'penutup' }
]

interface Kotak {
  slide: number
  x: number
  y: number
  w: number
  h: number
}

interface KotakTeks extends Kotak {
  teks: string
  /** Ukuran huruf terbesar di dalam kotak, pt. */
  sz: number
  /** PowerPoint akan mengecilkan sendiri isinya bila tidak muat (`fit: shrink`). */
  mengecilSendiri: boolean
}

const EMU = 914400

/** Semua bingkai bentuk/gambar/tabel di dalam setiap slide, dalam inci. */
async function kotakSlide(zip: JSZip): Promise<Kotak[]> {
  const nama = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const hasil: Kotak[] = []
  for (const [i, n] of nama.entries()) {
    const xml = await zip.files[n].async('string')
    for (const m of xml.matchAll(
      /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g
    )) {
      hasil.push({
        slide: i + 1,
        x: Number(m[1]) / EMU,
        y: Number(m[2]) / EMU,
        w: Number(m[3]) / EMU,
        h: Number(m[4]) / EMU
      })
    }
  }
  return hasil
}

/**
 * Kotak-kotak yang BERISI TEKS, per slide.
 *
 * Hanya `p:sp` bertteks yang dikumpulkan: bentuk hias (kartu KPI) dan gambar
 * ikon memang sengaja bertumpuk dengan teks di atasnya, jadi memasukkannya akan
 * menghasilkan peringatan palsu. Dua BLOK TEKS yang bertindih tidak pernah
 * disengaja.
 */
async function kotakTeks(zip: JSZip): Promise<KotakTeks[]> {
  const nama = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const hasil: KotakTeks[] = []
  for (const [i, n] of nama.entries()) {
    const xml = await zip.files[n].async('string')
    for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
      const sp = m[0]
      // Entitas XML dikembalikan dulu: `&amp;` di dalam berkas adalah SATU
      // karakter di layar. Tanpa ini, judul ber-"&" dihitung 4 karakter lebih
      // panjang dan pemeriksaan muat/tidak menuduh judul yang sebenarnya pas.
      const teks = [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
        .map((t) => t[1])
        .join(' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim()
      if (!teks) continue
      const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/)
      const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)
      if (!off || !ext) continue
      const ukuran = [...sp.matchAll(/sz="(\d+)"/g)].map((s) => Number(s[1]) / 100)
      hasil.push({
        slide: i + 1,
        x: Number(off[1]) / EMU,
        y: Number(off[2]) / EMU,
        w: Number(ext[1]) / EMU,
        h: Number(ext[2]) / EMU,
        teks,
        sz: ukuran.length ? Math.max(...ukuran) : 18,
        mengecilSendiri: /normAutofit/.test(sp)
      })
    }
  }
  return hasil
}

/** Luas pertindihan dua kotak, dalam inci persegi. */
function luasTindih(a: Kotak, b: Kotak): number {
  const lebar = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const tinggi = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return lebar > 0 && tinggi > 0 ? lebar * tinggi : 0
}

/** Apakah font terpasang di mesin ini — diukur, bukan ditebak. */
async function fontTerpasang(win: BrowserWindow, nama: string): Promise<boolean> {
  return win.webContents.executeJavaScript(`
    (() => {
      const c = document.createElement('canvas').getContext('2d')
      const contoh = 'AIRA the company 0123456789 mmmiiiwww'
      const ukur = (f) => { c.font = '32px ' + f; return c.measureText(contoh).width }
      const dasar = ukur('monospace')
      return ukur(${JSON.stringify(`"${nama}", monospace`)}) !== dasar
    })()
  `)
}

async function main(): Promise<void> {
  await app.whenReady()
  const berkas = join(tmpdir(), `aira-coba-${Date.now()}.pptx`)
  const masalah: string[] = []

  const hasil = await tulisPresentasi(CONTOH, berkas, { judulDokumen: 'Uji AIRA' })
  const isi = readFileSync(berkas)
  const zip = await JSZip.loadAsync(isi)
  const daftar = Object.keys(zip.files).filter((n) => !zip.files[n].dir)

  console.log(`berkas   : ${berkas} (${(isi.length / 1024).toFixed(1)} KB)`)
  console.log(`slide    : ${hasil.slides} (spec ${CONTOH.length} -> ada pemecahan otomatis)`)

  // 1. Tidak ada kotak yang keluar dari slide.
  const kotak = await kotakSlide(zip)
  const keluar = kotak.filter(
    (b) => b.x < -0.01 || b.y < -0.01 || b.x + b.w > SLIDE.lebar + 0.01 || b.y + b.h > SLIDE.tinggi + 0.01
  )
  console.log(`bingkai  : ${kotak.length} diperiksa, ${keluar.length} keluar slide`)
  for (const b of keluar) {
    masalah.push(
      `slide ${b.slide}: kotak ${b.x.toFixed(2)},${b.y.toFixed(2)} ${b.w.toFixed(2)}x${b.h.toFixed(2)} keluar dari ${SLIDE.lebar}x${SLIDE.tinggi}`
    )
  }

  // 2. Teks harus MUAT DI DALAM KOTAKNYA.
  //
  //    Pemeriksaan ini lahir dari deck sungguhan pertama (21 Agu 2026), dan
  //    dari satu salah sasaran saat memperbaikinya. Semua kotak ada di dalam
  //    slide (pemeriksaan 1 hijau) DAN tidak ada dua kotak yang saling
  //    bertindih — tapi di layar, subjudul sampul menimpa judul dan catatan.
  //    Sebabnya bukan kotaknya: kotak subjudul setinggi satu baris diisi teks
  //    tiga baris, jadi yang meluber keluar kotak adalah TEKSNYA.
  //
  //    Jadi yang diperiksa adalah tinggi yang DIBUTUHKAN teks versus tinggi
  //    kotaknya. Kotak yang diberi `fit: shrink` dilewati: PowerPoint akan
  //    mengecilkan hurufnya sendiri, bukan meluber.
  //    Diukur dalam BARIS, bukan inci: kotak judul template memang setinggi
  //    0,60 inci untuk satu baris 40pt, dan itu disengaja — yang salah adalah
  //    teks yang butuh LEBIH BANYAK BARIS daripada yang muat. Hitungannya
  //    memakai `anggaran()` yang sama dengan penentu pemecahan slide.
  const teks = await kotakTeks(zip)
  let dicek = 0
  for (const t of teks) {
    if (t.mengecilSendiri) continue
    dicek++
    const butuh = barisTeks(t.teks, t.w, t.sz)
    const muat = anggaran(t.w, t.h, t.sz).maksBaris
    if (butuh > muat) {
      masalah.push(
        `slide ${t.slide}: teks "${t.teks.slice(0, 40)}…" butuh ${butuh} baris pada kotak ` +
          `yang hanya memuat ${muat} baris (${t.sz}pt, ${t.h.toFixed(2)} inci) — akan meluber keluar kotak`
      )
    }
  }

  // Pertindihan antar blok teks tetap diperiksa: ia menangkap kelas kesalahan
  // yang berbeda (dua kotak sengaja ditaruh di tempat yang sama).
  let pasang = 0
  for (let i = 0; i < teks.length; i++) {
    for (let j = i + 1; j < teks.length; j++) {
      if (teks[i].slide !== teks[j].slide) continue
      pasang++
      if (luasTindih(teks[i], teks[j]) > 0.02) {
        masalah.push(
          `slide ${teks[i].slide}: kotak teks bertindih — ` +
            `"${teks[i].teks.slice(0, 30)}…" vs "${teks[j].teks.slice(0, 30)}…"`
        )
      }
    }
  }
  console.log(
    `blok teks: ${teks.length} kotak (${dicek} diperiksa muat/tidak, ${pasang} pasang diperiksa pertindihannya)`
  )

  // 3. Setiap berkas media harus berformat sesuai namanya — PNG palsu berisi
  //    byte SVG pernah lolos dari pptxgenjs dan hanya terlihat sebagai gambar
  //    rusak di PowerPoint lama & LibreOffice.
  const media = daftar.filter((n) => n.startsWith('ppt/media/'))
  for (const n of media) {
    const b = await zip.files[n].async('nodebuffer')
    const png = b.subarray(1, 4).toString('latin1') === 'PNG'
    const jpg = b[0] === 0xff && b[1] === 0xd8
    const sesuai = n.endsWith('.png') ? png : n.endsWith('.jpeg') || n.endsWith('.jpg') ? jpg : true
    if (!sesuai || b.length < 100) {
      masalah.push(`media ${n} tidak sesuai formatnya (${b.length} byte, awal ${JSON.stringify(b.subarray(0, 8).toString('latin1'))})`)
    }
  }
  console.log(`media    : ${media.length} berkas, semuanya diperiksa magic byte-nya`)

  // 3. Grafik harus jadi grafik PowerPoint asli, bukan gambar.
  const chart = daftar.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))
  console.log(`grafik   : ${chart.length} chart XML (grafik asli, bisa diedit di PowerPoint)`)
  if (chart.length === 0) masalah.push('tidak ada chart XML — grafik gagal dibuat')

  // 4. Font: dinyatakan di XML, lalu dicek apakah benar-benar ada di mesin ini.
  const xml1 = await zip.files['ppt/slides/slide1.xml'].async('string')
  const font = [...new Set([...xml1.matchAll(/typeface="([^"]+)"/g)].map((m) => m[1]))]
  console.log(`font XML : ${font.join(', ')}`)
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<body>')
  for (const f of FONT_DIPAKAI) {
    const ada = await fontTerpasang(win, f)
    console.log(`           ${f}: ${ada ? 'terpasang di mesin ini' : 'TIDAK terpasang di mesin ini'}`)
  }

  console.log('\ncatatan yang diterima model:')
  for (const c of hasil.catatan) console.log(`  - ${c}`)

  // Berkasnya dibuang kecuali diminta disimpan. `AIRA_COBA_PPT_SIMPAN=1`
  // menyisakannya untuk DIBUKA DAN DILIHAT — pemeriksaan otomatis tidak bisa
  // menilai apakah slidenya enak dipandang, dan pelajaran project ini jelas:
  // "buka dan baca dokumennya", jangan berhenti di "berkas berhasil dibuat".
  if (process.env.AIRA_COBA_PPT_SIMPAN === '1') console.log(`\nberkas disimpan: ${berkas}`)
  else unlinkSync(berkas)

  if (masalah.length) {
    console.error('\nGAGAL:')
    for (const m of masalah) console.error(`  - ${m}`)
    app.exit(1)
    return
  }
  console.log('\nsemua pemeriksaan lolos.')
  app.exit(0)
}

main().catch((err) => {
  console.error('coba-ppt gagal:', err)
  app.exit(1)
})
