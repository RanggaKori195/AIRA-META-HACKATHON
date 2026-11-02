// Peramalan penjualan — modul MURNI (tanpa database), supaya bisa diuji.
//
// ⚠️ Seluruh angka ramalan dihitung DI SINI, bukan oleh model. Ini penerapan
// paling keras dari aturan lama project ("angka yang salah lebih berbahaya
// daripada fitur yang belum ada"): forecast adalah angka yang TIDAK BISA
// DIVERIFIKASI hari ini tapi dipakai mengambil keputusan. Membiarkan model
// mengekstrapolasi sendiri berarti menyerahkan angka rapat direksi ke tebakan.
//
// Metodenya dipilih dari BACKTEST ke data sungguhan (`scripts/probe-forecast.ts`,
// 20 Agu 2026), bukan dari teori:
//
//   regresi linier 12 bln   MAPE  6,9%   <- dipakai
//   rata-rata bergerak 3    MAPE  8,7%
//   naif (bulan lalu)       MAPE 10,5%
//   drift 3 bulan           MAPE 10,5%
//   naif musiman x YoY      MAPE 38,1%   <- justru PALING BURUK
//
// ⚠️ Musiman sengaja TIDAK dipakai. Di data ini pertumbuhan (18x dalam 2 tahun)
// menenggelamkan pola bulanan, dan metode musiman meleset 38%. Holt-Winters/ARIMA
// yang terdengar lebih canggih akan lebih jelek DI SINI, sekaligus menambah
// ketergantungan library. Kalau kelak riwayatnya lebih panjang, jalankan ulang
// probe-nya sebelum mengganti metode — jangan berganti karena teorinya lebih bagus.

/** Riwayat minimal sebelum ramalan boleh disajikan sama sekali. */
export const MIN_RIWAYAT = 6

/** Jendela yang dipakai regresi. 12 bulan menang di backtest. */
export const JENDELA = 12

/**
 * Batas horizon. Di luar ini tren linier jadi omong kosong — pada laju
 * pertumbuhan sekarang, ramalan 6 bulan ke depan berarti mengekstrapolasi
 * kenaikan yang belum tentu punya kapasitas lab-nya. Menolak lebih jujur
 * daripada memberi angka tanpa dasar.
 */
export const MAKS_HORIZON = 3

export interface Titik {
  bulan: string
  nett: number
}

export interface Garis {
  kemiringan: number
  potong: number
}

/** Regresi kuadrat terkecil pada indeks 0..n-1. */
export function regresi(nilai: readonly number[]): Garis {
  const n = nilai.length
  if (n === 0) return { kemiringan: 0, potong: 0 }
  if (n === 1) return { kemiringan: 0, potong: nilai[0] }
  const sx = (n * (n - 1)) / 2
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6
  const sy = nilai.reduce((a, b) => a + b, 0)
  const sxy = nilai.reduce((a, b, i) => a + b * i, 0)
  const pembagi = n * sxx - sx * sx
  if (pembagi === 0) return { kemiringan: 0, potong: sy / n }
  const kemiringan = (n * sxy - sx * sy) / pembagi
  return { kemiringan, potong: (sy - kemiringan * sx) / n }
}

/**
 * MAPE dari backtest berjalan (walk-forward) pada riwayat yang ada.
 *
 * ⚠️ Ini yang membuat ramalan boleh disajikan: angkanya selalu ditemani
 * "meleset rata-rata sekian persen". Forecast tanpa ukuran ketidakpastian adalah
 * bentuk paling halus dari angka yang terdengar meyakinkan — dan justru bentuk
 * itu yang paling berbahaya di depan manajemen.
 *
 * Dihitung ulang dari data terbaru setiap kali, bukan angka tetap 6,9% yang
 * ditulis di kode: begitu polanya berubah, akurasinya ikut turun DI LAYAR, dan
 * itu terlihat sebelum ada yang salah mengambil keputusan.
 */
export function mapeBacktest(riwayat: readonly number[], uji = 6): number | null {
  const minimal = MIN_RIWAYAT + 2
  const jumlahUji = Math.min(uji, riwayat.length - minimal)
  if (jumlahUji < 2) return null

  let total = 0
  let dipakai = 0
  for (let i = riwayat.length - jumlahUji; i < riwayat.length; i++) {
    const latih = riwayat.slice(Math.max(0, i - JENDELA), i)
    if (latih.length < MIN_RIWAYAT) continue
    const g = regresi(latih)
    const ramal = g.potong + g.kemiringan * latih.length
    const aktual = riwayat[i]
    if (aktual <= 0) continue
    total += Math.abs(ramal - aktual) / aktual
    dipakai++
  }
  return dipakai >= 2 ? (total / dipakai) * 100 : null
}

export interface Ramalan {
  bulan: string
  nett: number
  bawah: number | null
  atas: number | null
}

/** Nama bulan berikutnya dari "YYYY-MM". */
export function bulanBerikut(bulan: string, langkah = 1): string {
  const [y, m] = bulan.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + langkah
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Berapa bulan jarak dari `a` ke `b` (positif bila b lebih baru). */
export function selisihBulan(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb * 12 + mb) - (ya * 12 + ma)
}

