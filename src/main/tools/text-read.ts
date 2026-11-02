// Pembacaan file teks per BARIS beserta catatan kelengkapannya. Modul MURNI.
//
// ⚠️ Lahir dari kejadian nyata 21 Agu 2026, dilaporkan manajemen saat uji coba.
// AIRA membaca file .md berukuran 11.470 karakter — batas tool 256 KB, jadi
// terpakai kurang dari 5% — lalu menutup jawabannya dengan:
//
//   "ada sebagian tengah dokumen (sekitar Bagian 4-8, termasuk arsitektur detail
//    dan fase roadmap) yang terpotong saat dibaca"
//
// Tidak ada satu pun yang terpotong. Bagian 4-8 ada utuh di file itu, dan tool
// mengembalikan `truncated: false`.
//
// Ini PENGULANGAN pelajaran 19 Agu 2026 pada read_pdf, dalam wujud yang lebih
// halus: di sana hasil tool DIAM soal kelengkapan; di sini ia sebenarnya
// menyebutkan, tapi hanya sebagai BOOLEAN (`truncated: false`) di tengah JSON.
// Bendera boolean ternyata tidak cukup — model 27B mengabaikannya dan mengarang
// cerita tentang bagian yang hilang. Yang bekerja adalah KALIMAT yang menyatakan
// kelengkapan secara harfiah, plus larangan eksplisit menyebut pemotongan di
// luar yang disebutkan.
//
// Kenapa ini berbahaya, bukan sekadar salah kecil: pembacanya manajemen. Kalimat
// "sebagian dokumen terpotong" membuat mereka meragukan seluruh ringkasan yang
// sebenarnya benar — dan tidak ada cara bagi mereka untuk tahu bahwa
// keraguannya tidak berdasar.

/** Batas byte sekali baca. Sama dengan MAX_READ_BYTES di fs-tools. */
export interface PotonganTeks {
  /** Baris pertama yang disertakan (1-based). */
  dariBaris: number
  /** Baris terakhir yang disertakan (1-based). */
  sampaiBaris: number
  /** Isi yang disertakan. */
  teks: string
  /** Baris berikutnya yang belum terbaca, atau `null` bila sudah habis. */
  lanjutkanDari: number | null
}

/**
 * Memotong teks di BATAS BARIS, bukan di tengah baris.
 *
 * Memotong di tengah baris menghasilkan kalimat atau baris tabel yang terputus,
 * dan itu justru bahan bakar untuk kesimpulan "dokumennya rusak/terpotong".
 */
export function potongTeks(isi: string, dariBaris: number, maksByte: number): PotonganTeks {
  const baris = isi.split('\n')
  const mulai = Math.min(Math.max(Math.trunc(dariBaris) || 1, 1), Math.max(baris.length, 1))

  const dipakai: string[] = []
  let byte = 0
  let i = mulai - 1
  for (; i < baris.length; i++) {
    const ukuran = Buffer.byteLength(baris[i], 'utf8') + 1
    // Baris pertama selalu diambil walau sendirian sudah melebihi batas —
    // kalau tidak, file berisi satu baris raksasa mengembalikan teks kosong
    // tanpa sebab yang terlihat.
    if (byte + ukuran > maksByte && dipakai.length > 0) break
    dipakai.push(baris[i])
    byte += ukuran
  }

  return {
    dariBaris: mulai,
    sampaiBaris: mulai + dipakai.length - 1,
    teks: dipakai.join('\n'),
    lanjutkanDari: i < baris.length ? i + 1 : null
  }
}

/**
 * Kalimat kelengkapan yang WAJIB ikut di setiap hasil pembacaan.
 *
 * ⚠️ TIDAK PERNAH mengembalikan string kosong, bahkan saat filenya utuh terbaca.
 * Justru kasus "utuh" yang paling penting dinyatakan — di situlah model terbukti
 * mengarang pemotongan yang tidak ada.
 */
export function catatanBaca(p: PotonganTeks, totalBaris: number, namaFile: string): string {
  const bagian: string[] = []

  if (p.lanjutkanDari === null && p.dariBaris === 1) {
    bagian.push(
      `SELURUH isi file "${namaFile}" terbaca lengkap: ${totalBaris} baris, tidak ada satu pun ` +
        'bagian yang dipotong atau dilewati.'
    )
  } else if (p.lanjutkanDari === null) {
    bagian.push(
      `Baris ${p.dariBaris}–${p.sampaiBaris} dari ${totalBaris} baris disertakan LENGKAP. ` +
        'Ini bagian terakhir file; tidak ada sisa yang belum terbaca.'
    )
  } else {
    bagian.push(
      `Baris ${p.dariBaris}–${p.sampaiBaris} dari ${totalBaris} baris disertakan LENGKAP. ` +
        `Yang BELUM terbaca: baris ${p.lanjutkanDari}–${totalBaris}. Untuk melanjutkan, panggil ` +
        `read_file lagi pada file yang sama dengan fromLine: ${p.lanjutkanDari}.`
    )
  }

  // Larangan harfiah. Tanpa ini, model mengisi sendiri kekosongan dengan tebakan
  // yang terdengar masuk akal ("bagian tengah terpotong") — terjadi 19 Agu 2026
  // pada read_pdf dan berulang 21 Agu 2026 pada read_file.
  bagian.push(
    'DILARANG menyatakan ada bagian yang terpotong, hilang, atau tidak terbaca di luar yang ' +
      'disebutkan kalimat ini. Kalau kamu tidak menemukan suatu bagian di dalam teks, artinya ' +
      'bagian itu memang tidak ada di file — bukan terpotong.'
  )

  return bagian.join(' ')
}
