import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, markdownToHtml, selAngka } from '../src/main/pdf/markdown'
import { halamanHtml, kakiHalaman } from '../src/main/pdf/style'
import { blokKeMarkdown } from '../src/main/sales/report'

// Test regresi pengubah Markdown -> HTML untuk PDF.
//
// Ditulis sendiri (bukan library), jadi justru bagian ini yang wajib dikunci:
// kegagalannya SUNYI — markdown yang tidak dikenal hilang dari PDF tanpa ada
// yang tahu bagiannya hilang.

describe('keamanan isi', () => {
  test('HTML mentah dijinakkan, tidak pernah jadi tag', () => {
    // Isi bisa datang dari model. Jendela pencetak sudah mematikan JavaScript,
    // tapi jangan mengandalkan satu lapis saja.
    const h = markdownToHtml('<script>alert(1)</script>')
    assert.doesNotMatch(h, /<script>/)
    assert.match(h, /&lt;script&gt;/)
  })

  test('escapeHtml menangani &, <, >, dan petik', () => {
    assert.equal(escapeHtml('a & b < c > "d"'), 'a &amp; b &lt; c &gt; &quot;d&quot;')
  })

  test('tanda & di teks biasa tidak merusak dokumen', () => {
    assert.match(markdownToHtml('Sales & Marketing'), /Sales &amp; Marketing/)
  })
})

describe('elemen dasar', () => {
  test('judul bertingkat', () => {
    assert.match(markdownToHtml('# Judul'), /<h1>Judul<\/h1>/)
    assert.match(markdownToHtml('### Kecil'), /<h3>Kecil<\/h3>/)
  })

  test('tebal, miring, kode, tautan', () => {
    assert.match(markdownToHtml('**tebal**'), /<strong>tebal<\/strong>/)
    assert.match(markdownToHtml('*miring*'), /<em>miring<\/em>/)
    assert.match(markdownToHtml('`kode`'), /<code>kode<\/code>/)
    assert.match(markdownToHtml('[AIRA](https://x.id)'), /<a href="https:\/\/x\.id">AIRA<\/a>/)
  })

  test('daftar berbutir & bernomor ditutup dengan benar', () => {
    const h = markdownToHtml('- satu\n- dua\n\nteks')
    assert.match(h, /<ul>/)
    assert.match(h, /<\/ul>/)
    assert.equal((h.match(/<li>/g) ?? []).length, 2)
    assert.match(markdownToHtml('1. satu\n2. dua'), /<ol>/)
  })

  test('daftar berpindah jenis tidak saling menumpuk', () => {
    const h = markdownToHtml('- satu\n\n1. dua')
    assert.match(h, /<\/ul>[\s\S]*<ol>/)
  })

  test('blok kode berpagar', () => {
    const h = markdownToHtml('```\nSELECT 1\n```')
    assert.match(h, /<pre><code>SELECT 1<\/code><\/pre>/)
  })

  test('paragraf berbaris banyak digabung jadi satu', () => {
    const h = markdownToHtml('baris satu\nbaris dua\n\nparagraf lain')
    assert.equal((h.match(/<p>/g) ?? []).length, 2)
  })
})

describe('tabel', () => {
  const md = '| Item | Nett |\n|---|---|\n| HPV | 1.234.567 |\n| LBC | 890.123 |'

  test('tabel markdown jadi tabel HTML lengkap', () => {
    const h = markdownToHtml(md)
    assert.match(h, /<table>/)
    assert.match(h, /<thead>/)
    assert.equal((h.match(/<tr>/g) ?? []).length, 3) // 1 header + 2 isi
  })

  test('kolom angka ditandai rata kanan — DARI ISI, bukan dari judul', () => {
    // Header selalu teks; menebak perataan dari header akan membuat semua kolom
    // rata kiri dan tabel rupiah langsung terlihat seperti keluaran mentah.
    const h = markdownToHtml(md)
    assert.match(h, /<th>Item<\/th>/)
    assert.match(h, /<th class="ka">Nett<\/th>/)
    assert.match(h, /<td class="ka">1\.234\.567<\/td>/)
  })

  test('kolom campur teks & angka TIDAK dipaksa rata kanan', () => {
    const campur = '| A | B |\n|---|---|\n| x | 1.000 |\n| y | belum ada |'
    const h = markdownToHtml(campur)
    assert.doesNotMatch(h, /<th class="ka">B<\/th>/)
  })

  test('baris dengan sel kurang tidak merusak tabel', () => {
    const kurang = '| A | B | C |\n|---|---|---|\n| 1 | 2 |'
    const h = markdownToHtml(kurang)
    assert.equal((h.match(/<td/g) ?? []).length, 3)
  })

  test('garis berisi pipa TANPA baris pemisah bukan tabel', () => {
    assert.doesNotMatch(markdownToHtml('a | b'), /<table>/)
  })
})

