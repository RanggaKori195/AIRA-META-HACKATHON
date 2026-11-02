// Resolusi periode ke rentang tanggal. Murni (tanpa I/O) supaya ter-cover test
// dan supaya definisi "hari ini" tidak bergantung timezone mesin — semua memakai
// tanggal Asia/Jakarta yang di-pass dari pemanggil.

export const PERIOD_NAMES = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'last_7_days',
  'last_30_days',
  'custom'
] as const

export type PeriodName = (typeof PERIOD_NAMES)[number]

export interface DateRange {
  from: string
  to: string
  label: string
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Tanggal hari ini di zona Asia/Jakarta (bukan zona mesin). */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toISO(d)
}

/** Senin sebagai awal minggu (kebiasaan pelaporan di Indonesia). */
function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  return addDays(iso, -dow)
}

export function resolvePeriod(
  period: PeriodName,
  today: string,
  custom?: { from?: string; to?: string }
): DateRange {
  const [y, m] = today.split('-').map(Number)
  const lastDay = (year: number, month: number): string =>
    toISO(new Date(Date.UTC(year, month, 0)))

  switch (period) {
    case 'today':
      return { from: today, to: today, label: 'hari ini' }
    case 'yesterday': {
      const d = addDays(today, -1)
      return { from: d, to: d, label: 'kemarin' }
    }
    case 'this_week': {
      const s = startOfWeek(today)
      return { from: s, to: today, label: 'minggu ini' }
    }
    case 'last_week': {
      const s = addDays(startOfWeek(today), -7)
      return { from: s, to: addDays(s, 6), label: 'minggu lalu' }
    }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today, label: 'bulan ini' }
    case 'last_month': {
      const year = m === 1 ? y - 1 : y
      const month = m === 1 ? 12 : m - 1
      const mm = String(month).padStart(2, '0')
      return { from: `${year}-${mm}-01`, to: lastDay(year, month), label: 'bulan lalu' }
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today, label: `tahun ${y}` }
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `tahun ${y - 1}` }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today, label: '7 hari terakhir' }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today, label: '30 hari terakhir' }
    case 'custom': {
      const from = custom?.from
      const to = custom?.to
      if (!from || !to) throw new Error('periode custom butuh from dan to (YYYY-MM-DD)')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new Error('format tanggal harus YYYY-MM-DD')
      }
      if (from > to) throw new Error('tanggal "from" melewati "to"')
      return { from, to, label: `${from} s/d ${to}` }
    }
  }
}

export const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
] as const

const MONTH_ALIASES: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, nop: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12
}

/** Menerima angka 1–12 maupun nama bulan Indonesia/Inggris. */
export function parseMonth(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value
  }
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (!text) return null
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text)
    return n >= 1 && n <= 12 ? n : null
  }
  return MONTH_ALIASES[text] ?? null
}

function lastDayOfMonth(year: number, month: number): string {
  return toISO(new Date(Date.UTC(year, month, 0)))
}

/**
 * Rentang year-to-date: 1 Januari sampai akhir bulan `throughMonth` tahun `year`.
 *
 * Dipotong di hari ini bila bulannya belum lewat — YTD sampai Agustus 2026 pada
 * tanggal 18 berarti 1 Jan–18 Agu, bukan sampai 31 Agustus yang belum terjadi.
 * Tanpa ini, "YTD" untuk tahun berjalan akan tampak anjlok dibanding tahun lalu
 * hanya karena sisa bulannya masih kosong.
 */
export function ytdRange(year: number, throughMonth: number, today: string): DateRange {
  const akhirBulan = lastDayOfMonth(year, throughMonth)
  const to = akhirBulan > today ? today : akhirBulan
  const from = `${year}-01-01`
  if (from > to) {
    throw new Error(`YTD ${MONTH_NAMES[throughMonth - 1]} ${year} belum punya data (periode di masa depan)`)
  }
  const sampai = to === akhirBulan ? MONTH_NAMES[throughMonth - 1] : `${to.slice(8)} ${MONTH_NAMES[Number(to.slice(5, 7)) - 1]}`
  return { from, to, label: `YTD ${year} (Januari–${sampai})` }
}

/**
 * Rentang YTD tahun pembanding dengan HARI POTONG YANG SAMA.
 *
 * Ini inti keadilan perbandingan YTD: kalau tahun berjalan baru sampai 18 Agustus,
 * tahun pembanding juga harus 1 Jan–18 Agustus, bukan sampai akhir bulan. Tanggal
 * 29 Februari diturunkan ke 28 pada tahun non-kabisat.
 */
export function ytdCompareRange(current: DateRange, compareYear: number): DateRange {
  const bulan = Number(current.to.slice(5, 7))
  const hari = Number(current.to.slice(8, 10))
  const akhirBulanPembanding = lastDayOfMonth(compareYear, bulan)
  const hariMax = Number(akhirBulanPembanding.slice(8, 10))
  const hariDipakai = Math.min(hari, hariMax)
  const to = `${compareYear}-${String(bulan).padStart(2, '0')}-${String(hariDipakai).padStart(2, '0')}`
  const sampai =
    hariDipakai === hariMax
      ? MONTH_NAMES[bulan - 1]
      : `${String(hariDipakai).padStart(2, '0')} ${MONTH_NAMES[bulan - 1]}`
  return { from: `${compareYear}-01-01`, to, label: `YTD ${compareYear} (Januari–${sampai})` }
}

function lengthInDays(range: DateRange): number {
  return (
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000
    ) + 1
  )
}

/**
 * Menyamakan panjang periode pembanding bila periode utama masih BERJALAN.
 *
 * Tanpa ini, "bulan ini vs bulan lalu" membandingkan 18 hari melawan 31 hari dan
 * menghasilkan penurunan semu −66% — persis jenis angka yang terdengar meyakinkan
 * tapi salah. Yang dipakai manajemen adalah month-to-date lawan periode yang sama.
 * Periode yang sudah selesai (mis. "bulan lalu vs dua bulan lalu") tidak diutak-atik.
 */
export function alignBaseline(
  current: DateRange,
  baseline: DateRange,
  today: string
): { range: DateRange; disamakan: boolean } {
  if (current.to !== today) return { range: baseline, disamakan: false }
  const currentDays = lengthInDays(current)
  if (lengthInDays(baseline) <= currentDays) return { range: baseline, disamakan: false }
  const to = addDays(baseline.from, currentDays - 1)
  return {
    range: {
      from: baseline.from,
      to,
      label: `${baseline.label} (${currentDays} hari pertama, disamakan dengan periode berjalan)`
    },
    disamakan: true
  }
}

/** Periode pembanding sepadan (panjang sama, tepat sebelum periode acuan). */
export function previousRange(range: DateRange): DateRange {
  const days =
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000
    ) + 1
  const to = addDays(range.from, -1)
  const from = addDays(to, -(days - 1))
  return { from, to, label: `${days} hari sebelumnya (${from} s/d ${to})` }
}
