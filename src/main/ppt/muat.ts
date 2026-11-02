// Apakah teksnya MUAT di dalam slide — dan kalau tidak, dipecah ke slide
// berikutnya.
//
// ⚠️ Ini modul terpenting di folder ini, dan alasannya sama dengan alasan
// `truncation-guard.ts` ada: kegagalan tata letak PowerPoint itu SUNYI. Teks
// yang kepanjangan tidak menghasilkan error apa pun — ia hanya keluar dari
// kotaknya, menimpa bilah hijau di kaki slide, atau tertutup logo. Berkasnya
// tetap terbit dan tetap terlihat "berhasil dibuat", dan yang menemukannya
// adalah orang yang membuka deck itu di depan direksi.
//
// Karena itu keputusan muat/tidak diambil DI KODE sebelum slide disusun, bukan
// diserahkan ke autofit PowerPoint (yang perilakunya berbeda antar versi dan
// diabaikan LibreOffice), dan bukan pula diserahkan ke imbauan di prompt.
//
// Modul murni tanpa impor apa pun supaya bisa diuji langsung.

export interface Anggaran {
  /** Perkiraan jumlah karakter yang muat dalam satu baris. */
  perBaris: number
  /** Jumlah baris yang muat dalam tinggi kotak. */
  maksBaris: number
}

/**
 * Lebar rata-rata satu karakter, dalam kelipatan ukuran huruf.
 *
 * Ditaksir 0,52 em — sedikit lebih lebar daripada rata-rata sebenarnya font
 * proporsional (±0,5 em) DENGAN SENGAJA. Taksiran yang kelewat optimistis
 * berakhir sebagai teks meluber; taksiran yang kelewat hati-hati cuma berakhir
 * sebagai satu slide tambahan. Dua jenis kesalahan itu tidak setara harganya.
 */
const LEBAR_KARAKTER = 0.52

/** Tinggi satu baris terhadap ukuran huruf (line-height). */
const JARAK_BARIS = 1.3

/** Jarak antar butir, dinyatakan dalam pecahan baris. */
const SELA_BUTIR = 0.45

/** Berapa karakter yang muat dalam satu baris selebar `lebar` inci pada `sz` pt. */
export function perBaris(lebar: number, sz: number): number {
  return Math.max(1, Math.floor((lebar * 72) / (sz * LEBAR_KARAKTER)))
}

/** Berapa baris yang dibutuhkan sepotong teks pada lebar & ukuran huruf tertentu. */
export function barisTeks(teks: string, lebar: number, sz: number): number {
  return barisDipakai(teks, perBaris(lebar, sz))
}

/** Berapa karakter & baris yang muat di kotak berukuran (lebar x tinggi) inci. */
export function anggaran(lebar: number, tinggi: number, sz: number): Anggaran {
  return {
    perBaris: perBaris(lebar, sz),
    maksBaris: Math.max(1, Math.floor((tinggi * 72) / (sz * JARAK_BARIS)))
  }
}

/** Berapa baris yang dihabiskan sepotong teks pada anggaran tertentu. */
export function barisDipakai(teks: string, perBaris: number): number {
  const bersih = teks.trim()
  if (!bersih) return 1
  return Math.max(1, Math.ceil(bersih.length / perBaris))
}

/**
 * Memecah daftar butir menjadi beberapa slide yang masing-masing muat.
 *
 * Butir yang SENDIRIAN lebih panjang dari satu slide tetap dipertahankan utuh
 * dan diberi slidenya sendiri — tidak pernah dipotong. Memotong kalimat
 * seseorang di tengah adalah kehilangan isi yang tidak bisa dilihat pembaca;
 * slide yang agak padat masih bisa dilihat dan diperbaiki manusia.
 */
export function pecahButir<T>(
  butir: readonly T[],
  teksDari: (b: T) => string,
  a: Anggaran
): T[][] {
  if (butir.length === 0) return []
  const hasil: T[][] = []
  let sekarang: T[] = []
  let terpakai = 0

  for (const b of butir) {
    const biaya = barisDipakai(teksDari(b), a.perBaris) + (sekarang.length ? SELA_BUTIR : 0)
    if (sekarang.length && terpakai + biaya > a.maksBaris) {
      hasil.push(sekarang)
      sekarang = [b]
      terpakai = barisDipakai(teksDari(b), a.perBaris)
      continue
    }
    sekarang.push(b)
    terpakai += biaya
  }
  if (sekarang.length) hasil.push(sekarang)
  return hasil
}

/**
 * Memecah baris tabel. Tinggi baris tidak dihitung dari ukuran huruf saja
 * karena sel bisa membungkus jadi dua baris; `tinggiBaris` sudah termasuk
 * kelonggaran itu.
 */
export function pecahBaris<T>(baris: readonly T[], maksBaris: number): T[][] {
  if (baris.length === 0) return []
  const hasil: T[][] = []
  for (let i = 0; i < baris.length; i += maksBaris) {
    hasil.push(baris.slice(i, i + maksBaris))
  }
  return hasil
}

/**
 * Judul lanjutan untuk slide pecahan.
 *
 * Diberi penanda supaya pembaca deck tahu ini sambungan — bukan slide yang
 * kebetulan berjudul sama. Slide pertama tidak diberi penanda.
 */
export function judulLanjutan(judul: string, ke: number): string {
  return ke === 0 ? judul : `${judul} (lanjutan ${ke + 1})`
}
