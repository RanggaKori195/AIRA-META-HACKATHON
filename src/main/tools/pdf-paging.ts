// Membagi PDF panjang menjadi potongan yang muat dibaca model, PER HALAMAN.
//
// Modul murni — tidak menyentuh pdf-parse maupun filesystem — supaya bisa diuji.
//
// Kenapa per halaman dan bukan sekadar `text.slice(0, batas)`:
// dilaporkan 19 Agu 2026, laporan 92 halaman (131.066 karakter) dipotong di tengah
// kalimat pada karakter ke-100.000. Model hanya diberi tahu `truncated: true` tanpa
// cara melanjutkan, jadi ia menyerah dan menawarkan "beri tahu kalau mau bagian
// tertentu" — sementara 31 ribu karakter sisanya tidak pernah terbaca. Model juga
// mengarang jumlah yang terpotong ("~95 ribu karakter"), karena angka itu memang
// tidak pernah diberikan kepadanya.

export interface HalamanPdf {
  num: number
  text: string
}

export interface PotonganPdf {
  teks: string
  dariHalaman: number
  sampaiHalaman: number
  /** Halaman berikutnya yang belum terbaca, atau `null` bila sudah habis. */
  lanjutkanDari: number | null
  /** Halaman yang isinya sendirian melebihi batas, jadi ikut dipotong di tengah. */
  halamanTerpotong: number[]
}

/**
 * Mengambil halaman `dari`..`sampai` sebanyak yang muat dalam `batasKarakter`.
 *
 * Berhenti di BATAS HALAMAN, bukan di tengah kalimat — sehingga potongan berikutnya
 * bisa diminta dengan tepat lewat `lanjutkanDari`.
 */
export function potongHalaman(
  halaman: readonly HalamanPdf[],
  dari: number,
  sampai: number,
  batasKarakter: number
): PotonganPdf {
  const total = halaman.length
  const mulai = Math.min(Math.max(Math.floor(dari) || 1, 1), Math.max(total, 1))
  const akhir = Math.min(Math.max(Math.floor(sampai) || total, mulai), total)

  const bagian: string[] = []
  const halamanTerpotong: number[] = []
  let panjang = 0
  let terakhir = mulai - 1

  for (let n = mulai; n <= akhir; n++) {
    const h = halaman[n - 1]
    if (!h) break
    const judul = `\n\n--- Halaman ${h.num} ---\n`
    const isi = h.text ?? ''
    const tambahan = judul.length + isi.length

    if (panjang > 0 && panjang + tambahan > batasKarakter) break

    if (tambahan > batasKarakter) {
      // ⚠️ Satu halaman yang SENDIRIAN melebihi batas tetap harus ikut, dipotong.
      // Kalau dilewati begitu saja, `lanjutkanDari` tidak pernah maju dan model
      // memanggil tool yang sama berulang-ulang pada halaman yang sama.
      const sisa = Math.max(batasKarakter - judul.length, 0)
      bagian.push(judul + isi.slice(0, sisa))
      halamanTerpotong.push(h.num)
      terakhir = n
      panjang = batasKarakter
      break
    }

    bagian.push(judul + isi)
    panjang += tambahan
    terakhir = n
  }

  // Tidak ada satu pun halaman yang muat (batas sangat kecil) — jangan kembalikan
  // rentang kosong yang membuat pemanggil mengira dokumennya habis.
  if (terakhir < mulai) terakhir = mulai

  const adaLagi = terakhir < total
  return {
    teks: bagian.join('').trimStart(),
    dariHalaman: mulai,
    sampaiHalaman: terakhir,
    lanjutkanDari: adaLagi ? terakhir + 1 : null,
    halamanTerpotong
  }
}

/** Halaman yang isinya nyaris kosong — kemungkinan halaman gambar, sampul, atau pembatas. */
export function halamanNyarisKosong(
  halaman: readonly HalamanPdf[],
  dari: number,
  sampai: number,
  ambang = 200
): number[] {
  return halaman
    .filter((h) => h.num >= dari && h.num <= sampai && (h.text ?? '').trim().length < ambang)
    .map((h) => h.num)
}

/**
 * Catatan status. **SELALU** berisi kalimat — tidak pernah kosong.
 *
 * ⚠️ Inilah guard anti-karangan. Dilaporkan dua kali 19 Agu 2026: saat hasil tool
 * tidak menyatakan apa pun tentang kelengkapan, model MENGARANG bahwa ada yang
 * terpotong — sekali "~95 ribu karakter terpotong" (yang benar 31 ribu), sekali
 * "sebagian teks halaman 14–27 terpotong otomatis oleh sistem" (halaman-halaman itu
 * justru penuh, 619–2077 karakter). Diam membuat model mengisi sendiri.
 *
 * Sengaja menyebut nama parameter dan nilainya secara harfiah: model 27B di project
 * ini berkali-kali terbukti tidak menyimpulkan langkah berikutnya sendiri.
 */
export function catatanHasil(
  p: PotonganPdf,
  totalHalaman: number,
  halamanKosong: readonly number[] = []
): string {
  const bagian: string[] = []

  if (p.lanjutkanDari === null) {
    bagian.push(
      `Teks halaman ${p.dariHalaman}–${p.sampaiHalaman} disertakan LENGKAP, tidak ada yang dipotong.`
    )
    if (p.sampaiHalaman >= totalHalaman) {
      bagian.push(`Seluruh ${totalHalaman} halaman dokumen sudah terbaca.`)
    }
  } else {
    bagian.push(
      `Teks halaman ${p.dariHalaman}–${p.sampaiHalaman} disertakan LENGKAP. ` +
        `Yang belum terbaca: halaman ${p.lanjutkanDari}–${totalHalaman}. ` +
        `Untuk melanjutkan, panggil read_pdf lagi dengan fromPage: ${p.lanjutkanDari}.`
    )
  }

  if (p.halamanTerpotong.length > 0) {
    bagian.push(
      `Halaman ${p.halamanTerpotong.join(', ')} sangat panjang sehingga isinya dipotong.`
    )
  }
  if (halamanKosong.length > 0) {
    bagian.push(
      `Halaman ${halamanKosong.join(', ')} nyaris tidak memuat teks (kemungkinan halaman gambar, ` +
        'sampul, atau pembatas) — itu memang isinya, bukan akibat pemotongan.'
    )
  }

  bagian.push(
    'JANGAN menyatakan ada teks yang terpotong selain yang disebutkan di catatan ini, ' +
      'dan jangan menyebut jumlah karakter yang terpotong.'
  )
  return bagian.join(' ')
}
