import PptxGenJS from 'pptxgenjs'
import { writeFileSync } from 'fs'
import { ToolError } from '../tools/types'
import { muatAset, type AsetPpt } from './aset'
import { dimensiPng } from '../gambar/rules'
import { anggaran, judulLanjutan, pecahBaris, pecahButir } from './muat'
import {
  FONT,
  KOTAK,
  PALET_GRAFIK,
  SLIDE,
  UKURAN,
  WARNA,
  susunSampul,
  ukuranJudul
} from './tema'
import {
  bacaSlides,
  normalkanSlide,
  pastikanAgenda,
  pastikanGrafik,
  pastikanIkon,
  pastikanJudul,
  pastikanKartu,
  pastikanTabel
} from './validasi'

// Penyusun presentasi bertema the company.
//
// Prinsipnya sama dengan "approved query tools" untuk database (HANDOFF §2):
// MODEL MENGISI ISI, KODE YANG MENENTUKAN TATA LETAK. Model tidak pernah
// menyebut koordinat, ukuran huruf, atau warna — ia hanya memilih salah satu
// layout yang sudah disetujui lalu mengisi teksnya. Alasannya sama pula:
// yang paling merugikan bukan deck yang kurang cantik, melainkan deck yang
// terlihat meyakinkan padahal separuh isinya keluar dari slide.

export interface PoinObjek {
  teks: string
  ikon?: string
}
export type Poin = string | PoinObjek

export interface Kolom {
  judul?: string
  poin: Poin[]
}

export interface Kartu {
  nilai: string
  label: string
  ikon?: string
}

export interface Seri {
  nama: string
  nilai: number[]
}

export type SlideSpec =
  | { layout: 'sampul'; judul: string; subjudul?: string; catatan?: string }
  | { layout: 'agenda'; judul?: string; item: string[] }
  | { layout: 'bagian'; judul: string; subjudul?: string }
  | { layout: 'poin'; judul: string; poin: Poin[] }
  | { layout: 'dua-kolom'; judul: string; kiri: Kolom; kanan: Kolom }
  | { layout: 'angka'; judul: string; kartu: Kartu[]; catatan?: string }
  | { layout: 'tabel'; judul: string; kolom: string[]; baris: string[][]; catatan?: string }
  | {
      layout: 'grafik'
      judul: string
      jenis: 'batang' | 'garis' | 'pai'
      label: string[]
      seri: Seri[]
      catatan?: string
    }
  | {
      layout: 'gambar'
      judul: string
      /** Deskripsi gambar untuk old-image-model. Gambarnya dibuat SEBELUM render. */
      gambar: string
      keterangan?: string
      /**
       * PNG hasil old-image-model, diisi `write_ppt` sebelum memanggil render.
       * Kosong = pembuatan gambarnya gagal; slide tetap dibuat dengan kotak
       * keterangan, TIDAK didiamkan (pola `catatanGrafik`, §49).
       */
      png?: Buffer
    }
  | { layout: 'penutup'; judul?: string }

export const LAYOUT_TERSEDIA = [
  'sampul',
  'agenda',
  'bagian',
  'poin',
  'dua-kolom',
  'angka',
  'tabel',
  'grafik',
  'gambar',
  'penutup'
] as const

export interface HasilPpt {
  path: string
  slides: number
  /** Kalimat-kalimat untuk `catatanHasil` tool. Tidak pernah kosong. */
  catatan: string[]
}

const teksPoin = (p: Poin): string => (typeof p === 'string' ? p : p.teks)
const ikonPoin = (p: Poin): string | undefined => (typeof p === 'string' ? undefined : p.ikon)

