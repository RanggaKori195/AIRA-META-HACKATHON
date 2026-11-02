// Best Estimate (BE) penjualan satu tahun penuh — MURNI (30 Sep 2026, pertanyaan manager).
//
// BE = aktual Jan..bulan lalu (bulan penuh) + PROYEKSI bulan berjalan (kurva penumpukan,
//      `sales_projection`) + RAMALAN sisa bulan (regresi 12 bulan, `sales_forecast`).
// Dijumlah KODE, bukan model — angka yang dibawa ke rapat manajemen tidak boleh hasil
// penjumlahan di kepala model (aturan "angka yang salah lebih berbahaya").
//
// ⚠️ Batas horizon `MAKS_HORIZON` (3 bulan, aturan 22) TIDAK dilanggar demi satu angka:
// bila sisa tahun > 3 bulan, BE tidak dihitung dan alasannya disebut. Menolak lebih jujur
// daripada mengekstrapolasi pertumbuhan yang belum tentu punya kapasitas lab-nya.
// ⚠️ "BE" di sini = BEST ESTIMATE (dikonfirmasi user 30 Sep), BUKAN budget/target —
// angka target tidak ada di database mana pun, jadi tool ini tidak pernah menyebut target.

import { MAKS_HORIZON, bulanBerikut, ramal, type Ramalan, type Titik } from './forecast'

export interface MasukanBE {
  tahun: number
  /** YYYY-MM-DD, zona Jakarta. */
  hariIni: string
  /** Riwayat bulanan PENUH (semua bulan < bulan berjalan), urut naik. */
  riwayat: Titik[]
  /** Proyeksi tutup bulan berjalan dari `sales_projection`; null bila tidak tersedia. */
  proyeksiBulanIni: number | null
  dasarProyeksi: string | null
  /** MAPE backtest (persen); null = belum bisa diukur. */
  mape: number | null
}

export interface HasilBE {
  tahun: number
  jenis: 'realisasi' | 'best_estimate' | 'tidak_lengkap'
  aktual: Titik[]
  totalAktual: number
  /** Bulan tahun ini yang tidak ada di riwayat (data kosong) — disebut, bukan dianggap nol diam-diam. */
  bulanKosong: string[]
  proyeksi: { bulan: string; nett: number; dasar: string | null } | null
  ramalan: Ramalan[]
  /** Bulan yang tidak diramal karena melewati batas horizon. */
  takDiramal: string[]
  be: number | null
  bawah: number | null
  atas: number | null
  fullYearLalu: number | null
  pertumbuhanPersen: number | null
  akurasiHistorisPersen: number | null
}

