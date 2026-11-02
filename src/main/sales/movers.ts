// Perhitungan item yang sedang naik / turun antara dua periode.
// Murni (tanpa I/O) supaya ter-cover unit test: SQL hanya menyediakan angka
// mentah per item, seluruh logika delta & pemeringkatan dihitung di sini.

export interface ItemPeriodRow {
  kode: string
  nama: string | null
  nett: number
  nettSebelum: number
  transaksi: number
  transaksiSebelum: number
}

export type MoverStatus = 'baru' | 'berhenti' | 'naik' | 'turun' | 'tetap'

export interface MoverRow {
  item: string
  kodeItem: string
  nett: number
  nettSebelum: number
  selisih: number
  /** null bila periode pembanding nol — persentase tidak terdefinisi, jangan dikarang. */
  persen: number | null
  status: MoverStatus
  transaksi: number
  transaksiSebelum: number
}

function toRow(r: ItemPeriodRow): MoverRow {
  const nett = Number(r.nett) || 0
  const nettSebelum = Number(r.nettSebelum) || 0
  const selisih = nett - nettSebelum
  const status: MoverStatus =
    nettSebelum === 0 && nett > 0
      ? 'baru'
      : nett === 0 && nettSebelum > 0
        ? 'berhenti'
        : selisih > 0
          ? 'naik'
          : selisih < 0
            ? 'turun'
            : 'tetap'
  return {
    item: r.nama && r.nama.trim() ? r.nama.trim() : r.kode || '(tidak diisi)',
    kodeItem: r.kode,
    nett,
    nettSebelum,
    selisih,
    persen: nettSebelum === 0 ? null : Math.round((selisih / nettSebelum) * 1000) / 10,
    status,
    transaksi: Number(r.transaksi) || 0,
    transaksiSebelum: Number(r.transaksiSebelum) || 0
  }
}

/**
 * Beberapa kode item berbeda bisa memetakan ke nama master yang sama (terjadi nyata:
 * "KAL-Onco Breast 4" pada dua kode). Tanpa penanda, hasilnya terbaca seperti satu
 * item yang muncul dua kali dengan angka berbeda — jadi kode ditempelkan bila bentrok.
 */
function disambiguate(rows: MoverRow[]): void {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.item, (seen.get(r.item) ?? 0) + 1)
  for (const r of rows) {
    if ((seen.get(r.item) ?? 0) > 1 && r.kodeItem && r.item !== r.kodeItem) {
      r.item = `${r.item} [${r.kodeItem}]`
    }
  }
}

/**
 * Pemeringkatan memakai SELISIH NOMINAL, bukan persentase: kenaikan 900% dari
 * Rp 50 ribu tidak berguna bagi manajemen, sedangkan turun Rp 200 juta selalu penting.
 * Persentase tetap disertakan sebagai keterangan.
 */
export function computeMovers(
  rows: ItemPeriodRow[],
  limit: number
): { naik: MoverRow[]; turun: MoverRow[] } {
  const n = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20)
  const mapped = rows.map(toRow)
  const naik = mapped
    .filter((r) => r.selisih > 0)
    .sort((a, b) => b.selisih - a.selisih)
    .slice(0, n)
  const turun = mapped
    .filter((r) => r.selisih < 0)
    .sort((a, b) => a.selisih - b.selisih)
    .slice(0, n)
  disambiguate([...naik, ...turun])
  return { naik, turun }
}
