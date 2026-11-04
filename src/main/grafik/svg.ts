// Mesin grafik — SATU sumber untuk semua format keluaran.
//
// Kenapa SVG dan bukan library grafik: PDF di AIRA dicetak Chromium
// (`printToPDF`), jadi SVG langsung digambar tanpa dependensi apa pun dan
// hasilnya vektor — tajam di zoom berapa pun. Word & Excel tinggal memakai
// SVG yang SAMA, dirasterisasi jadi PNG. Satu perhitungan tata letak, empat
// tempat pemakaian; kalau tiap format punya mesinnya sendiri, angka yang sama
// bisa tampil berbeda di dokumen yang berbeda.
//
// PowerPoint SENGAJA tidak memakai ini — di sana dipakai grafik PowerPoint asli
// yang bisa diklik dan diedit datanya (`ppt/render.ts`). Gambar mati di deck
// yang dipresentasikan adalah kemunduran, bukan penyederhanaan.
//
// Modul MURNI: tidak menyentuh Electron maupun berkas, jadi seluruh tata
// letaknya bisa diuji.

/** Palet the company — SAMA dengan `PALET_GRAFIK` di `ppt/tema.ts`. */
export const PALET = ['#1F4E9C', '#2F7BE5', '#78909C', '#FFAB40', '#0097A7', '#1565C0']

const WARNA_TEKS = '#1e2a3b'
const WARNA_REDUP = '#5f6b7a'
const WARNA_GARIS = '#dde4ee'
const FONT = "'Segoe UI',system-ui,sans-serif"

export type JenisGrafik = 'batang' | 'garis' | 'pai' | 'batang-tumpuk'

export interface Seri {
  nama: string
  nilai: number[]
}

export interface SpekGrafik {
  jenis: JenisGrafik
  judul?: string
  /** Label sumbu X (atau label irisan untuk pai). */
  label: string[]
  seri: Seri[]
  /** Satuan singkat untuk sumbu Y, mis. "Rp jt". */
  satuan?: string
  lebar?: number
  tinggi?: number
}

export class GrafikError extends Error {}

/**
 * Memeriksa spek sebelum digambar.
 *
 * ⚠️ Nilai bukan-angka WAJIB ditolak, bukan dianggap nol. Model kerap mengirim
 * "Rp 4,11 M" sebagai nilai — pelajaran yang sudah dibayar di `ppt/validasi.ts`:
 * kalau dibiarkan, grafiknya rata tanah TANPA error dan terlihat persis seperti
 * data yang memang nol.
 */
export function pastikanSpek(s: SpekGrafik): void {
  if (!s.label || s.label.length === 0) throw new GrafikError('grafik tidak punya label')
  if (!s.seri || s.seri.length === 0) throw new GrafikError('grafik tidak punya seri data')
  for (const d of s.seri) {
    if (!Array.isArray(d.nilai)) throw new GrafikError(`seri "${d.nama}" tidak punya nilai`)
    if (d.nilai.length !== s.label.length) {
      throw new GrafikError(
        `seri "${d.nama}" berisi ${d.nilai.length} angka sedangkan labelnya ${s.label.length}. ` +
          'Jumlahnya harus sama.'
      )
    }
    const nakal = d.nilai.find((n) => typeof n !== 'number' || !Number.isFinite(n))
    if (nakal !== undefined) {
      throw new GrafikError(
        `grafik memuat nilai yang bukan angka pada seri "${d.nama}". Kirim angka murni ` +
          '(mis. 4.11), bukan teks berformat seperti "Rp 4,11 M".'
      )
    }
  }
  if (s.jenis === 'pai' && s.seri.length > 1) {
    throw new GrafikError('grafik pai hanya boleh satu seri')
  }
}

