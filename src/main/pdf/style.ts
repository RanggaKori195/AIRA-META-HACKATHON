// Gaya cetak PDF. Dipisah supaya bisa diubah tanpa menyentuh logika render.
//
// Sasaran pembacanya direksi dan manajer, dan dokumennya kerap dicetak atau
// diteruskan lewat email. Jadi yang dikejar bukan "cantik di layar" melainkan
// terbaca di kertas: kontras cukup, tabel bergaris tipis, dan yang paling
// menentukan — TIDAK ADA baris atau judul yang terpotong di pergantian halaman.

/** Hijau the lab, sama dengan tema aplikasi. */
const AKSEN = '#2f6f3e'

export interface OpsiGaya {
  /** Judul dokumen; tampil di halaman pertama. */
  judul?: string
  /** Baris kecil di bawah judul, mis. periode laporan. */
  subjudul?: string
  /**
   * Aturan @font-face untuk company serif font, dihasilkan `siapkanFontUntukCetak`.
   * Kosong = berkas fontnya tidak ditemukan; halaman jatuh ke font cadangan
   * alih-alih gagal dicetak.
   */
  fontFace?: string
}

export function halamanHtml(isiHtml: string, opsi: OpsiGaya = {}): string {
  const kepala = opsi.judul
    ? `<header class="sampul">
         <h1 class="judul-dok">${opsi.judul}</h1>
         ${opsi.subjudul ? `<div class="subjudul-dok">${opsi.subjudul}</div>` : ''}
       </header>`
    : ''

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${opsi.judul ?? 'Dokumen'}</title>
<style>
  ${opsi.fontFace ?? ''}

  @page { size: A4; margin: 18mm 16mm; }

  html, body { margin: 0; padding: 0; }

  body {
    /* System font (Segoe UI); Chromium embeds it in the PDF. Fonts are never
       fetched from the internet: that would hold up printing when offline. */
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #23221f;
  }

  /* --- sampul --- */
  .sampul {
    border-bottom: 2.5pt solid ${AKSEN};
    padding-bottom: 8pt;
    margin-bottom: 16pt;
  }
  .judul-dok { font-size: 20pt; font-weight: 700; color: ${AKSEN}; margin: 0; }
  .subjudul-dok { font-size: 10pt; color: #6d6a62; margin-top: 3pt; }

  /* --- judul bagian --- */
  h1, h2, h3, h4 { color: ${AKSEN}; margin: 14pt 0 6pt; line-height: 1.25; }
  h1 { font-size: 15pt; }
  h2 { font-size: 13pt; border-bottom: 0.75pt solid #e4e1d8; padding-bottom: 3pt; }
  h3 { font-size: 11.5pt; }
  h4 { font-size: 10.5pt; color: #6d6a62; }

  /* ⚠️ Judul tidak boleh menggantung sendirian di kaki halaman — itu cacat
     yang paling kelihatan saat dokumen dicetak. */
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }

  p { margin: 0 0 7pt; text-align: justify; }
  ul, ol { margin: 0 0 8pt 16pt; padding: 0; }
  li { margin-bottom: 3pt; }
  hr { border: none; border-top: 0.75pt solid #e4e1d8; margin: 12pt 0; }
  a { color: ${AKSEN}; text-decoration: none; }

  code {
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 9pt;
    background: #f3f1eb;
    padding: 1pt 3pt;
    border-radius: 2pt;
  }
  pre {
    background: #f3f1eb;
    border: 0.5pt solid #e4e1d8;
    border-radius: 3pt;
    padding: 7pt 9pt;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    break-inside: avoid;
  }
  pre code { background: none; padding: 0; }

  /* --- tabel --- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 6pt 0 12pt;
    font-size: 9.5pt;
  }
  thead th {
    background: ${AKSEN};
    color: #fff;
    font-weight: 600;
    text-align: left;
    padding: 5pt 7pt;
    border: 0.5pt solid ${AKSEN};
  }
  tbody td {
    padding: 4pt 7pt;
    border: 0.5pt solid #e4e1d8;
    vertical-align: top;
  }
  /* Belang tipis: membantu mata menyusuri baris panjang, tetap aman saat
     dicetak hitam-putih. */
  tbody tr:nth-child(even) td { background: #f8f7f4; }

  /* Kolom angka rata kanan — ditentukan dari ISI kolom, bukan dari judulnya
     (lihat selAngka di markdown.ts). Tanpa ini kolom rupiah rata kiri dan
     tabelnya langsung terlihat seperti keluaran mentah.
     Catatan: jangan pakai tanda petik terbalik di komentar CSS ini — seluruh
     blok ada di dalam template literal, dan satu petik terbalik memutusnya. */
  .ka { text-align: right; white-space: nowrap; }

  /* Baris tidak boleh terbelah dua halaman, dan header tabel diulang di tiap
     halaman untuk tabel panjang. */
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }

  /* Grafik. Aturan break-inside WAJIB — tanpa itu Chromium bisa memotong satu
     grafik jadi dua halaman, dan setengah grafik lebih buruk daripada tidak ada. */
  .grafik-ringkas { margin: 18px 0 26px; }
  .grafik { margin: 0 0 18px; padding: 0; break-inside: avoid; page-break-inside: avoid; }
  .grafik svg { width: 100%; height: auto; display: block; }
</style>
</head>
<body>
${kepala}
${isiHtml}
</body>
</html>`
}

/**
 * Kaki halaman: nomor halaman + tanggal cetak.
 *
 * Nomor halaman penting untuk dokumen yang dibahas di rapat ("lihat halaman 4"),
 * dan tanggal cetak mencegah salah paham yang mahal: laporan penjualan yang
 * sama, dicetak dua minggu berbeda, isinya berbeda.
 */
export function kakiHalaman(catatan?: string, fontDataUrl?: string | null): string {
  const kiri = catatan ? escapeUntukTemplate(catatan) : ''
  // ⚠️ Kaki halaman dirender Chromium sebagai DOKUMEN TERPISAH — ia tidak
  // mewarisi @font-face maupun berkas pendamping halaman utama. Terukur
  // 21 Agu 2026: badan dokumen sudah berhuruf company serif font sementara nomor
  // halaman masih Segoe UI, terlihat dari daftar font yang tertanam di PDF.
  // Karena itu fontnya ditanam ulang di sini sebagai data URL.
  const gaya = fontDataUrl
    ? `<style>@font-face{font-family:'AIRA Doc';src:url('${fontDataUrl}') format('woff2');font-weight:400;}</style>`
    : ''
  return `${gaya}<div style="font-family:'Segoe UI',system-ui,sans-serif;font-size:8pt;color:#6d6a62;width:100%;padding:0 16mm;display:flex;justify-content:space-between;">
    <span>${kiri}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`
}

export function kepalaHalaman(): string {
  // Kosong tapi WAJIB ada: Chromium memakai template bawaannya (judul + URL
  // file) kalau header dikosongkan sama sekali, dan path file lokal ikut
  // tercetak di tiap halaman.
  return '<div></div>'
}

function escapeUntukTemplate(teks: string): string {
  return teks.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