export async function tulisPresentasi(
  masukan: SlideSpec[] | string,
  tujuan: string,
  opsi: { judulDokumen?: string; penulis?: string } = {}
): Promise<HasilPpt> {
  // Bentuk argumen dinormalkan DI SINI, sekali, sebelum apa pun disusun —
  // lihat alasannya di `bacaSlides`.
  const spec = bacaSlides(masukan).map(normalkanSlide) as SlideSpec[]

  const aset = muatAset()
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = opsi.penulis ?? 'AIRA'
  pptx.company = 'AIRA'
  if (opsi.judulDokumen) pptx.title = opsi.judulDokumen
  pptx.theme = { headFontFace: FONT.judul, bodyFontFace: FONT.isi }

  const konteks: Konteks = {
    pptx,
    aset,
    dipecah: [],
    ikonDipakai: new Set(),
    gambarDipakai: 0,
    gambarGagal: [],
    nomor: 0
  }

  for (const s of spec) {
    if (!s || typeof s !== 'object' || !('layout' in s)) {
      throw new ToolError('setiap slide wajib punya field "layout"')
    }
    switch (s.layout) {
      case 'sampul':
        sampul(konteks, s)
        break
      case 'agenda':
        agenda(konteks, s)
        break
      case 'bagian':
        bagian(konteks, s)
        break
      case 'poin':
        poin(konteks, s)
        break
      case 'dua-kolom':
        duaKolom(konteks, s)
        break
      case 'angka':
        angka(konteks, s)
        break
      case 'tabel':
        tabel(konteks, s)
        break
      case 'grafik':
        grafik(konteks, s)
        break
      case 'gambar':
        gambarSlide(konteks, s)
        break
      case 'penutup':
        penutup(konteks, s)
        break
      default:
        throw new ToolError(
          `layout "${(s as { layout: string }).layout}" tidak dikenal. ` +
            `Pilih salah satu: ${LAYOUT_TERSEDIA.join(', ')}.`
        )
    }
  }

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  writeFileSync(tujuan, buffer)

  return {
    path: tujuan,
    slides: konteks.nomor,
    catatan: susunCatatan(konteks, spec)
  }
}

interface Konteks {
  pptx: PptxGenJS
  aset: AsetPpt
  /** Judul slide yang harus dipecah, beserta jadi berapa bagian. */
  dipecah: Array<{ judul: string; jadi: number }>
  ikonDipakai: Set<string>
  /** Berapa ilustrasi AI benar-benar terpasang, dan judul slide yang gagal. */
  gambarDipakai: number
  gambarGagal: string[]
  nomor: number
}

type Slide = ReturnType<PptxGenJS['addSlide']>

function slideBaru(k: Konteks, latar: 'sampul' | 'isi' | 'penutup', bernomor = true): Slide {
  const s = k.pptx.addSlide()
  k.nomor++
  const gambar = k.aset.latar[latar]
  // `path` ikut dikirim supaya nama berkas media di dalam .pptx berakhiran
  // sesuai isinya — lihat catatan pada `Latar.path`.
  if (gambar) s.background = { data: gambar.data, path: gambar.path }
  else s.background = { color: WARNA.putih }
  if (bernomor) {
    const [x, y, w, h] = KOTAK.nomor
    s.addText(String(k.nomor), {
      x,
      y,
      w,
      h,
      align: 'right',
      fontFace: FONT.isi,
      fontSize: UKURAN.nomor,
      color: WARNA.redup
    })
  }
  return s
}

/** Judul standar slide isi, dengan ukuran yang menyesuaikan panjangnya. */
function judulSlide(s: Slide, teks: string): void {
  const [x, y, w, h] = KOTAK.judul
  s.addText(teks, {
    x,
    y,
    w,
    h,
    fontFace: FONT.judul,
    fontSize: ukuranJudul(teks),
    color: WARNA.judul,
    valign: 'middle'
  })
}