/**
 * Nilai yang DIHARAPKAN tren untuk sebuah bulan — dipakai membandingkan bulan
 * berjalan dengan trennya sendiri.
 *
 * Menjawab pertanyaan yang paling sering menyusul di rapat: "bulan ini bagus
 * atau jelek?" Proyeksi sendirian tidak menjawabnya — Rp 8 M itu bagus atau
 * buruk hanya berarti kalau dibandingkan dengan yang seharusnya.
 */
export function harapanTren(riwayat: readonly Titik[], bulan: string): number | null {
  if (riwayat.length < MIN_RIWAYAT) return null
  const jendela = riwayat.slice(-JENDELA)
  const g = regresi(jendela.map((t) => t.nett))
  const jarak = selisihBulan(riwayat[riwayat.length - 1].bulan, bulan)
  if (jarak < 1) return null
  return Math.max(0, g.potong + g.kemiringan * (jendela.length - 1 + jarak))
}

/**
 * Ramalan beberapa bulan ke depan.
 *
 * Batas bawah/atas berasal dari MAPE backtest — bukan dari interval kepercayaan
 * regresi. Alasannya jujur: interval regresi mengandaikan galatnya acak dan
 * modelnya benar, sementara yang benar-benar kita tahu adalah SEBERAPA SERING
 * metode ini meleset di data ini. Yang kedua lebih sedikit mengklaim.
 *
 * Nilai negatif dipangkas ke 0 — tren menurun yang diekstrapolasi bisa
 * menghasilkan omzet minus, dan angka itu tidak berarti apa-apa.
 */
export function ramal(
  riwayat: readonly Titik[],
  horizon: number,
  mape: number | null,
  /**
   * Bulan pertama yang diramal. Bila diisi, bulan-bulan di antara riwayat
   * terakhir dan bulan ini DILEWATI — tapi tetap dihitung sebagai jarak
   * ekstrapolasi, karena garisnya memang harus diperpanjang sejauh itu.
   *
   * ⚠️ Ini memperbaiki cacat yang baru ketahuan saat live-check 20 Agu 2026:
   * riwayat berakhir Juli (bulan penuh terakhir), jadi ramalan langkah-1 jatuh
   * ke AGUSTUS — bulan yang sedang berjalan. Akibatnya `sales_forecast` bilang
   * Agustus Rp 10,13 M sementara `sales_projection` — yang membaca transaksi
   * Agustus yang SUDAH terjadi — bilang Rp 8,17 M. Dua angka untuk bulan yang
   * sama, beda 20%, dan mana yang muncul tergantung tool mana yang kebetulan
   * dipanggil model. Bulan berjalan adalah urusan `sales_projection` (ia punya
   * data nyata); ramalan mulai dari bulan SESUDAHNYA.
   */
  mulaiDari?: string
): Ramalan[] {
  const langkah = Math.min(Math.max(Math.trunc(horizon) || 1, 1), MAKS_HORIZON)
  const jendela = riwayat.slice(-JENDELA)
  const g = regresi(jendela.map((t) => t.nett))
  const n = jendela.length
  const terakhir = riwayat[riwayat.length - 1].bulan
  const lompat = mulaiDari ? Math.max(0, selisihBulan(terakhir, mulaiDari) - 1) : 0

  const hasil: Ramalan[] = []
  for (let i = 1 + lompat; i <= langkah + lompat; i++) {
    const nilai = Math.max(0, g.potong + g.kemiringan * (n - 1 + i))
    // Ketidakpastian melebar makin jauh horizonnya — meramal 3 bulan ke depan
    // tidak sepasti 1 bulan, dan menyajikan lebar yang sama untuk keduanya
    // menyesatkan. Lebarnya mengikuti jarak dari riwayat terakhir (`i`), bukan
    // urutan tampil: ramalan yang melompati bulan berjalan memang lebih jauh.
    const lebar = mape === null ? null : (mape / 100) * Math.sqrt(i)
    hasil.push({
      bulan: bulanBerikut(terakhir, i),
      nett: nilai,
      bawah: lebar === null ? null : Math.max(0, nilai * (1 - lebar)),
      atas: lebar === null ? null : nilai * (1 + lebar)
    })
  }
  return hasil
}

// ------------------------------------------------------- proyeksi bulan berjalan

export interface Proyeksi {
  proyeksiNett: number
  /** Porsi bulan yang menurut riwayat sudah terlewati sampai hari ini. */
  porsiTerlewati: number
  dasar: 'kurva historis' | 'pro-rata hari'
}

/**
 * Memproyeksikan nett bulan berjalan sampai tutup bulan.
 *
 * ⚠️ Memakai KURVA penumpukan historis, bukan pro-rata hari.
 *
 * Terukur pada 6 bulan penuh terakhir (20 Agu 2026): sampai tanggal 20, rata-rata
 * baru terkumpul 61,1% dari nett bulan itu — sementara pro-rata naif (20/31)
 * mengira 64,5%. Selisih 5% pada angka yang dibawa ke rapat bukan pembulatan.
 * Kurva penuhnya: tgl 5 = 14,6% · 10 = 31,2% · 15 = 44,8% · 20 = 61,1% ·
 * 25 = 80,7% · 28 = 92,3%.
 *
 * `porsiPerHari` dikirim dari pemanggil (dihitung dari database), jadi kurvanya
 * ikut bergerak bersama kebiasaan lab — bukan konstanta yang membeku di kode.
 */
