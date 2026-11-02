// Tema presentasi the company. SELURUH angka di berkas ini disalin dari template
// korporat "Pra Performance - IT Dept - 2026 07.pptx" (the company 60 tahun), bukan
// dikira-kira: ukuran slide, posisi placeholder, ukuran huruf, dan kode warna
// dibaca langsung dari `ppt/slideLayouts/*.xml` di dalam berkas templatenya.
//
// Dipisah dari logika render supaya tampilan bisa diubah tanpa menyentuh
// penyusunan slide — pola yang sama dengan `pdf/style.ts`.

import { barisTeks } from './muat'

/** Ukuran slide template: 9144000 x 5143500 EMU = 10 x 5,625 inci (16:9). */
export const SLIDE = { lebar: 10, tinggi: 5.625 } as const

/**
 * Warna hijau template.
 *
 * ⚠️ Sengaja BUKAN `#2f6f3e` (hijau antarmuka AIRA). Yang dipakai di sini
 * adalah warna template korporat apa adanya — deck ini akan berdiri di
 * sebelah deck buatan divisi lain, dan yang harus cocok adalah templatenya.
 */
export const WARNA = {
  /** Judul slide isi & sampul (slideLayout1 & 2). */
  judul: '027733',
  /** Judul pembatas bagian (slideLayout4). */
  bagian: '187C3B',
  /** Aksen terang untuk penanda poin & garis (dari slide1 template). */
  aksen: '209038',
  teks: '212121',
  redup: '595959',
  garis: 'D6E3D8',
  kartu: 'F4F8F4',
  putih: 'FFFFFF'
} as const

/**
 * Font korporat, sesuai template.
 *
 * ⚠️ **Font TIDAK tertanam di dalam `.pptx`** — berkas Office hanya menyimpan
 * NAMA font, yang dipakai adalah font di komputer pembaca (catatan yang sama
 * berlaku untuk `.docx`/`.xlsx`, lihat HANDOFF §5). Kalau "company sans font" tidak
 * terpasang, PowerPoint mengganti sendiri TANPA satu pun pesan — persis jenis
 * kegagalan sunyi yang sudah pernah memakan waktu di project ini (PDF tercetak
 * Segoe UI, 21 Agu 2026).
 *
 * Karena itu dua hal: `catatanHasil` selalu menyebut font yang dibutuhkan, dan
 * `scripts/coba-ppt.ts` melaporkan font mana yang tidak ada di mesin penguji.
 * Kalau ternyata laptop the company tidak memasang font ini, cukup ubah DI SINI.
 */
export const FONT = {
  judul: 'company sans font',
  isi: 'company sans font',
  bagian: 'company display font'
} as const

/** Semua nama font yang mungkin dirujuk deck — dipakai `coba-ppt.ts`. */
export const FONT_DIPAKAI = [...new Set(Object.values(FONT))]

/**
 * Geometri placeholder, dalam inci: [x, y, lebar, tinggi].
 *
 * Sumbernya `<a:xfrm>` di dalam layout template:
 *   sampul   <- slideLayout1 (TITLE)
 *   isi      <- slideLayout2 (Custom Layout)
 *   nomor    <- slideMaster1 (sldNum)
 *
 * Batas bawah badan (0,96 + 3,93 = 4,89) TIDAK boleh dinaikkan: di bawahnya ada
 * bilah hijau bertuliskan "a Journey of Purpose, Growth, and Hope" yang menyatu
 * dengan gambar latar. Teks yang melewatinya akan tertimpa bilah itu.
 */
export const KOTAK = {
  sampulJudul: [5.39, 2.2, 4.42, 0.82],
  sampulSubjudul: [5.39, 3.08, 4.42, 0.55],
  sampulCatatan: [5.39, 3.72, 4.42, 0.4],
  judul: [0.21, 0.09, 8.31, 0.6],
  badan: [0.2, 0.96, 9.47, 3.93],
  bagianJudul: [0.24, 2.2, 8.12, 0.7],
  bagianSubjudul: [0.24, 3.0, 8.12, 0.5],
  nomor: [9.27, 5.1, 0.6, 0.43]
} as const satisfies Record<string, readonly [number, number, number, number]>

/** Ukuran huruf, dalam pt. Sesuai template kecuali yang diberi catatan. */
export const UKURAN = {
  sampulJudul: 40,
  sampulSubjudul: 20,
  sampulCatatan: 12,
  judul: 40,
  isi: 16,
  bagianJudul: 30,
  bagianSubjudul: 16,
  /** Tabel dibuat lebih kecil dari badan biasa supaya muat lebih banyak baris. */
  tabel: 12,
  /** Angka besar pada kartu KPI. */
  angka: 32,
  labelAngka: 12,
  nomor: 10
} as const

