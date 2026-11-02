// SVG diagram — MURNI (30 Sep 2026). Satu keluaran untuk dua pemakai: HTML
// interaktif (ditanam apa adanya) dan PNG (dirasterisasi Chromium, pola §49).
//
// ⚠️ Semua teks berasal dari model/user → WAJIB di-escape. SVG di dalam HTML yang
// dibuka di browser: label berisi `<script>` yang lolos = kode yang jalan di
// komputer orang.

import type { HasilTata, Kotak, Titik } from './tata-letak'
import type { Arah, SpekDiagram } from './rules'

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Palet kelompok — pastel untuk latar, warna tegas untuk garis tepi. */
export const PALET = [
  { isi: '#eaf6ee', tepi: '#2f8a52' },
  { isi: '#e8f1fc', tepi: '#2f6fd1' },
  { isi: '#fdf1e4', tepi: '#d0701f' },
  { isi: '#f1ebfc', tepi: '#7650d8' },
  { isi: '#fdeaec', tepi: '#c4353f' },
  { isi: '#e6f6f6', tepi: '#12848a' },
  { isi: '#fdf6dc', tepi: '#b88a0a' },
  { isi: '#eef0f3', tepi: '#56606b' }
]

export const TINGGI_JUDUL = 58

function bentukSvg(k: Kotak, tepi: string, isi: string): string {
  const x = k.x - k.w / 2
  const y = k.y - k.h / 2
  const gaya = `fill="${isi}" stroke="${tepi}" stroke-width="1.6"`
  switch (k.bentuk) {
    case 'terminal':
      return `<rect x="${x}" y="${y}" width="${k.w}" height="${k.h}" rx="${k.h / 2}" ${gaya}/>`
    case 'keputusan':
      return `<polygon points="${k.x},${y} ${x + k.w},${k.y} ${k.x},${y + k.h} ${x},${k.y}" ${gaya}/>`
    case 'data': {
      const m = 12
      return `<polygon points="${x + m},${y} ${x + k.w},${y} ${x + k.w - m},${y + k.h} ${x},${y + k.h}" ${gaya}/>`
    }
    case 'database': {
      const ry = 7
      return (
        `<path d="M${x},${y + ry} v${k.h - 2 * ry} a${k.w / 2},${ry} 0 0 0 ${k.w},0 v${-(k.h - 2 * ry)}" ${gaya}/>` +
        `<ellipse cx="${k.x}" cy="${y + ry}" rx="${k.w / 2}" ry="${ry}" ${gaya}/>`
      )
    }
    case 'orang':
      return (
        `<rect x="${x}" y="${y}" width="${k.w}" height="${k.h}" rx="10" ${gaya}/>` +
        `<circle cx="${x + 18}" cy="${k.y - 5}" r="5" fill="none" stroke="${tepi}" stroke-width="1.6"/>` +
        `<path d="M${x + 9},${k.y + 10} a9,8 0 0 1 18,0" fill="none" stroke="${tepi}" stroke-width="1.6"/>`
      )
    default:
      return `<rect x="${x}" y="${y}" width="${k.w}" height="${k.h}" rx="10" ${gaya}/>`
  }
}

/** Kurva halus melewati semua titik; lengkungnya mengikuti sumbu lapis. */
export function jalurGaris(t: Titik[], arah: Arah): string {
  let d = `M${t[0].x.toFixed(1)},${t[0].y.toFixed(1)}`
  for (let i = 0; i + 1 < t.length; i++) {
    const a = t[i]
    const b = t[i + 1]
    const c1 = arah === 'kiri-kanan' ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 }
    const c2 = arah === 'kiri-kanan' ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 }
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
  }
  return d
}

function tengah(t: Titik[]): Titik {
  const i = Math.floor((t.length - 1) / 2)
  return { x: (t[i].x + t[i + 1].x) / 2, y: (t[i].y + t[i + 1].y) / 2 }
}

export function keSvg(spek: SpekDiagram, tata: HasilTata): string {
  const lebar = Math.max(tata.lebar, 420)
  const tinggi = tata.tinggi + TINGGI_JUDUL
  const warnaKel = new Map(spek.kelompok.map((k, i) => [k.id, PALET[i % PALET.length]]))
  const bagian: string[] = []

  bagian.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lebar} ${tinggi}" width="${lebar}" height="${tinggi}" font-family="Segoe UI, Arial, sans-serif">`,
    '<defs><marker id="panah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#5d6b63"/></marker></defs>',
    `<rect width="${lebar}" height="${tinggi}" fill="#ffffff"/>`,
    `<text x="28" y="36" font-size="20" font-weight="700" fill="#1d2b22">${esc(spek.judul)}</text>`,
    `<g transform="translate(0 ${TINGGI_JUDUL})" class="isi">`
  )

  for (const k of tata.kelompok) {
    const w = warnaKel.get(k.id)!
    bagian.push(
      `<g class="kelompok"><rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" rx="14" fill="${w.isi}" stroke="${w.tepi}" stroke-opacity="0.35" stroke-dasharray="5 4"/></g>`
    )
  }

  tata.garis.forEach((g, i) => {
    bagian.push(
      `<path class="garis" data-i="${i}" data-dari="${esc(g.dari)}" data-ke="${esc(g.ke)}" d="${jalurGaris(g.titik, spek.arah)}" fill="none" stroke="#5d6b63" stroke-width="1.5"${g.putus ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#panah)"/>`
    )
  })
  // Judul kelompok digambar SESUDAH garis, berlatar: panah yang masuk ke kelompok dulu
  // melintas tepat di atas tulisannya (tertangkap dari PNG uji 30 Sep).
  for (const k of tata.kelompok) {
    const w = warnaKel.get(k.id)!
    const lebarJudul = k.label.length * 7.6 + 14
    bagian.push(
      `<g class="judul-kelompok"><rect x="${k.x + 6}" y="${k.y + 5}" width="${lebarJudul}" height="20" rx="6" fill="${w.isi}"/>` +
        `<text x="${k.x + 12}" y="${k.y + 19}" font-size="12.5" font-weight="700" fill="${w.tepi}">${esc(k.label)}</text></g>`
    )
  }

  tata.garis.forEach((g) => {
    if (!g.label) return
    const m = tengah(g.titik)
    const w = g.label.length * 6.4 + 12
    bagian.push(
      `<g class="label-garis"><rect x="${m.x - w / 2}" y="${m.y - 10}" width="${w}" height="20" rx="6" fill="#ffffff" stroke="#dfe6e1"/>` +
        `<text x="${m.x}" y="${m.y + 4}" font-size="11.5" text-anchor="middle" fill="#3d4a42">${esc(g.label)}</text></g>`
    )
  })

  for (const k of tata.kotak) {
    const w = k.kelompok ? warnaKel.get(k.kelompok)! : PALET[0]
    const isi = k.bentuk === 'terminal' ? w.isi : '#ffffff'
    const geser = k.bentuk === 'orang' ? 12 : 0
    const y0 = k.y - ((k.baris.length - 1) * 17) / 2 + 4.5
    const teks = k.baris
      .map((b, i) => `<tspan x="${k.x + geser}" y="${(y0 + i * 17).toFixed(1)}">${esc(b)}</tspan>`)
      .join('')
    bagian.push(
      `<g class="simpul" data-id="${esc(k.id)}">${bentukSvg(k, w.tepi, isi)}` +
        `<text font-size="13" text-anchor="middle" fill="#1d2b22">${teks}</text></g>`
    )
  }
  bagian.push('</g></svg>')
  return bagian.join('')
}