function sampul(k: Konteks, s: Extract<SlideSpec, { layout: 'sampul' }>): void {
  const judul = pastikanJudul(s.judul, 'sampul')
  const subjudul = s.subjudul ? String(s.subjudul) : undefined
  const catatan = s.catatan ? String(s.catatan) : undefined
  const slide = slideBaru(k, 'sampul', false)
  const [x, , w] = KOTAK.sampulJudul

  for (const b of susunSampul(judul, subjudul, catatan)) {
    const teks = b.bagian === 'judul' ? judul : b.bagian === 'subjudul' ? subjudul! : catatan!
    slide.addText(teks, {
      x,
      y: b.y,
      w,
      h: b.h,
      fontFace: b.bagian === 'judul' ? FONT.judul : FONT.isi,
      fontSize: b.sz,
      color:
        b.bagian === 'judul'
          ? WARNA.judul
          : b.bagian === 'subjudul'
            ? WARNA.teks
            : WARNA.redup,
      valign: b.bagian === 'judul' ? 'bottom' : 'top'
    })
  }
}

function bagian(k: Konteks, s: Extract<SlideSpec, { layout: 'bagian' }>): void {
  const judul = pastikanJudul(s.judul, 'bagian')
  const slide = slideBaru(k, 'isi', false)
  const [x, y, w, h] = KOTAK.bagianJudul
  const kapital = judul.toUpperCase()
  slide.addText(kapital, {
    x,
    y,
    w,
    h,
    fontFace: FONT.bagian,
    // Diukur dari teks KAPITALNYA — huruf besar lebih lebar, dan judul yang
    // pas saat huruf kecil bisa meluber setelah dikapitalkan.
    fontSize: ukuranJudul(kapital, UKURAN.bagianJudul, w),
    bold: true,
    color: WARNA.bagian,
    valign: 'middle'
  })
  if (s.subjudul) {
    const [sx, sy, sw, sh] = KOTAK.bagianSubjudul
    slide.addText(String(s.subjudul), {
      x: sx,
      y: sy,
      w: sw,
      h: sh,
      fontFace: FONT.isi,
      fontSize: UKURAN.bagianSubjudul,
      color: WARNA.redup
    })
  }
}

function penutup(k: Konteks, s: Extract<SlideSpec, { layout: 'penutup' }>): void {
  const slide = slideBaru(k, 'penutup', false)
  // Gambar latar penutup SUDAH memuat "THANK YOU" dan tagline. Teks tambahan
  // hanya ditempatkan di ruang kosong di bawahnya — dan hanya kalau diminta.
  if (s.judul) {
    slide.addText(String(s.judul), {
      x: 1,
      y: 3.55,
      w: 8,
      h: 0.5,
      align: 'center',
      fontFace: FONT.isi,
      fontSize: 16,
      color: WARNA.putih
    })
  }
}