/**
 * Judul panjang MENGECIL, tidak meluber.
 *
 * ⚠️ Ukurannya dihitung dari LEBAR KOTAKNYA, bukan dari ambang jumlah karakter.
 * Versi pertama memakai ambang tebakan ("sampai 32 karakter tetap 40pt") dan
 * judul 29 karakter "Yang menguat dan yang melemah" tetap 40pt, membungkus jadi
 * dua baris, lalu naik keluar dari slide — tidak ada error, hanya terlihat
 * rusak saat decknya dibuka. Sekarang perhitungannya memakai `barisTeks` yang
 * sama dengan penentu muat/tidak di `muat.ts`: satu definisi, tidak bisa
 * menyimpang diam-diam.
 *
 * Judul slide isi wajib satu baris (di bawahnya ada garis hijau pada gambar
 * latar pada y ≈ 0,75 inci); sampul boleh dua baris karena tumbuh ke atas.
 */
export function ukuranJudul(
  teks: string,
  dasar: number = UKURAN.judul,
  lebar: number = KOTAK.judul[2],
  maksBaris = 1
): number {
  const tangga = [dasar, dasar * 0.8, dasar * 0.65, dasar * 0.55].map((n) => Math.round(n))
  for (const sz of tangga) {
    if (barisTeks(teks, lebar, sz) <= maksBaris) return sz
  }
  return tangga[tangga.length - 1]
}

/** Batas panjang judul; di atas ini render menolak. */
export const MAKS_JUDUL = 90

/** Palet seri grafik — hijau template dulu, baru warna pendamping. */
export const PALET_GRAFIK = ['027733', '209038', '78909C', 'FFAB40', '0097A7', '187C3B']

/**
 * Tiga blok teks sampul, DISUSUN dari bawah ke atas.
 *
 * ⚠️ Versi pertama memakai tiga kotak dengan posisi TETAP dari template
 * (judul 2,20 / subjudul 3,08 / catatan 3,72), masing-masing setinggi satu
 * baris. Terlihat benar sampai deck sungguhan pertama dibuat (21 Agu 2026,
 * "AURA Clinical GenAI"): subjudulnya 3 baris, jadi ia menimpa judul di atasnya
 * DAN catatan di bawahnya. Tidak ada error, tidak ada peringatan — tiga blok
 * teks tumpang tindih di slide pembuka.
 *
 * Kotak yang posisinya tetap hanya aman kalau isinya juga tetap. Karena isinya
 * datang dari model, tingginya dihitung dari jumlah baris masing-masing lalu
 * ditumpuk — dan `coba:ppt` sekarang menolak deck yang blok teksnya bertindih.
 *
 * Modul murni supaya bisa diuji tanpa Electron; dipakai `sampul()` di bawah.
 */
export function susunSampul(
  judul: string,
  subjudul: string | undefined,
  catatan: string | undefined
): Array<{ bagian: 'judul' | 'subjudul' | 'catatan'; y: number; h: number; sz: number }> {
  const [, , lebar] = KOTAK.sampulJudul
  const SELA = 0.14
  /** Dasar tumpukan: sejajar akhir blok tiga baris pada template. */
  const DASAR = 4.12

  const tinggiUntuk = (teks: string, sz: number): number =>
    (barisTeks(teks, lebar, sz) * sz * 1.4) / 72

  const blok: Array<{ bagian: 'judul' | 'subjudul' | 'catatan'; y: number; h: number; sz: number }> =
    []
  let y = DASAR

  if (catatan) {
    const sz = UKURAN.sampulCatatan
    const h = tinggiUntuk(catatan, sz)
    y -= h
    blok.unshift({ bagian: 'catatan', y, h, sz })
    y -= SELA
  }
  if (subjudul) {
    // Subjudul ikut mengecil bila panjang — di sampul ia tidak boleh mendorong
    // judul keluar slide.
    const sz = ukuranJudul(subjudul, UKURAN.sampulSubjudul, lebar, 2)
    const h = tinggiUntuk(subjudul, sz)
    y -= h
    blok.unshift({ bagian: 'subjudul', y, h, sz })
    y -= SELA
  }
  const szJudul = ukuranJudul(judul, UKURAN.sampulJudul, lebar, 2)
  const hJudul = tinggiUntuk(judul, szJudul)
  y -= hJudul
  blok.unshift({ bagian: 'judul', y, h: hJudul, sz: szJudul })

  // Kalau tumpukannya tetap keluar dari atas slide, seluruh blok digeser turun.
  // Lebih baik sampulnya agak rendah daripada judulnya terpotong tepi atas.
  const atas = blok[0].y
  if (atas < 0.35) {
    const geser = 0.35 - atas
    for (const b of blok) b.y += geser
  }
  return blok
}
