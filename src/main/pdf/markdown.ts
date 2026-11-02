// Pengubah Markdown -> HTML untuk pembuatan PDF. Modul MURNI, bisa diuji tanpa Electron.
//
// Sengaja DITULIS SENDIRI, bukan menambah library markdown. Alasannya bukan
// gengsi: tiap dependensi baru ikut ke installer, ikut ke proses bytenode, dan
// ikut jadi hal yang harus diperiksa saat menaikkan versi Electron. Yang
// dibutuhkan di sini cuma subset kecil — judul, tebal/miring, daftar, tabel,
// kode, garis — dan subset itu cukup ditulis sekali dengan benar.
//
// ⚠️ Yang TIDAK didukung sengaja tidak didiamkan: lihat `FITUR_TIDAK_DIDUKUNG`.
// Isi tool tidak boleh membisu soal keterbatasannya — kalau markdown yang tidak
// dikenal diam-diam hilang dari PDF, tidak ada yang tahu bagiannya hilang.

/** Karakter yang harus dijinakkan sebelum masuk HTML. */
export function escapeHtml(teks: string): string {
  return teks
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Penanda gaya di dalam satu baris: **tebal**, *miring*, `kode`, [teks](url).
 *
 * Dijalankan SESUDAH escapeHtml, jadi teks user tidak bisa menyisipkan tag.
 */
function inline(teks: string): string {
  return escapeHtml(teks)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

/** Baris tabel "| a | b |" -> ['a', 'b'] */
function selBaris(baris: string): string[] {
  return baris
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((s) => s.trim())
}

const GARIS_PEMISAH = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/

/**
 * Apakah sel ini angka — dipakai agar kolom angka rata KANAN di PDF.
 *
 * Tanpa ini, kolom rupiah rata kiri dan tabelnya langsung terlihat seperti
 * cetakan mentah, bukan laporan. Menerima format Indonesia (titik ribuan, koma
 * desimal) beserta awalan "Rp" dan akhiran "%".
 */
export function selAngka(teks: string): boolean {
  const bersih = teks.replace(/^Rp\s*/i, '').replace(/%$/, '').replace(/[()]/g, '').trim()
  if (bersih.length === 0) return false
  return /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(bersih) || /^-?\d+([.,]\d+)?$/.test(bersih)
}

export const FITUR_TIDAK_DIDUKUNG =
  'gambar, kutipan bertingkat, dan HTML mentah tidak diubah dan akan tampil apa adanya'

export function markdownToHtml(markdown: string): string {
  const baris = markdown.replace(/\r\n/g, '\n').split('\n')
  const keluar: string[] = []
  let i = 0
  let dalamDaftar: 'ul' | 'ol' | null = null

  const tutupDaftar = (): void => {
    if (dalamDaftar) {
      keluar.push(`</${dalamDaftar}>`)
      dalamDaftar = null
    }
  }

  while (i < baris.length) {
    const b = baris[i]

    // Blok kode berpagar
    if (/^\s*```/.test(b)) {
      tutupDaftar()
      const isi: string[] = []
      i++
      while (i < baris.length && !/^\s*```/.test(baris[i])) {
        isi.push(baris[i])
        i++
      }
      i++
      keluar.push(`<pre><code>${escapeHtml(isi.join('\n'))}</code></pre>`)
      continue
    }

    // Tabel: butuh baris header + baris pemisah di bawahnya
    if (b.includes('|') && i + 1 < baris.length && GARIS_PEMISAH.test(baris[i + 1])) {
      tutupDaftar()
      const header = selBaris(b)
      i += 2
      const isi: string[][] = []
      while (i < baris.length && baris[i].includes('|') && baris[i].trim().length > 0) {
        isi.push(selBaris(baris[i]))
        i++
      }
      // Perataan ditentukan dari ISI, bukan dari header: header selalu teks,
      // jadi menebak dari header akan membuat semua kolom rata kiri.
      const kananKe = header.map((_, k) =>
        isi.length > 0 ? isi.every((r) => r[k] === undefined || r[k] === '' || selAngka(r[k])) : false
      )
      const th = header
        .map((h, k) => `<th${kananKe[k] ? ' class="ka"' : ''}>${inline(h)}</th>`)
        .join('')
      const tr = isi
        .map(
          (r) =>
            `<tr>${header
              .map((_, k) => `<td${kananKe[k] ? ' class="ka"' : ''}>${inline(r[k] ?? '')}</td>`)
              .join('')}</tr>`
        )
        .join('')
      keluar.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`)
      continue
    }

    const judul = /^(#{1,4})\s+(.*)$/.exec(b)
    if (judul) {
      tutupDaftar()
      const tingkat = judul[1].length
      keluar.push(`<h${tingkat}>${inline(judul[2])}</h${tingkat}>`)
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(b)) {
      tutupDaftar()
      keluar.push('<hr />')
      i++
      continue
    }

    const butir = /^\s*[-*•]\s+(.*)$/.exec(b)
    if (butir) {
      if (dalamDaftar !== 'ul') {
        tutupDaftar()
        keluar.push('<ul>')
        dalamDaftar = 'ul'
      }
      keluar.push(`<li>${inline(butir[1])}</li>`)
      i++
      continue
    }

    const nomor = /^\s*\d+[.)]\s+(.*)$/.exec(b)
    if (nomor) {
      if (dalamDaftar !== 'ol') {
        tutupDaftar()
        keluar.push('<ol>')
        dalamDaftar = 'ol'
      }
      keluar.push(`<li>${inline(nomor[1])}</li>`)
      i++
      continue
    }

    if (b.trim().length === 0) {
      tutupDaftar()
      i++
      continue
    }

    // Paragraf: baris-baris berturut sampai baris kosong digabung.
    tutupDaftar()
    const paragraf: string[] = [b]
    i++
    while (
      i < baris.length &&
      baris[i].trim().length > 0 &&
      !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*```)/.test(baris[i]) &&
      !baris[i].includes('|')
    ) {
      paragraf.push(baris[i])
      i++
    }
    keluar.push(`<p>${inline(paragraf.join(' '))}</p>`)
  }

  tutupDaftar()
  return keluar.join('\n')
}