function poin(k: Konteks, s: Extract<SlideSpec, { layout: 'poin' }>): void {
  const judul = pastikanJudul(s.judul, 'poin')
  const daftar = (s.poin ?? []).filter((p) => teksPoin(p).trim())
  if (daftar.length === 0) throw new ToolError(`slide "${judul}" tidak punya poin isi`)
  for (const p of daftar) pastikanIkon(ikonPoin(p))

  const [bx, by, bw, bh] = KOTAK.badan
  const adaIkon = daftar.some((p) => ikonPoin(p))
  const geser = adaIkon ? 0.55 : 0
  const a = anggaran(bw - geser - 0.3, bh, UKURAN.isi)
  const bagianSlide = pecahButir(daftar, teksPoin, a)
  if (bagianSlide.length > 1) k.dipecah.push({ judul, jadi: bagianSlide.length })

  bagianSlide.forEach((butir, ke) => {
    const slide = slideBaru(k, 'isi')
    judulSlide(slide, judulLanjutan(judul, ke))
    if (!adaIkon) {
      slide.addText(
        butir.map((p) => ({
          text: teksPoin(p),
          options: { bullet: { code: '25AA' }, breakLine: true }
        })),
        {
          x: bx,
          y: by,
          w: bw,
          h: bh,
          fontFace: FONT.isi,
          fontSize: UKURAN.isi,
          color: WARNA.teks,
          valign: 'top',
          lineSpacingMultiple: 1.3,
          paraSpaceAfter: UKURAN.isi * 0.45,
          fit: 'shrink'
        }
      )
      return
    }
    // Ada ikon: tiap poin jadi satu baris ikon + teks.
    //
    // Tinggi barisnya SERAGAM, diambil dari poin terpanjang — bukan dihitung
    // per poin. Alasannya terlihat begitu decknya dibuka: taksiran lebar huruf
    // sengaja dibuat hati-hati (lihat `muat.ts`), jadi poin yang ditaksir dua
    // baris kerap tercetak satu baris, dan jarak antar poin jadi timpang —
    // rapat, longgar, rapat. Mata membaca itu sebagai slide yang berantakan,
    // padahal tidak ada yang hilang. Baris seragam selalu terlihat disengaja.
    const barisTerpanjang = Math.max(
      ...butir.map((p) => Math.ceil(teksPoin(p).length / a.perBaris))
    )
    const tinggi = Math.min(
      bh / butir.length,
      (barisTerpanjang * UKURAN.isi * 1.3) / 72 + 0.18
    )
    let y = by
    for (const p of butir) {
      const teks = teksPoin(p)
      const nama = ikonPoin(p)
      if (nama) {
        const data = k.aset.ikon(nama, 'hijau')
        if (data) {
          k.ikonDipakai.add(nama)
          slide.addImage({ data, x: bx, y: y + 0.03, w: 0.32, h: 0.32 })
        }
      }
      slide.addText(teks, {
        x: bx + geser,
        y,
        w: bw - geser,
        h: tinggi,
        fontFace: FONT.isi,
        fontSize: UKURAN.isi,
        color: WARNA.teks,
        valign: 'top',
        lineSpacingMultiple: 1.3,
        fit: 'shrink'
      })
      y += tinggi
    }
  })
}

function agenda(k: Konteks, s: Extract<SlideSpec, { layout: 'agenda' }>): void {
  const judul = pastikanJudul(s.judul ?? 'Agenda', 'agenda')
  const item = (s.item ?? []).map((t) => String(t).trim()).filter(Boolean)
  pastikanAgenda(item, judul)

  const [bx, by, bw, bh] = KOTAK.badan
  const duaKol = item.length > 6
  const lebarKol = duaKol ? (bw - 0.6) / 2 : bw
  const perKolom = duaKol ? Math.ceil(item.length / 2) : item.length
  const tinggiBaris = Math.min(0.62, bh / perKolom)

  const slide = slideBaru(k, 'isi')
  judulSlide(slide, judul)
  item.forEach((teks, i) => {
    const kolom = duaKol && i >= perKolom ? 1 : 0
    const barisKe = kolom ? i - perKolom : i
    const x = bx + kolom * (lebarKol + 0.6)
    const y = by + barisKe * tinggiBaris
    slide.addShape('ellipse' as never, {
      x,
      y: y + 0.05,
      w: 0.34,
      h: 0.34,
      fill: { color: WARNA.judul },
      line: { color: WARNA.judul, width: 0 }
    })
    slide.addText(String(i + 1), {
      x,
      y: y + 0.05,
      w: 0.34,
      h: 0.34,
      align: 'center',
      valign: 'middle',
      fontFace: FONT.isi,
      fontSize: 12,
      bold: true,
      color: WARNA.putih
    })
    slide.addText(teks, {
      x: x + 0.46,
      y,
      w: lebarKol - 0.46,
      h: tinggiBaris,
      fontFace: FONT.isi,
      fontSize: UKURAN.isi,
      color: WARNA.teks,
      valign: 'middle',
      fit: 'shrink'
    })
  })
}