describe('pengenal sel angka', () => {
  test('format Indonesia dikenali', () => {
    assert.ok(selAngka('1.234.567'))
    assert.ok(selAngka('Rp 4.988.000.000'))
    assert.ok(selAngka('-19,4'))
    assert.ok(selAngka('12,5%'))
    assert.ok(selAngka('42'))
  })

  test('teks tidak dikenali sebagai angka', () => {
    assert.equal(selAngka('HPV DNA'), false)
    assert.equal(selAngka(''), false)
    assert.equal(selAngka('belum ada'), false)
  })
})

describe('laporan penjualan ke Markdown', () => {
  test('blok laporan berubah jadi markdown yang bisa dicetak', () => {
    const md = blokKeMarkdown([
      { type: 'h1', text: 'Laporan Penjualan' },
      { type: 'p', text: 'Periode: Agustus 2026' },
      { type: 'h2', text: 'Ringkasan Eksekutif' },
      { type: 'bullet', text: 'Nett Rp 4,99 M' }
    ])
    assert.match(md, /^# Laporan Penjualan/)
    assert.match(md, /## Ringkasan Eksekutif/)
    assert.match(md, /- Nett Rp 4,99 M/)
  })

  test('tidak meninggalkan baris kosong bertumpuk', () => {
    const md = blokKeMarkdown([
      { type: 'h1', text: 'A' },
      { type: 'h2', text: 'B' },
      { type: 'p', text: 'C' }
    ])
    assert.doesNotMatch(md, /\n\n\n/)
  })

  test('hasilnya benar-benar terbaca oleh pengubah PDF', () => {
    // Dua modul ini dipakai berpasangan; menguji keduanya terpisah saja bisa
    // membiarkan sambungannya putus tanpa ketahuan.
    const html = markdownToHtml(
      blokKeMarkdown([
        { type: 'h1', text: 'Laporan' },
        { type: 'bullet', text: 'poin' }
      ])
    )
    assert.match(html, /<h1>Laporan<\/h1>/)
    assert.match(html, /<li>poin<\/li>/)
  })
})

describe('font korporat di dokumen cetak', () => {
  test('halaman memakai font sistem (Segoe UI), tanpa font perusahaan', () => {
    const h = halamanHtml('<p>x</p>')
    assert.match(h, /font-family: 'Segoe UI'/)
    assert.doesNotMatch(h, /the company/)
    // Cadangan WAJIB font antarmuka, bukan serif generik: dokumen yang jatuh ke
    // Times New Roman terlihat rusak, bukan sekadar berbeda.
    assert.match(h, /'Segoe UI'/)
  })

  test('aturan @font-face disisipkan bila berkas fontnya ada', () => {
    const h = halamanHtml('<p>x</p>', { fontFace: "@font-face { font-family: 'X'; }" })
    assert.match(h, /@font-face/)
  })

  test('tanpa berkas font, halaman TETAP terbit (jatuh ke cadangan)', () => {
    // Font yang hilang tidak sepadan dengan dokumen yang gagal dibuat.
    const h = halamanHtml('<p>x</p>', { fontFace: '' })
    assert.match(h, /<body>/)
    assert.doesNotMatch(h, /@font-face/)
  })

  test('kaki halaman menanam fontnya sendiri', () => {
    // ⚠️ Chromium merender kaki halaman sebagai DOKUMEN TERPISAH — ia tidak
    // mewarisi @font-face halaman utama. Terukur 21 Agu 2026: badan dokumen
    // sudah company serif font sementara nomor halaman masih Segoe UI.
    const kaki = kakiHalaman('Laporan', 'data:font/woff2;base64,AAA')
    assert.match(kaki, /@font-face/)
    assert.match(kaki, /data:font\/woff2/)
    assert.match(kaki, /pageNumber/)
  })

  test('kaki halaman tanpa font tetap sah — hanya tanpa @font-face', () => {
    const kaki = kakiHalaman('Laporan', null)
    assert.doesNotMatch(kaki, /@font-face/)
    assert.match(kaki, /Page/)
  })

  test('kode tetap monospace, tidak ikut jadi serif', () => {
    // Kode dan SQL dalam font proporsional kehilangan perataannya.
    assert.match(halamanHtml('<pre><code>x</code></pre>'), /monospace/)
  })
})
