import type { KartuVisual } from './visual'

// Bentuk data DASHBOARD jawaban (29 Sep 2026, permintaan user: jawaban data
// tampil sebagai kartu angka + grafik + tabel, seperti mockup "Ringkasan
// Perbandingan Sales").
//
// ⚠️ Semua angka di sini berasal dari HASIL TOOL, disusun kode di main process
// (`main/dashboard/*`). Model tidak menulis satu pun angka dashboard — grafik
// yang berbeda dari tabel di jawaban yang sama adalah kesalahan terburuk sebuah
// laporan (aturan 49), dan angka yang ditulis ulang model bisa meleset.

/** Satu baris perbandingan dua periode (kategori / pelanggan / wilayah). */
export interface BarisBanding {
  nama: string
  kini: number
  /** null = tidak ada di daftar periode pembanding (mis. pelanggan baru). */
  lalu: number | null
  /** Persen perubahan, satu desimal; null bila `lalu` kosong/nol. */
  persen: number | null
}

export interface DashboardSales {
  jenis: 'sales'
  /** Versi bentuk data — dashboard lama tetap bisa dibaca bila bentuknya berubah. */
  versi: 1
  dibuat: number
  basis: string
  labelKini: string
  labelLalu: string
  rentangKini: string
  rentangLalu: string
  /** Keterangan bila pembanding dipotong agar setara (bulan berjalan). */
  catatanPeriode: string | null
  /** Filter yang berlaku (wilayah/kategori), sudah berupa kalimat. */
  filter: string[]
  kpi: {
    nettKini: number
    nettLalu: number
    selisih: number
    persen: number | null
    orderKini: number | null
    orderLalu: number | null
    pelangganKini: number | null
  }
  /** Deret bulanan (sampai 6 bulan). `sebagian` = bulan yang belum genap. */
  tren: Array<{ bulan: string; nett: number; sebagian: boolean }>
  kategori: BarisBanding[]
  pelanggan: BarisBanding[]
  wilayah: BarisBanding[]
  /** Kalimat insight — disusun KODE dari angka di atas, bukan model. */
  insight: string[]
  saran: string[]
  /** Panel yang gagal diambil (disebut, bukan disembunyikan diam-diam). */
  gagal: string[]
}

/**
 * Dashboard TAT Sample & Master Data (30 Sep 2026). Digambar dengan bentuk KARTU
 * VISUAL yang sudah ada (kpi/batang/deret/tabel) — satu komponen untuk semua,
 * bukan komponen per menu.
 */
export interface DashboardUmum {
  jenis: 'lab' | 'inno'
  versi: 1
  dibuat: number
  kartu: KartuVisual
  insight: string[]
  saran: string[]
  gagal: string[]
  /** Nama sumber data untuk panel samping. */
  sumber: string
}

export type Dashboard = DashboardSales | DashboardUmum