function duaKolom(k: Konteks, s: Extract<SlideSpec, { layout: 'dua-kolom' }>): void {
  const judul = pastikanJudul(s.judul, 'dua-kolom')
  const [bx, by, bw, bh] = KOTAK.badan
  const sela = 0.5
  const lebar = (bw - sela) / 2

  const slide = slideBaru(k, 'isi')
  judulSlide(slide, judul)
  ;[s.kiri, s.kanan].forEach((kol, i) => {
    const x = bx + i * (lebar + sela)
    let y = by
    if (kol?.judul) {
      slide.addText(String(kol.judul), {
        x,
        y,
        w: lebar,
        h: 0.42,
        fontFace: FONT.isi,
        fontSize: UKURAN.isi + 2,
        bold: true,
        color: WARNA.judul
      })
      y += 0.52
    }
    const daftar = (kol?.poin ?? []).filter((p) => teksPoin(p).trim())
    for (const p of daftar) pastikanIkon(ikonPoin(p))
    if (daftar.length === 0) return
    const a = anggaran(lebar, by + bh - y, UKURAN.isi - 2)
    const muat = pecahButir(daftar, teksPoin, a)[0] ?? []
    if (muat.length < daftar.length) {
      k.dipecah.push({ judul: `${judul} (kolom ${i === 0 ? 'kiri' : 'kanan'})`, jadi: 1 })
    }
    slide.addText(
      daftar.map((p) => ({
        text: teksPoin(p),
        options: { bullet: { code: '25AA' }, breakLine: true }
      })),
      {
        x,
        y,
        w: lebar,
        h: by + bh - y,
        fontFace: FONT.isi,
        fontSize: UKURAN.isi - 2,
        color: WARNA.teks,
        valign: 'top',
        lineSpacingMultiple: 1.25,
        paraSpaceAfter: 6,
        fit: 'shrink'
      }
    )
  })
}

function angka(k: Konteks, s: Extract<SlideSpec, { layout: 'angka' }>): void {
  const judul = pastikanJudul(s.judul, 'angka')
  const kartu = (s.kartu ?? []).filter((c) => c && String(c.nilai ?? '').trim())
  pastikanKartu(kartu.length, judul)
  for (const c of kartu) pastikanIkon(c.ikon)

  const slide = slideBaru(k, 'isi')
  judulSlide(slide, judul)
  const [bx, by, bw] = KOTAK.badan
  const sela = 0.3
  const lebar = (bw - sela * (kartu.length - 1)) / kartu.length
  // Kartu dibuat tinggi dan agak turun supaya blok angkanya duduk di tengah
  // badan slide. Kartu pendek yang menempel ke judul menyisakan bidang kosong
  // besar di bawah — terlihat seperti slide yang belum selesai diisi.
  const tinggi = s.catatan ? 2.25 : 2.6
  const y = by + 0.5

  kartu.forEach((c, i) => {
    const x = bx + i * (lebar + sela)
    slide.addShape('roundRect' as never, {
      x,
      y,
      w: lebar,
      h: tinggi,
      fill: { color: WARNA.kartu },
      line: { color: WARNA.garis, width: 1 },
      rectRadius: 0.08
    })
    // Isi kartu dipusatkan tegak: ikon, angka, lalu label. Tingginya dihitung
    // dulu supaya kartu dengan dan tanpa ikon sama-sama seimbang.
    const tinggiIkon = c.ikon ? 0.52 : 0
    const tinggiAngka = 0.8
    const tinggiLabel = 0.62
    let isiY = y + (tinggi - (tinggiIkon + tinggiAngka + tinggiLabel)) / 2
    if (c.ikon) {
      const data = k.aset.ikon(c.ikon, 'hijau')
      if (data) {
        k.ikonDipakai.add(c.ikon)
        slide.addImage({ data, x: x + lebar / 2 - 0.2, y: isiY, w: 0.4, h: 0.4 })
      }
      isiY += tinggiIkon
    }
    slide.addText(String(c.nilai), {
      x: x + 0.1,
      y: isiY,
      w: lebar - 0.2,
      h: tinggiAngka,
      align: 'center',
      valign: 'middle',
      fontFace: FONT.judul,
      fontSize: UKURAN.angka,
      bold: true,
      color: WARNA.judul,
      fit: 'shrink'
    })
    slide.addText(String(c.label ?? ''), {
      x: x + 0.12,
      y: isiY + tinggiAngka,
      w: lebar - 0.24,
      h: tinggiLabel,
      align: 'center',
      valign: 'top',
      fontFace: FONT.isi,
      fontSize: UKURAN.labelAngka,
      color: WARNA.redup,
      fit: 'shrink'
    })
  })

  if (s.catatan) {
    slide.addText(String(s.catatan), {
      x: bx,
      y: y + tinggi + 0.18,
      w: bw,
      h: 0.5,
      fontFace: FONT.isi,
      fontSize: 12,
      color: WARNA.redup,
      valign: 'top'
    })
  }
}