const bulanTahun = (tahun: number): string[] => Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`)

export class BEError extends Error {}

export function susunBE(m: MasukanBE): HasilBE {
  const tahunIni = Number(m.hariIni.slice(0, 4))
  if (m.tahun > tahunIni) throw new BEError(`tahun ${m.tahun} belum berjalan — BE hanya untuk tahun berjalan atau tahun yang sudah lewat.`)
  const bulanBerjalan = m.hariIni.slice(0, 7)
  const semua = bulanTahun(m.tahun)
  const peta = new Map(m.riwayat.map((t) => [t.bulan, t.nett]))
  const akhirAktual = m.tahun < tahunIni ? `${m.tahun}-12` : bulanBerikut(bulanBerjalan, -1)
  const bulanAktual = semua.filter((b) => b <= akhirAktual)
  const aktual = bulanAktual.filter((b) => peta.has(b)).map((b) => ({ bulan: b, nett: peta.get(b) as number }))
  const bulanKosong = bulanAktual.filter((b) => !peta.has(b))
  const totalAktual = aktual.reduce((s, t) => s + t.nett, 0)

  const lalu = bulanTahun(m.tahun - 1)
  const fullYearLalu = lalu.every((b) => peta.has(b)) ? lalu.reduce((s, b) => s + (peta.get(b) as number), 0) : null
  const tumbuh = (v: number | null): number | null =>
    v === null || fullYearLalu === null || fullYearLalu === 0 ? null : Math.round(((v - fullYearLalu) / fullYearLalu) * 1000) / 10
  const akurasi = m.mape === null ? null : Math.round(m.mape * 10) / 10

  const dasar = { tahun: m.tahun, aktual, totalAktual, bulanKosong, fullYearLalu, akurasiHistorisPersen: akurasi }

  // Tahun yang sudah lewat: realisasi, bukan perkiraan.
  if (m.tahun < tahunIni) {
    return { ...dasar, jenis: 'realisasi', proyeksi: null, ramalan: [], takDiramal: [], be: totalAktual, bawah: null, atas: null, pertumbuhanPersen: tumbuh(totalAktual) }
  }

  const sisa = semua.filter((b) => b > bulanBerjalan)
  const proyeksi = m.proyeksiBulanIni === null ? null : { bulan: bulanBerjalan, nett: m.proyeksiBulanIni, dasar: m.dasarProyeksi }
  if (sisa.length > MAKS_HORIZON || proyeksi === null) {
    return {
      ...dasar,
      jenis: 'tidak_lengkap',
      proyeksi,
      ramalan: [],
      takDiramal: sisa,
      be: null,
      bawah: null,
      atas: null,
      pertumbuhanPersen: null
    }
  }
  const ramalan = sisa.length ? ramal(m.riwayat, sisa.length, m.mape, sisa[0]) : []
  const be = totalAktual + proyeksi.nett + ramalan.reduce((s, r) => s + r.nett, 0)
  const adaRentang = ramalan.every((r) => r.bawah !== null && r.atas !== null)
  // Rentang hanya dari RAMALAN — aktual sudah pasti, proyeksi bulan berjalan tidak punya rentang.
  const bawah = adaRentang ? totalAktual + proyeksi.nett + ramalan.reduce((s, r) => s + (r.bawah as number), 0) : null
  const atas = adaRentang ? totalAktual + proyeksi.nett + ramalan.reduce((s, r) => s + (r.atas as number), 0) : null
  return { ...dasar, jenis: 'best_estimate', proyeksi, ramalan, takDiramal: [], be, bawah, atas, pertumbuhanPersen: tumbuh(be) }
}

/** Kalimat untuk MODEL — menyebut apa yang boleh dan tidak boleh dikatakan. */
export function catatanBE(h: HasilBE): string {
  const kosong = h.bulanKosong.length ? ` Bulan tanpa data di riwayat: ${h.bulanKosong.join(', ')} — sebutkan ke user.` : ''
  if (h.jenis === 'realisasi') {
    return `Tahun ${h.tahun} sudah lewat: angka ini REALISASI penuh, bukan perkiraan.${kosong}`
  }
  if (h.jenis === 'tidak_lengkap') {
    return (
      `Best Estimate ${h.tahun} TIDAK dihitung: ` +
      (h.proyeksi === null
        ? 'proyeksi bulan berjalan tidak tersedia. '
        : `sisa ${h.takDiramal.length} bulan (${h.takDiramal[0]}–${h.takDiramal[h.takDiramal.length - 1]}) melewati batas ramalan ${MAKS_HORIZON} bulan — di luar itu tren linier tidak dapat dipercaya. `) +
      'Sajikan aktual yang sudah ada dan proyeksi bulan berjalan saja, dan katakan terus terang kenapa angka setahun penuh belum bisa diberikan. JANGAN menaksir sendiri.' +
      kosong
    )
  }
  return (
    `Best Estimate = aktual ${h.aktual.length} bulan + proyeksi bulan berjalan (${h.proyeksi?.bulan}, perkiraan) + ramalan ${h.ramalan.length} bulan sisa. ` +
    'Sudah DIJUMLAH tool (termasuk totalRamalanSisaBulan) — jangan menjumlah atau mengubah sendiri. WAJIB sebutkan: (a) ini PERKIRAAN, (b) rentangnya (bawah–atas), ' +
    `(c) akurasi historis ramalan (${h.akurasiHistorisPersen ?? '—'}% MAPE), (d) bagian yang aktual vs perkiraan. ` +
    'BE = Best Estimate dari data, BUKAN target/budget — angka target tidak ada di database, jangan menyebut pencapaian target.' +
    kosong
  )
}
