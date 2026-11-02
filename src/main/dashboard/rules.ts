// Aturan murni dashboard jawaban (29 Sep 2026). Tidak menyentuh database —
// diuji langsung di tests/dashboard.test.ts.

import type { BarisBanding, DashboardSales } from '../../shared/dashboard'

/**
 * Apakah pertanyaan ini layak dijawab dengan dashboard perbandingan.
 *
 * Keputusan user 29 Sep: dashboard muncul OTOMATIS untuk pertanyaan berbentuk
 * perbandingan/ringkasan. Sengaja SEMPIT — pertanyaan lookup ("berapa sales di
 * Jawa Barat") atau daftar ("pelanggan baru siapa saja") tetap dijawab teks;
 * dashboard lima panel untuk pertanyaan satu angka hanya membebani database
 * produksi dan layar.
 *
 * ⚠️ Akhiran bahasa Indonesia mematikan `\b` di ujung kata (aturan 26) —
 * "dibandingkan", "perbandingannya" wajib tetap cocok.
 */
export function perluDashboardSales(teks: string): boolean {
  const k = teks.toLowerCase()
  // Permintaan dokumen punya jalurnya sendiri (laporan Word/PDF/Excel).
  if (/\b(laporan|report|excel|pdf|word|docx|xlsx|presentasi|ppt)/.test(k)) return false
  return (
    /\b(banding|dibanding|perbandingan|membandingkan|bandingkan|versus)/.test(k) ||
    /\bvs\.?\b/.test(k) ||
    /\b(ringkasan|rangkuman|overview|dashboard|performa|kinerja)/.test(k) ||
    /\b(naik|turun|pertumbuhan|growth|tumbuh)\b.*\b(bulan|minggu|tahun|periode|kemarin)/.test(k)
  )
}

/** Persen perubahan satu desimal; null bila pembandingnya nol/kosong. */
export function persenUbah(kini: number, lalu: number | null): number | null {
  if (lalu === null || lalu === 0) return null
  return Math.round(((kini - lalu) / lalu) * 1000) / 10
}

/**
 * Menggabungkan daftar periode kini dan pembanding menurut nama. Urutan
 * mengikuti periode KINI (terbesar dulu); nama yang tidak ada di daftar
 * pembanding diberi `lalu: null` — tidak dianggap nol, karena daftar pembanding
 * juga dibatasi (baris ke-51 bukan berarti nol).
 */
export function gabungBanding(
  kini: Array<{ nama: string; nett: number }>,
  lalu: Array<{ nama: string; nett: number }>
): BarisBanding[] {
  const peta = new Map(lalu.map((r) => [r.nama, r.nett]))
  return kini.map((r) => {
    const l = peta.has(r.nama) ? (peta.get(r.nama) as number) : null
    return { nama: r.nama, kini: r.nett, lalu: l, persen: persenUbah(r.nett, l) }
  })
}

/** Rentang "YYYY-MM-DD s/d YYYY-MM-DD" -> {from,to}; null bila bentuknya lain. */
export function bacaRentang(rentang: string): { from: string; to: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}) s\/d (\d{4}-\d{2}-\d{2})$/.exec(rentang.trim())
  return m ? { from: m[1], to: m[2] } : null
}

/** Awal bulan, `n` bulan sebelum bulan tanggal `iso` (n=5 -> 6 bulan termasuk bulan itu). */
export function awalBulanMundur(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Apakah `to` jatuh sebelum hari terakhir bulannya (bulan berjalan = sebagian). */
export function bulanBelumGenap(to: string): boolean {
  const [y, m, d] = to.split('-').map(Number)
  return d < new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const rupiah = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`
  if (abs >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}

const persenTeks = (p: number): string => `${p.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`

/**
 * Kalimat insight — disusun dari angka yang SAMA dengan kartu/tabel/grafik
 * (keputusan user 29 Sep: insight dari kode, bukan model). Kaku, tapi tidak
 * mungkin menyebut angka yang tidak ada di layar.
 */
export function susunInsight(d: Omit<DashboardSales, 'insight' | 'saran'>): string[] {
  const hasil: string[] = []
  const { kpi } = d
  if (kpi.persen !== null) {
    const arah = kpi.selisih > 0 ? 'naik' : kpi.selisih < 0 ? 'turun' : 'sama'
    hasil.push(
      arah === 'sama'
        ? `Sales ${d.labelKini} sama dengan ${d.labelLalu} (${rupiah(kpi.nettKini)}).`
        : `Sales ${d.labelKini} ${arah} ${persenTeks(Math.abs(kpi.persen))} dibanding ${d.labelLalu} (${rupiah(kpi.nettKini)} vs ${rupiah(kpi.nettLalu)}).`
    )
  }
  const totalKategori = d.kategori.reduce((s, r) => s + r.kini, 0)
  const kTop = d.kategori[0]
  if (kTop && kpi.nettKini > 0) {
    hasil.push(
      `Kategori layanan terbesar: ${kTop.nama} — ${persenTeks((kTop.kini / kpi.nettKini) * 100)} dari total nett.`
    )
  } else if (kTop && totalKategori > 0) {
    hasil.push(`Kategori layanan terbesar: ${kTop.nama}.`)
  }
  const wTop = d.wilayah.find((w) => !w.nama.startsWith('('))
  if (wTop && kpi.nettKini > 0) {
    hasil.push(`Wilayah penyumbang terbesar: ${wTop.nama} (${persenTeks((wTop.kini / kpi.nettKini) * 100)}).`)
  }
  const pTop = d.pelanggan[0]
  if (pTop) hasil.push(`Pelanggan dengan nilai tertinggi: ${pTop.nama} (${rupiah(pTop.kini)}).`)
  const naik = d.pelanggan
    .filter((p) => p.persen !== null && p.persen > 0)
    .sort((a, b) => (b.persen as number) - (a.persen as number))[0]
  if (naik && naik !== pTop) {
    hasil.push(`Kenaikan terbesar di 10 pelanggan teratas: ${naik.nama} (+${persenTeks(naik.persen as number)}).`)
  }
  const genap = d.tren.filter((t) => !t.sebagian)
  if (genap.length >= 3) {
    const puncak = genap.reduce((a, b) => (b.nett > a.nett ? b : a))
    hasil.push(`Bulan penuh tertinggi dalam ${d.tren.length} bulan terakhir: ${puncak.bulan} (${rupiah(puncak.nett)}).`)
  }
  return hasil
}

/**
 * Saran pertanyaan lanjutan — HANYA yang bisa dijawab tool sales (aturan 17:
 * contoh yang tidak bisa dijawab membuat model mengarang).
 */
export function saranLanjutanSales(labelKini: string): string[] {
  return [
    `Pemeriksaan apa yang paling laris ${labelKini}?`,
    `Provinsi mana yang terbesar ${labelKini}?`,
    'Pelanggan mana yang ordernya turun drastis?',
    'Item apa yang trennya menurun?',
    'Proyeksi tutup bulan ini berapa?',
    `Buatkan laporan penjualan ${labelKini} versi Excel`
  ]
}