function tabel(k: Konteks, s: Extract<SlideSpec, { layout: 'tabel' }>): void {
  const judul = pastikanJudul(s.judul, 'tabel')
  const kolom = (s.kolom ?? []).map((c) => String(c))
  const baris = (s.baris ?? []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []))
  pastikanTabel(kolom, baris, judul)

  const [bx, by, bw, bh] = KOTAK.badan
  const tinggiBaris = 0.34
  const maksBaris = Math.max(3, Math.floor((bh - tinggiBaris) / tinggiBaris))
  const bagianTabel = pecahBaris(baris, maksBaris)
  if (bagianTabel.length > 1) k.dipecah.push({ judul, jadi: bagianTabel.length })

  // Kolom pertama biasanya nama (panjang), sisanya angka. Lebarnya dibagi
  // menurut panjang isi supaya nama item tidak terpotong sementara kolom angka
  // menganggur lebar.
  const bobot = kolom.map((c, i) =>
    Math.max(c.length, ...baris.map((r) => (r[i] ?? '').length), 4)
  )
  const total = bobot.reduce((a, b) => a + b, 0)
  const colW = bobot.map((b) => Math.max(0.7, (b / total) * bw))

  bagianTabel.forEach((isi, ke) => {
    const slide = slideBaru(k, 'isi')
    judulSlide(slide, judulLanjutan(judul, ke))
    // Tabel pendek DIREGANGKAN mengisi badan slide. `tinggiBaris` di atas hanya
    // dipakai untuk memutuskan berapa baris yang muat; kalau dipakai apa adanya,
    // tabel 5 baris menggantung di sepertiga atas slide dan sisanya kosong.
    const ruang = bh - (s.catatan ? 0.45 : 0.05)
    const tinggiPakai = Math.min(0.62, Math.max(tinggiBaris, ruang / (isi.length + 1)))
    const rows = [
      kolom.map((c) => ({
        text: c,
        options: { bold: true, color: WARNA.putih, fill: { color: WARNA.judul } }
      })),
      ...isi.map((r, i) =>
        r.map((c) => ({
          text: c,
          options: { fill: { color: i % 2 ? WARNA.kartu : WARNA.putih } }
        }))
      )
    ]
    slide.addTable(rows as never, {
      x: bx,
      y: by,
      w: bw,
      colW,
      rowH: tinggiPakai,
      fontFace: FONT.isi,
      fontSize: UKURAN.tabel,
      color: WARNA.teks,
      border: { type: 'solid', pt: 0.5, color: WARNA.garis },
      valign: 'middle',
      autoPage: false
    })
    if (s.catatan && ke === bagianTabel.length - 1) {
      // Ditempel di DASAR badan slide, bukan tepat di bawah tabel: tinggi baris
      // tabel bisa membesar sendiri di PowerPoint kalau ada sel yang membungkus
      // dua baris, dan catatan yang diposisikan menurut hitungan kita sendiri
      // akan tertimpa tabelnya.
      slide.addText(String(s.catatan), {
        x: bx,
        y: by + bh - 0.36,
        w: bw,
        h: 0.36,
        fontFace: FONT.isi,
        fontSize: 11,
        color: WARNA.redup
      })
    }
  })
}

