// Menyisipkan grafik ke dalam HTML laporan (jalur PDF).
//
// Modul MURNI supaya penempatannya bisa diuji tanpa mencetak apa pun.

/**
 * Menaruh grafik TEPAT SESUDAH judul utama, bukan di akhir dokumen.
 *
 * ⚠️ Penempatan ini keputusan sadar. Untuk pembaca manajemen, gambar di akhir
 * laporan praktis tidak pernah sampai — mereka membaca halaman pertama lalu
 * berhenti. Ringkasan visual di depan membuat angka di halaman berikutnya jadi
 * pendalaman, bukan penemuan.
 */
export function sisipkanGrafik(html: string, svg: readonly string[]): string {
  if (svg.length === 0) return html
  const blok =
    '<section class="grafik-ringkas">' +
    svg.map((s) => `<figure class="grafik">${s}</figure>`).join('') +
    '</section>'
  const tutupH1 = html.indexOf('</h1>')
  if (tutupH1 < 0) return blok + html
  const potong = tutupH1 + '</h1>'.length
  return html.slice(0, potong) + blok + html.slice(potong)
}

/**
 * Gaya cetak untuk grafik.
 *
 * `break-inside: avoid` wajib: tanpa itu Chromium bisa memotong satu grafik jadi
 * dua halaman, dan setengah grafik lebih buruk daripada tidak ada grafik.
 */
export const GAYA_GRAFIK =
  '.grafik-ringkas{margin:18px 0 26px}' +
  '.grafik{margin:0 0 18px;padding:0;break-inside:avoid;page-break-inside:avoid}' +
  '.grafik svg{width:100%;height:auto;display:block}'