function esc(t: string): string {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Angka sumbu yang enak dibaca: 0 · 2 jt · 4 jt, bukan 0 · 1,7333 jt.
 * Dibulatkan ke atas ke kelipatan 1/2/5 × pangkat sepuluh.
 */
export function skalaBagus(maks: number, langkah = 4): { atas: number; garis: number[] } {
  if (!Number.isFinite(maks) || maks <= 0) return { atas: 1, garis: [0, 1] }
  const kasar = maks / langkah
  const pangkat = Math.pow(10, Math.floor(Math.log10(kasar)))
  const sisa = kasar / pangkat
  const rapi = sisa <= 1 ? 1 : sisa <= 2 ? 2 : sisa <= 5 ? 5 : 10
  const satuan = rapi * pangkat
  const atas = Math.ceil(maks / satuan) * satuan
  const garis: number[] = []
  for (let v = 0; v <= atas + satuan / 2; v += satuan) garis.push(Number(v.toFixed(6)))
  return { atas, garis }
}

/** Angka ringkas untuk label sumbu: 1.500.000 -> "1,5 jt". */
export function ringkasAngka(n: number): string {
  const abs = Math.abs(n)
  const bentuk = (v: number, s: string): string =>
    `${(Math.round(v * 10) / 10).toLocaleString('id-ID')}${s}`
  if (abs >= 1e12) return bentuk(n / 1e12, ' T')
  if (abs >= 1e9) return bentuk(n / 1e9, ' M')
  if (abs >= 1e6) return bentuk(n / 1e6, ' jt')
  if (abs >= 1e3) return bentuk(n / 1e3, ' rb')
  return (Math.round(n * 100) / 100).toLocaleString('id-ID')
}

/** Memotong label yang kepanjangan supaya tidak saling tindih. */
export function potongLabel(t: string, maks = 14): string {
  const s = String(t)
  return s.length > maks ? `${s.slice(0, maks - 1)}…` : s
}

interface Tata {
  lebar: number
  tinggi: number
  kiri: number
  kanan: number
  atas: number
  bawah: number
}

function tataLetak(s: SpekGrafik): Tata {
  const lebar = s.lebar ?? 900
  const tinggi = s.tinggi ?? 460
  return {
    lebar,
    tinggi,
    kiri: 92,
    kanan: 24,
    // Ruang judul hanya disediakan bila judulnya memang ada — kalau tidak,
    // grafik tanpa judul akan punya rongga kosong di atasnya.
    atas: s.judul ? 46 : 18,
    // Legenda hanya perlu ruang bila serinya lebih dari satu.
    bawah: s.seri.length > 1 ? 76 : 52
  }
}

function bingkai(s: SpekGrafik, t: Tata, isi: string, legenda: string): string {
  const judul = s.judul
    ? `<text x="${t.lebar / 2}" y="26" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="600" fill="${WARNA_TEKS}">${esc(s.judul)}</text>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.lebar} ${t.tinggi}" width="${t.lebar}" height="${t.tinggi}" role="img">` +
    `<rect width="${t.lebar}" height="${t.tinggi}" fill="#ffffff"/>` +
    judul +
    isi +
    legenda +
    '</svg>'
  )
}

function legendaSeri(s: SpekGrafik, t: Tata): string {
  if (s.seri.length <= 1) return ''
  const y = t.tinggi - 20
  const lebarItem = Math.min(190, (t.lebar - 40) / s.seri.length)
  const mulai = (t.lebar - lebarItem * s.seri.length) / 2
  return s.seri
    .map((d, i) => {
      const x = mulai + i * lebarItem
      return (
        `<rect x="${x}" y="${y - 9}" width="11" height="11" rx="2" fill="${PALET[i % PALET.length]}"/>` +
        `<text x="${x + 17}" y="${y}" font-family="${FONT}" font-size="12" fill="${WARNA_TEKS}">${esc(potongLabel(d.nama, 22))}</text>`
      )
    })
    .join('')
}