function grafik(k: Konteks, s: Extract<SlideSpec, { layout: 'grafik' }>): void {
  const judul = pastikanJudul(s.judul, 'grafik')
  const label = (s.label ?? []).map((l) => String(l))
  const seri = (s.seri ?? []).filter((d) => d && Array.isArray(d.nilai))
  pastikanGrafik(label, seri, judul)

  const slide = slideBaru(k, 'isi')
  judulSlide(slide, judul)
  const [bx, by, bw, bh] = KOTAK.badan
  const tinggiGrafik = s.catatan ? bh - 0.55 : bh
  const jenis =
    s.jenis === 'garis' ? 'line' : s.jenis === 'pai' ? 'pie' : ('bar' as 'bar' | 'line' | 'pie')

  slide.addChart(
    jenis as never,
    seri.map((d) => ({ name: d.nama, labels: label, values: d.nilai })),
    {
      x: bx,
      y: by,
      w: bw,
      h: tinggiGrafik,
      chartColors: PALET_GRAFIK,
      showLegend: seri.length > 1 || jenis === 'pie',
      legendPos: 'b',
      legendFontFace: FONT.isi,
      legendFontSize: 11,
      showValue: jenis !== 'pie' && label.length <= 8,
      dataLabelFontFace: FONT.isi,
      dataLabelFontSize: 10,
      dataLabelColor: WARNA.teks,
      showPercent: jenis === 'pie',
      catAxisLabelFontFace: FONT.isi,
      catAxisLabelFontSize: 11,
      valAxisLabelFontFace: FONT.isi,
      valAxisLabelFontSize: 11,
      valGridLine: { color: WARNA.garis, style: 'solid', size: 0.5 }
    }
  )

  if (s.catatan) {
    slide.addText(String(s.catatan), {
      x: bx,
      y: by + tinggiGrafik + 0.08,
      w: bw,
      h: 0.42,
      fontFace: FONT.isi,
      fontSize: 11,
      color: WARNA.redup
    })
  }
}

/**
 * Slide ilustrasi: judul di atas, gambar di tengah, keterangan opsional.
 *
 * ⚠️ Gambar dipasang dengan `sizing: 'contain'` — TIDAK diregangkan memenuhi
 * kotak. Gambar 1:1 yang dipaksa masuk kotak 16:9 akan gepeng tanpa satu pun
 * error, dan di slide itu terlihat seperti gambar yang memang jelek.
 *
 * ⚠️ Bila gambarnya gagal dibuat, slide TETAP dibuat berisi keterangan apa
 * adanya. Slide yang hilang diam-diam membuat penomoran deck bergeser dan user
 * tidak pernah tahu ada yang gagal (§49).
 */
function gambarSlide(k: Konteks, s: Extract<SlideSpec, { layout: 'gambar' }>): void {
  const judul = pastikanJudul(s.judul, 'gambar')
  const slide = slideBaru(k, 'isi')
  judulSlide(slide, judul)
  const [bx, by, bw, bh] = KOTAK.badan
  const tinggiGambar = s.keterangan ? bh - 0.5 : bh

  if (s.png && s.png.length > 0) {
    // Kotak gambar dihitung sendiri dari dimensi PNG, lalu DITENGAHKAN.
    // `sizing: contain` saja memang tidak menggepengkan gambar, tapi ia
    // menyisakan ruang kosong di satu sisi — pada slide 16:9 berisi gambar
    // persegi, hasilnya terlihat seperti gambar yang lupa diletakkan.
    const dim = dimensiPng(s.png)
    const rasio = dim && dim.tinggi > 0 ? dim.lebar / dim.tinggi : 1
    let w = tinggiGambar * rasio
    let h = tinggiGambar
    if (w > bw) {
      w = bw
      h = bw / rasio
    }
    slide.addImage({
      data: `data:image/png;base64,${s.png.toString('base64')}`,
      // `path` ikut supaya media di dalam .pptx bernama .png sesuai isinya —
      // alasan yang sama dengan latar template (§24c).
      path: 'gambar.png',
      x: bx + (bw - w) / 2,
      y: by + (tinggiGambar - h) / 2,
      w,
      h
    })
    k.gambarDipakai++
  } else {
    k.gambarGagal.push(judul)
    slide.addText('(gambar gagal dibuat — lihat catatan)', {
      x: bx,
      y: by + tinggiGambar / 2 - 0.25,
      w: bw,
      h: 0.5,
      align: 'center',
      fontFace: FONT.isi,
      fontSize: UKURAN.isi,
      color: WARNA.redup
    })
  }

  if (s.keterangan) {
    slide.addText(String(s.keterangan), {
      x: bx,
      y: by + tinggiGambar + 0.06,
      w: bw,
      h: 0.42,
      align: 'center',
      fontFace: FONT.isi,
      fontSize: 11,
      color: WARNA.redup
    })
  }
}

