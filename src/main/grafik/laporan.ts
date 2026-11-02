import type { DataLaporan } from '../sales/report'
import type { SpekGrafik } from './svg'

// Memilih grafik APA yang pantas muncul di laporan penjualan.
//
// Modul MURNI dan terpisah dari mesin gambarnya, karena yang paling mudah salah
// di sini bukan cara menggambar melainkan APA yang digambar.
//
// ⚠️ Grafik hanya dibuat dari data yang MEMANG ADA di laporan. Tidak ada satu
// pun angka yang dihitung ulang, ditebak, atau diinterpolasi di berkas ini —
// angka di grafik wajib sama persis dengan angka di tabelnya. Grafik yang
// berbeda dari tabel di dokumen yang sama adalah kesalahan terburuk yang bisa
// dibuat laporan: dua-duanya terlihat resmi, dan pembaca tidak tahu mana yang
// benar.

/** Minimal batang sebelum sebuah grafik layak dibuat. */
const MIN_BATANG = 2
/** Maksimal irisan/batang yang ditampilkan — sisanya digabung. */
const MAKS_IRISAN = 6

export interface GrafikLaporan {
  /** Kunci penempatan; dipakai penulis dokumen untuk menaruhnya di bagian yang tepat. */
  kunci: 'perbandingan' | 'kontribusi' | 'topItem' | 'topPelanggan' | 'wilayah'
  spek: SpekGrafik
}