export function proyeksiBulanBerjalan(
  nettSejauhIni: number,
  hariKe: number,
  hariDalamBulan: number,
  porsiPerHari: ReadonlyMap<number, number>
): Proyeksi {
  const porsiKurva = porsiPerHari.get(hariKe)
  // Kurva dipakai hanya kalau masuk akal. Porsi 0 (atau nyaris) akan meledakkan
  // pembagian jadi angka raksasa — tepat jenis angka meyakinkan yang paling
  // berbahaya.
  if (porsiKurva !== undefined && porsiKurva > 0.02) {
    return {
      proyeksiNett: nettSejauhIni / porsiKurva,
      porsiTerlewati: porsiKurva,
      dasar: 'kurva historis'
    }
  }
  const porsi = Math.max(hariKe / hariDalamBulan, 0.02)
  return { proyeksiNett: nettSejauhIni / porsi, porsiTerlewati: porsi, dasar: 'pro-rata hari' }
}

// --------------------------------------------------------------- momentum item

export type Arah = 'naik' | 'turun' | 'datar' | 'baru'

export interface Momentum {
  arah: Arah
  /** Perubahan rata-rata per bulan, dalam rupiah. */
  lajuPerBulan: number
  /** Perubahan per bulan relatif terhadap rata-rata — `null` bila rata-ratanya nol. */
  lajuPersen: number | null
  /** Seberapa jauh bulan terakhir menyimpang dari trennya sendiri, dalam persen. */
  penyimpangan: number | null
}

/**
 * Arah dan laju sebuah deret — dipakai untuk "pemeriksaan mana yang sedang naik".
 *
 * `penyimpangan` menjawab pertanyaan yang berbeda dan sama pentingnya: bukan "ke
 * mana arahnya" melainkan "apakah bulan ini ANEH dibanding trennya sendiri".
 * Item yang trennya naik tapi bulan ini jatuh 40% adalah peringatan dini yang
 * tidak terlihat pada peringkat naik-turun biasa.
 *
 * ⚠️ Ambang "datar" 2% per bulan disengaja. Tanpa ambang, deret yang praktis
 * mendatar akan tetap diberi label naik/turun hanya karena kemiringannya tidak
 * persis nol — dan daftar "yang sedang naik" jadi penuh item yang tidak
 * bergerak.
 */
export function momentum(nilai: readonly number[]): Momentum {
  if (nilai.length < 3) {
    return { arah: 'baru', lajuPerBulan: 0, lajuPersen: null, penyimpangan: null }
  }
  const jendela = nilai.slice(-JENDELA)
  const g = regresi(jendela)
  const rata = jendela.reduce((a, b) => a + b, 0) / jendela.length
  const lajuPersen = rata > 0 ? (g.kemiringan / rata) * 100 : null

  const terakhir = jendela[jendela.length - 1]
  const diharapkan = g.potong + g.kemiringan * (jendela.length - 1)
  const penyimpangan = diharapkan > 0 ? ((terakhir - diharapkan) / diharapkan) * 100 : null

  let arah: Arah = 'datar'
  if (lajuPersen !== null && lajuPersen >= 2) arah = 'naik'
  else if (lajuPersen !== null && lajuPersen <= -2) arah = 'turun'

  return { arah, lajuPerBulan: g.kemiringan, lajuPersen, penyimpangan }
}

/**
 * Kalimat yang WAJIB ikut di setiap hasil ramalan.
 *
 * Hasil tool tidak boleh diam soal keterbatasannya — pelajaran yang sudah dibayar
 * dua kali di project ini (model mengarang soal pemotongan PDF). Untuk forecast
 * taruhannya lebih tinggi lagi: yang membaca adalah direksi, dan angkanya tidak
 * bisa dibantah sampai bulannya lewat.
 */
export function catatanRamalan(mape: number | null, jumlahRiwayat: number): string {
  const akurasi =
    mape === null
      ? 'Akurasi historis belum bisa dihitung (riwayat terlalu pendek) — perlakukan angka ini sebagai perkiraan kasar.'
      : `Metode ini meleset rata-rata ${mape.toFixed(1)}% pada pengujian ke bulan-bulan yang sudah lewat.`
  return (
    `Ramalan dihitung dari tren ${Math.min(jumlahRiwayat, JENDELA)} bulan terakhir (regresi linier), ` +
    `berdasarkan ${jumlahRiwayat} bulan riwayat. ${akurasi} ` +
    'Ini PERKIRAAN, bukan angka yang sudah terjadi — sebut selalu rentangnya, jangan hanya nilai tengahnya, ' +
    'dan jangan menambah alasan (musim, kampanye, cuaca) yang tidak ada di data ini. ' +
    'Pola musiman sengaja TIDAK dipakai karena terbukti paling tidak akurat pada data ini.'
  )
}
