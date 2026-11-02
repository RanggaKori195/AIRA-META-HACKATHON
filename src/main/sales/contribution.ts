// Persentase kontribusi untuk hasil sales_breakdown.
//
// Kenapa dihitung di sini dan bukan dibiarkan ke model: pertanyaan "10 pelanggan itu
// berapa persen dari total?" hampir selalu menyusul di rapat, dan aturan pertama mode
// sales melarang model menghitung sendiri di kepala. Selama tool tidak mengirim
// totalnya, satu-satunya cara model menjawab adalah mengarang — persis celah yang
// selama ini dijaga. Jadi totalnya ikut dikirim, sudah terhitung.
//
// Modul murni (tanpa I/O) supaya ter-cover unit test.

export interface BarisKontribusi {
  kategori?: unknown
  nett: number
  [key: string]: unknown
}

export interface HasilKontribusi<T> {
  baris: (T & { persen: number | null })[]
  /** Total seluruh periode, termasuk baris yang tidak masuk daftar. */
  totalNett: number
  /** Berapa persen dari total yang tercakup oleh baris yang ditampilkan. */
  persenTercakup: number | null
}

function bulat1(nilai: number): number {
  return Math.round(nilai * 10) / 10
}

/**
 * Menempelkan persen kontribusi tiap baris terhadap total periode.
 *
 * Total NOL menghasilkan `null`, bukan 0 — supaya AIRA menyebut "tidak terdefinisi"
 * dan tidak menulis "0%" yang terdengar seperti fakta. Total negatif (mungkin saja
 * bila retur melebihi penjualan) diperlakukan sama.
 */
export function withShare<T extends BarisKontribusi>(
  rows: T[],
  totalNett: number
): HasilKontribusi<T> {
  const valid = Number.isFinite(totalNett) && totalNett > 0
  const baris = rows.map((r) => ({
    ...r,
    persen: valid ? bulat1((Number(r.nett) / totalNett) * 100) : null
  }))
  const jumlahDitampilkan = rows.reduce((s, r) => s + Number(r.nett || 0), 0)
  return {
    baris,
    totalNett,
    persenTercakup: valid ? bulat1((jumlahDitampilkan / totalNett) * 100) : null
  }
}