function bersih(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/**
 * Menggabungkan ekor daftar jadi satu irisan "Lainnya".
 *
 * ⚠️ Ekor TIDAK dibuang diam-diam. Grafik yang hanya menampilkan 6 teratas dari
 * 40 pelanggan, tanpa "Lainnya", membuat pembaca menyimpulkan enam itulah
 * seluruh bisnisnya — dan proporsinya terlihat jauh lebih besar dari kenyataan.
 */
export function ringkasEkor(
  baris: Array<{ nama: string; nilai: number }>,
  maks = MAKS_IRISAN
): Array<{ nama: string; nilai: number }> {
  if (baris.length <= maks) return baris
  const depan = baris.slice(0, maks - 1)
  const ekor = baris.slice(maks - 1)
  const jumlah = ekor.reduce((n, b) => n + b.nilai, 0)
  if (jumlah <= 0) return depan
  return [...depan, { nama: `Lainnya (${ekor.length})`, nilai: jumlah }]
}

/**
 * Irisan pai WAJIB relatif terhadap TOTAL periode, bukan jumlah baris yang tercantum.
 *
 * ⚠️ Daftar wilayah hanya memuat 10 teratas (±86% nett). Tanpa sisa, pai menghitung
 * persen dari 86% itu — PDF uji 30 Sep menulis DKI Jakarta 49,6% di grafik sementara
 * tabel di halaman yang sama menulis 45,5% (aturan 49: grafik ≠ tabel = kesalahan terburuk).
 * Sisa di luar daftar digabung ke irisan "Lainnya".
 */
export function lengkapiSampaiTotal(
  irisan: Array<{ nama: string; nilai: number }>,
  daftarAsli: Array<{ nilai: number }>,
  total: number
): Array<{ nama: string; nilai: number }> {
  const tercantum = daftarAsli.reduce((n, b) => n + b.nilai, 0)
  const sisa = total - tercantum
  // Toleransi pembulatan: selisih < 0,1% dari total bukan sisa sungguhan.
  if (!(total > 0) || sisa <= total * 0.001) return irisan
  const hasil = irisan.map((b) => ({ ...b }))
  const akhir = hasil[hasil.length - 1]
  if (akhir && akhir.nama.startsWith('Lainnya')) {
    akhir.nilai += sisa
    akhir.nama = 'Lainnya'
  } else hasil.push({ nama: 'Lainnya', nilai: sisa })
  return hasil
}

/**
 * Menyusun grafik untuk sebuah laporan penjualan.
 *
 * Mengembalikan daftar kosong bila datanya memang tidak cukup — itu bukan
 * kegagalan, dan pemanggil tidak boleh memperlakukannya sebagai kegagalan.
 */
export function grafikLaporan(d: DataLaporan): GrafikLaporan[] {
  const hasil: GrafikLaporan[] = []

  // 1. Periode ini vs pembanding — pertanyaan pertama tiap manajemen.
  const nettKini = bersih(d.kini?.nett)
  const nettLalu = bersih(d.lalu?.nett)
  if (nettKini > 0 || nettLalu > 0) {
    hasil.push({
      kunci: 'perbandingan',
      spek: {
        jenis: 'batang',
        judul: `Nett ${d.periodeLabel} vs ${d.pembandingLabel}`,
        label: [d.pembandingLabel, d.periodeLabel],
        seri: [{ nama: 'Nett', nilai: [nettLalu, nettKini] }],
        satuan: 'Rp',
        tinggi: 380
      }
    })
  }

  // 2. Kontribusi per sumber (ERP/kanal).
  const daftarSumber = (d.perSource ?? []).map((b) => ({ nama: b.kategori, nilai: bersih(b.nett) }))
  const sumber = lengkapiSampaiTotal(ringkasEkor(daftarSumber), daftarSumber, nettKini).filter((b) => b.nilai > 0)
  if (sumber.length >= MIN_BATANG) {
    hasil.push({
      kunci: 'kontribusi',
      spek: {
        jenis: 'pai',
        judul: `Kontribusi per sumber — ${d.periodeLabel}`,
        label: sumber.map((b) => b.nama),
        seri: [{ nama: 'Nett', nilai: sumber.map((b) => b.nilai) }],
        tinggi: 380
      }
    })
  }

  // 3. Pemeriksaan terbesar.
  const item = ringkasEkor(
    (d.topItem ?? []).map((b) => ({ nama: b.kategori, nilai: bersih(b.nett) })),
    8
  ).filter((b) => b.nilai > 0)
  if (item.length >= MIN_BATANG) {
    hasil.push({
      kunci: 'topItem',
      spek: {
        jenis: 'batang',
        judul: `Pemeriksaan terbesar — ${d.periodeLabel}`,
        label: item.map((b) => b.nama),
        seri: [{ nama: 'Nett', nilai: item.map((b) => b.nilai) }],
        satuan: 'Rp'
      }
    })
  }

  // 4. Pelanggan terbesar.
  const pelanggan = ringkasEkor(
    (d.topPelanggan ?? []).map((b) => ({ nama: b.kategori, nilai: bersih(b.nett) })),
    8
  ).filter((b) => b.nilai > 0)
  if (pelanggan.length >= MIN_BATANG) {
    hasil.push({
      kunci: 'topPelanggan',
      spek: {
        jenis: 'batang',
        judul: `Pelanggan terbesar — ${d.periodeLabel}`,
        label: pelanggan.map((b) => b.nama),
        seri: [{ nama: 'Nett', nilai: pelanggan.map((b) => b.nilai) }],
        satuan: 'Rp'
      }
    })
  }

  // 5. Sebaran wilayah.
  const daftarWilayah = (d.perProvinsi ?? []).map((b) => ({ nama: b.kategori, nilai: bersih(b.nett) }))
  const wilayah = lengkapiSampaiTotal(ringkasEkor(daftarWilayah), daftarWilayah, nettKini).filter((b) => b.nilai > 0)
  if (wilayah.length >= MIN_BATANG) {
    hasil.push({
      kunci: 'wilayah',
      spek: {
        jenis: 'pai',
        judul: `Sebaran wilayah — ${d.periodeLabel}`,
        label: wilayah.map((b) => b.nama),
        seri: [{ nama: 'Nett', nilai: wilayah.map((b) => b.nilai) }],
        tinggi: 380
      }
    })
  }

  return hasil
}

/**
 * Kalimat pertanggungjawaban grafik — TIDAK PERNAH kosong.
 *
 * ⚠️ Grafik yang GAGAL dirender wajib disebut. Dokumen yang kehilangan
 * grafiknya tanpa keterangan terlihat persis seperti dokumen yang memang tidak
 * punya grafik, dan tidak ada yang bisa tahu ada yang hilang — pola kegagalan
 * yang sama dengan PDF 22,8 MB yang dilewati indexer diam-diam (19 Agu 2026).
 */
export function catatanGrafik(diminta: number, jadi: number): string {
  if (diminta === 0) {
    return 'Tidak ada grafik yang dibuat karena datanya belum cukup (butuh minimal dua kategori). Ini bukan kegagalan — sebutkan apa adanya bila user bertanya.'
  }
  if (jadi === diminta) {
    return `${jadi} grafik dibuat dari angka yang sama persis dengan tabel di laporan ini.`
  }
  if (jadi === 0) {
    return `⚠️ ${diminta} grafik GAGAL dibuat dan dokumen ini terbit tanpa grafik sama sekali. Sebutkan itu ke user — jangan biarkan ia mengira laporannya memang tidak bergrafik.`
  }
  return `⚠️ Hanya ${jadi} dari ${diminta} grafik yang berhasil dibuat; ${diminta - jadi} sisanya gagal dirender dan TIDAK ada di dokumen. Sebutkan ke user.`
}