/**
 * Kalimat pertanggungjawaban hasil.
 *
 * ⚠️ TIDAK PERNAH kosong, dan sengaja berupa KALIMAT — bukan bendera boolean.
 * Pelajaran 21 Agu 2026 (HANDOFF §7): `read_file` sudah mengembalikan
 * `truncated: false` dan model TETAP mengarang cerita tentang bagian yang
 * "terpotong". Yang menahan adalah pernyataan harfiah tentang kelengkapan.
 */
function susunCatatan(k: Konteks, spec: SlideSpec[]): string[] {
  const catatan: string[] = []
  catatan.push(
    `Presentasi berisi ${k.nomor} slide dari ${spec.length} slide yang diminta, ` +
      'using the AIRA presentation theme (16:9).'
  )
  if (k.dipecah.length) {
    catatan.push(
      'Slide berikut dipecah otomatis karena isinya melebihi satu halaman: ' +
        k.dipecah.map((d) => `"${d.judul}" jadi ${d.jadi} slide`).join('; ') +
        '. Tidak ada teks yang dibuang — seluruh isinya tetap ada, hanya berpindah slide.'
    )
  } else {
    catatan.push('Seluruh isi yang diberikan muat pada slidenya masing-masing; tidak ada yang dipecah maupun dipotong.')
  }
  if (k.gambarDipakai > 0) {
    catatan.push(
      `${k.gambarDipakai} slide memakai ILUSTRASI BUATAN AIRA (gambar AI). Sampaikan itu ke user ` +
        'dengan menyebut pembuatnya "AIRA" saja, tanpa nama model atau gateway: ' +
        'the images are not real photos and not official assets, so they must not be used as evidence ' +
        'atau dokumentasi.'
    )
  }
  if (k.gambarGagal.length) {
    catatan.push(
      `PERHATIAN: ilustrasi GAGAL dibuat untuk slide: ${k.gambarGagal.join('; ')}. ` +
        'Slidenya tetap ada tapi kosong — beri tahu user, jangan diam.'
    )
  }
  if (k.ikonDipakai.size) {
    catatan.push(`Ikon yang dipasang: ${[...k.ikonDipakai].sort().join(', ')}.`)
  }
  catatan.push(
    `Teks memakai font ${FONT.judul} dan ${FONT.bagian}. Font TIDAK ikut tertanam di dalam berkas ` +
      '.pptx (berkas Office hanya menyimpan nama font), jadi di komputer yang tidak memasang font ' +
      'tersebut, PowerPoint akan menggantinya sendiri.'
  )
  for (const m of k.aset.masalah) catatan.push(`PERHATIAN: ${m}.`)
  if (!k.aset.masalah.length) {
    catatan.push('All theme background images were applied.')
  }
  catatan.push(
    'Jangan menyatakan ada isi yang terpotong atau dihilangkan di luar yang disebutkan di catatan ini.'
  )
  return catatan
}

/** Dipakai unit test & `coba-ppt.ts` untuk memastikan kotak tidak keluar slide. */
export const BATAS_SLIDE = SLIDE