function sumbu(t: Tata, garis: number[], atas: number, satuan?: string): string {
  const h = t.tinggi - t.atas - t.bawah
  return (
    garis
      .map((v) => {
        const y = t.atas + h - (v / atas) * h
        return (
          `<line x1="${t.kiri}" y1="${y}" x2="${t.lebar - t.kanan}" y2="${y}" stroke="${WARNA_GARIS}" stroke-width="1"/>` +
          `<text x="${t.kiri - 9}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${WARNA_REDUP}">${esc(ringkasAngka(v))}</text>`
        )
      })
      .join('') +
    (satuan
      ? `<text x="${t.kiri - 9}" y="${t.atas - 10}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${WARNA_REDUP}">${esc(satuan)}</text>`
      : '')
  )
}

function labelX(t: Tata, label: string[]): string {
  const w = t.lebar - t.kiri - t.kanan
  const langkah = w / label.length
  // Label dimiringkan hanya bila jumlahnya banyak — memiringkan 3 label
  // membuatnya lebih sulit dibaca, bukan lebih mudah.
  const miring = label.length > 8
  const y = t.tinggi - t.bawah + (miring ? 14 : 18)
  return label
    .map((l, i) => {
      const x = t.kiri + langkah * (i + 0.5)
      const putar = miring ? ` transform="rotate(-35 ${x} ${y})"` : ''
      const anchor = miring ? 'end' : 'middle'
      return `<text x="${x}" y="${y}" text-anchor="${anchor}"${putar} font-family="${FONT}" font-size="11" fill="${WARNA_REDUP}">${esc(potongLabel(l, miring ? 16 : 12))}</text>`
    })
    .join('')
}

function gambarBatang(s: SpekGrafik, t: Tata, tumpuk: boolean): string {
  const w = t.lebar - t.kiri - t.kanan
  const h = t.tinggi - t.atas - t.bawah
  const maks = tumpuk
    ? Math.max(...s.label.map((_, i) => s.seri.reduce((n, d) => n + Math.max(0, d.nilai[i]), 0)))
    : Math.max(...s.seri.flatMap((d) => d.nilai.map((v) => Math.max(0, v))))
  const { atas, garis } = skalaBagus(maks)
  const langkah = w / s.label.length
  const batang: string[] = []

  for (let i = 0; i < s.label.length; i++) {
    if (tumpuk) {
      let dasar = 0
      for (let j = 0; j < s.seri.length; j++) {
        const v = Math.max(0, s.seri[j].nilai[i])
        const tinggiB = (v / atas) * h
        const y = t.atas + h - (dasar / atas) * h - tinggiB
        const lebarB = langkah * 0.6
        batang.push(
          `<rect x="${t.kiri + langkah * i + (langkah - lebarB) / 2}" y="${y}" width="${lebarB}" height="${Math.max(0, tinggiB)}" fill="${PALET[j % PALET.length]}"/>`
        )
        dasar += v
      }
    } else {
      const lebarKel = langkah * 0.72
      const lebarB = lebarKel / s.seri.length
      for (let j = 0; j < s.seri.length; j++) {
        const v = Math.max(0, s.seri[j].nilai[i])
        const tinggiB = (v / atas) * h
        const x = t.kiri + langkah * i + (langkah - lebarKel) / 2 + j * lebarB
        batang.push(
          `<rect x="${x}" y="${t.atas + h - tinggiB}" width="${Math.max(1, lebarB - 3)}" height="${Math.max(0, tinggiB)}" rx="2" fill="${PALET[j % PALET.length]}"/>`
        )
      }
    }
  }
  return sumbu(t, garis, atas, s.satuan) + batang.join('') + labelX(t, s.label)
}

