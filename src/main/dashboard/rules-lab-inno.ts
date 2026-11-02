// Aturan MURNI dashboard TAT Sample & Master Data (30 Sep 2026). Tanpa database —
// diuji di tests/dashboard-lab-inno.test.ts.

/** Tanggal ISO (YYYY-MM-DD) ± n hari, dihitung di UTC supaya tidak tergeser zona waktu. */
export function geserHari(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

function selisihHari(dari: string, sampai: string): number {
  const a = Date.UTC(+dari.slice(0, 4), +dari.slice(5, 7) - 1, +dari.slice(8, 10))
  const b = Date.UTC(+sampai.slice(0, 4), +sampai.slice(5, 7) - 1, +sampai.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

function akhirBulan(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const tanggalSah = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export interface Rentang {
  dari: string
  sampai: string
}

export interface PeriodeBanding {
  kini: Rentang
  lalu: Rentang
  /** Kalimat cara pembanding dipilih — WAJIB tampil di dashboard. */
  cara: string
}

/**
 * Periode pembanding untuk TAT.
 *
 * - Tanpa tanggal dari model → bulan ini s/d hari ini vs bulan lalu pada jumlah
 *   hari yang SAMA (pola `sales_compare`: bulan berjalan yang belum genap tidak
 *   boleh dibandingkan dengan bulan penuh).
 * - Rentang yang mulai tanggal 1 dan berakhir di bulan yang sama → bulan
 *   sebelumnya, tanggal yang sama (dipotong ke akhir bulan bila perlu).
 * - Rentang lain → jendela sepanjang itu TEPAT sebelum tanggal awalnya
 *   (minggu ini → minggu lalu).
 */
export function periodeBanding(dasar: { dari?: unknown; sampai?: unknown }, hariIni: string): PeriodeBanding {
  const dari = tanggalSah(dasar.dari) ? dasar.dari : null
  let sampai = tanggalSah(dasar.sampai) ? dasar.sampai : null
  if (!dari) {
    const kini = { dari: `${hariIni.slice(0, 8)}01`, sampai: hariIni }
    return { kini, lalu: bulanSebelumnya(kini), cara: 'This month to date, compared with last month up to the same date.' }
  }
  if (!sampai || sampai < dari) sampai = hariIni < dari ? dari : hariIni
  // ⚠️ Periode yang MELEWATI hari ini (model mengisi "minggu ini" = Senin–Minggu)
  // dipotong ke hari ini, dan pembandingnya dipotong ke jumlah hari yang SAMA.
  // Tanpa ini 3 hari dibandingkan dengan 7 hari penuh (tertangkap dari layar 30 Sep:
  // 28 vs 779 sampel selesai).
  const berjalan = sampai > hariIni && dari <= hariIni
  const panjangAsli = selisihHari(dari, sampai) + 1
  if (berjalan) sampai = hariIni
  const kini = { dari, sampai }
  if (dari.endsWith('-01') && dari.slice(0, 7) === sampai.slice(0, 7)) {
    return { kini, lalu: bulanSebelumnya(kini), cara: 'Compared with the previous month up to the same date.' }
  }
  const hariKini = selisihHari(dari, sampai) + 1
  if (berjalan) {
    const awalLalu = geserHari(dari, -panjangAsli)
    return {
      kini,
      lalu: { dari: awalLalu, sampai: geserHari(awalLalu, hariKini - 1) },
      cara: `Current period: the first ${hariKini} days, compared with the first ${hariKini} days of the previous period.`
    }
  }
  const lalu = { dari: geserHari(dari, -hariKini), sampai: geserHari(dari, -1) }
  return { kini, lalu, cara: `Compared with the ${hariKini} days immediately before.` }
}

function bulanSebelumnya(kini: Rentang): Rentang {
  const y = +kini.dari.slice(0, 4)
  const m = +kini.dari.slice(5, 7)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const hariAkhir = Math.min(+kini.sampai.slice(8, 10), akhirBulan(py, pm))
  const mm = String(pm).padStart(2, '0')
  return { dari: `${py}-${mm}-01`, sampai: `${py}-${mm}-${String(hariAkhir).padStart(2, '0')}` }
}

/** "0,6 hari lebih cepat" / "0,4 hari lebih lambat" / "sama" — TAT: turun = lebih baik. */
export function kalimatSelisihHari(kini: number | null, lalu: number | null): string {
  if (kini === null || lalu === null) return '—'
  const s = Math.round((kini - lalu) * 10) / 10
  if (s === 0) return 'same'
  const n = Math.abs(s).toLocaleString('en-US', { maximumFractionDigits: 1 })
  return s < 0 ? `${n} days faster` : `${n} days slower`
}

/** Persen perubahan satu desimal; null bila pembanding nol/kosong. */
export function persen(kini: number | null, lalu: number | null): number | null {
  if (kini === null || lalu === null || lalu === 0) return null
  return Math.round(((kini - lalu) / lalu) * 1000) / 10
}

export interface BarisTatBanding {
  kategori: string
  nKini: number
  medianKini: number | null
  medianLalu: number | null
}

/**
 * Menggabungkan TAT per kategori dua periode. Urutan mengikuti periode KINI;
 * kategori yang tidak ada di pembanding = `medianLalu: null` (bukan nol).
 */
export function gabungTat(
  kini: Array<{ kelompok: string; n: number; median: number | null }>,
  lalu: Array<{ kelompok: string; n: number; median: number | null }>
): BarisTatBanding[] {
  const peta = new Map(lalu.map((r) => [r.kelompok, r.median]))
  return kini.map((r) => ({
    kategori: r.kelompok,
    nKini: r.n,
    medianKini: r.median,
    medianLalu: peta.has(r.kelompok) ? (peta.get(r.kelompok) ?? null) : null
  }))
}

const days = (n: number): string => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`

/** Minimal sampel supaya satu kategori boleh disebut "paling lama" di insight. */
export const MIN_SAMPEL_INSIGHT = 5

export interface IntiInsightLab {
  medianKini: number | null
  medianLalu: number | null
  selesaiKini: number
  selesaiLalu: number
  orderKini: number
  orderLalu: number
  perKategori: BarisTatBanding[]
  backlogPerStatus: Array<{ sample_status: string; order: number; umur_tertua: number | null }>
  rnsKini: number | null
  rnsLalu: number | null
  rnsMenunggu: number | null
}

/** Insight dari KODE — hanya angka yang juga tampil di dashboard. */
export function insightLab(d: IntiInsightLab): string[] {
  const h: string[] = []
  if (d.medianKini !== null && d.medianLalu !== null) {
    const sel = kalimatSelisihHari(d.medianKini, d.medianLalu)
    h.push(
      sel === 'same'
        ? `Total median TAT is the same as the comparison period (${days(d.medianKini)}).`
        : `Total median TAT is ${days(d.medianKini)} — ${sel} than the comparison period (${days(d.medianLalu)}).`
    )
  }
  const pOrder = persen(d.orderKini, d.orderLalu)
  if (pOrder !== null) {
    h.push(`Incoming orders ${pOrder >= 0 ? 'rose' : 'fell'} ${Math.abs(pOrder).toLocaleString('en-US', { maximumFractionDigits: 1 })}% (${d.orderKini.toLocaleString('en-US')} vs ${d.orderLalu.toLocaleString('en-US')}).`)
  }
  const layak = d.perKategori.filter((k) => k.nKini >= MIN_SAMPEL_INSIGHT && k.medianKini !== null)
  const terlama = [...layak].sort((a, b) => (b.medianKini as number) - (a.medianKini as number))[0]
  if (terlama) h.push(`Category with the longest median TAT: ${terlama['kategori']} (${days(terlama.medianKini as number)}, ${terlama.nKini} samples).`)
  const melambat = layak
    .filter((k) => k.medianLalu !== null && (k.medianKini as number) > (k.medianLalu as number))
    .sort((a, b) => ((b.medianKini as number) - (b.medianLalu as number)) - ((a.medianKini as number) - (a.medianLalu as number)))[0]
  if (melambat) h.push('Largest slowdown: ' + melambat['kategori'] + ' — ' + kalimatSelisihHari(melambat.medianKini, melambat.medianLalu) + '.')
  const tertua = [...d.backlogPerStatus].filter((s) => s.umur_tertua !== null).sort((a, b) => (b.umur_tertua as number) - (a.umur_tertua as number))[0]
  if (tertua) h.push(`Current backlog: status "${tertua.sample_status}" has the oldest sample (${days(tertua.umur_tertua as number)}).`)
  if (d.rnsMenunggu !== null && d.rnsMenunggu > 0) h.push(`${d.rnsMenunggu.toLocaleString('en-US')} RNS in this period are still waiting for a replacement sample.`)
  return h
}

/** Saran lanjutan — HANYA yang bisa dijawab tool lab (aturan 17). */
export function saranLab(): string[] {
  return [
    'Which tests have the longest TAT this month?',
    'Which samples have been waiting more than 14 days for results?',
    'Which stage takes the longest: preparation or result generation?',
    'Which tests have the most RNS this month?'
  ]
}

// ------------------------------------------------------------- Master Data

export interface BarisHarga {
  kodeItem: string
  item: string
  kategori: string
  kodeKategori: string
  harga: number | null
}

export interface BandingHarga {
  sama: Array<{ item: string; kategori: string; a: number | null; b: number | null }>
  hanyaA: BarisHarga[]
  hanyaB: BarisHarga[]
  aLebihMurah: number
  bLebihMurah: number
  setara: number
}

/**
 * Membandingkan special price dua pelanggan per (item, kategori harga).
 * ⚠️ Kunci WAJIB memuat kategori: satu item bisa punya Special Price DAN BPJS
 * untuk pelanggan yang sama — membandingkan harga BPJS A dengan Special Price B
 * menghasilkan "lebih murah" yang palsu.
 */
export function bandingHarga(a: BarisHarga[], b: BarisHarga[]): BandingHarga {
  const kunci = (r: BarisHarga): string => `${r.kodeItem}|${r.kodeKategori}`
  const pb = new Map(b.map((r) => [kunci(r), r]))
  const ka = new Set(a.map(kunci))
  const sama: BandingHarga['sama'] = []
  let aLebihMurah = 0
  let bLebihMurah = 0
  let setara = 0
  for (const r of a) {
    const lawan = pb.get(kunci(r))
    if (!lawan) continue
    sama.push({ item: r.item, kategori: r.kategori, a: r.harga, b: lawan.harga })
    if (r.harga !== null && lawan.harga !== null) {
      if (r.harga < lawan.harga) aLebihMurah++
      else if (r.harga > lawan.harga) bLebihMurah++
      else setara++
    }
  }
  return {
    sama,
    hanyaA: a.filter((r) => !pb.has(kunci(r))),
    hanyaB: b.filter((r) => !ka.has(kunci(r))),
    aLebihMurah,
    bLebihMurah,
    setara
  }
}