function gambarGaris(s: SpekGrafik, t: Tata): string {
  const w = t.lebar - t.kiri - t.kanan
  const h = t.tinggi - t.atas - t.bawah
  const maks = Math.max(...s.seri.flatMap((d) => d.nilai.map((v) => Math.max(0, v))))
  const { atas, garis } = skalaBagus(maks)
  const langkah = w / Math.max(1, s.label.length - 1)
  const jalur = s.seri
    .map((d, j) => {
      const titik = d.nilai.map((v, i) => {
        const x = s.label.length === 1 ? t.kiri + w / 2 : t.kiri + langkah * i
        const y = t.atas + h - (Math.max(0, v) / atas) * h
        return { x, y }
      })
      const garisJalur = titik.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
      const bulat = titik
        .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${PALET[j % PALET.length]}"/>`)
        .join('')
      return (
        `<path d="${garisJalur}" fill="none" stroke="${PALET[j % PALET.length]}" stroke-width="2.5" stroke-linejoin="round"/>` +
        bulat
      )
    })
    .join('')
  // Label X garis memakai jarak antar-TITIK, bukan antar-kolom.
  const labelGaris = s.label
    .map((l, i) => {
      const x = s.label.length === 1 ? t.kiri + w / 2 : t.kiri + langkah * i
      return `<text x="${x}" y="${t.tinggi - t.bawah + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${WARNA_REDUP}">${esc(potongLabel(l, 12))}</text>`
    })
    .join('')
  return sumbu(t, garis, atas, s.satuan) + jalur + labelGaris
}

function gambarPai(s: SpekGrafik, t: Tata): string {
  const nilai = s.seri[0].nilai.map((v) => Math.max(0, v))
  const total = nilai.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new GrafikError('grafik pai butuh setidaknya satu nilai lebih dari nol')
  const cx = t.lebar * 0.36
  const cy = t.atas + (t.tinggi - t.atas - t.bawah) / 2
  const r = Math.min(t.tinggi - t.atas - t.bawah, t.lebar * 0.6) / 2 - 8
  let sudut = -Math.PI / 2
  const irisan = nilai
    .map((v, i) => {
      const bagian = (v / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(sudut)
      const y1 = cy + r * Math.sin(sudut)
      sudut += bagian
      const x2 = cx + r * Math.cos(sudut)
      const y2 = cy + r * Math.sin(sudut)
      const besar = bagian > Math.PI ? 1 : 0
      // Satu irisan penuh tidak bisa digambar sebagai busur (titik awal = titik
      // akhir); digambar sebagai lingkaran utuh.
      const d =
        nilai.filter((n) => n > 0).length === 1
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${besar} 1 ${x2} ${y2} Z`
      return `<path d="${d}" fill="${PALET[i % PALET.length]}" stroke="#ffffff" stroke-width="1.5"/>`
    })
    .join('')
  // Keterangan pai di samping, karena label di dalam irisan tipis tidak terbaca.
  const ket = s.label
    .map((l, i) => {
      const y = t.atas + 18 + i * 22
      const persen = ((nilai[i] / total) * 100).toFixed(1).replace('.', ',')
      return (
        `<rect x="${t.lebar * 0.66}" y="${y - 10}" width="11" height="11" rx="2" fill="${PALET[i % PALET.length]}"/>` +
        `<text x="${t.lebar * 0.66 + 17}" y="${y}" font-family="${FONT}" font-size="12" fill="${WARNA_TEKS}">${esc(potongLabel(l, 20))} — ${persen}%</text>`
      )
    })
    .join('')
  return irisan + ket
}

/** Menggambar spek jadi SVG utuh. */
export function keSvg(s: SpekGrafik): string {
  pastikanSpek(s)
  const t = tataLetak(s)
  const isi =
    s.jenis === 'pai'
      ? gambarPai(s, t)
      : s.jenis === 'garis'
        ? gambarGaris(s, t)
        : gambarBatang(s, t, s.jenis === 'batang-tumpuk')
  // Pai sudah punya keterangannya sendiri; legenda bawah cuma menduplikasi.
  return bingkai(s, t, isi, s.jenis === 'pai' ? '' : legendaSeri(s, t))
}
