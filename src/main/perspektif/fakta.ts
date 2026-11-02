import { salesQuery } from '../sales/db'
import { RECOGNIZED_CLAUSE, RECOGNIZED_NOTE } from '../sales/recognition'
import { faktaTat, type FaktaTat } from '../sales/tat'
import { previousRange, type DateRange } from '../sales/periods'

// Pengumpulan FAKTA untuk analisa lintas perspektif.
//
// ⚠️ Ini bagian yang paling menentukan mutu seluruh fitur, dan sengaja
// deterministik: SQL ditulis manusia, dijalankan lebih dulu, dan hasilnya
// yang SAMA PERSIS dikirim ke setiap perspektif. Model tidak pernah memilih
// query, tidak pernah menghitung, dan tidak punya jalan mengambil angka dari
// tempat lain.
//
// Dari situ dua pemeriksaan programatik jadi mungkin (lihat `rules.ts`):
// angka yang berbeda antar perspektif = salah baca, dan angka yang tidak ada
// di sini sama sekali = karangan.
//
// Basis SELALU `date_result` (invoice) untuk sisi komersial — dasar yang
// diakui pemilik data sebagai sales. Sisi operasional memakai
// `date_received`, karena yang diukur di sana adalah lama proses, bukan
// pengakuan penjualan.

const TABLE = 'public."SalesRepository"'

export interface FaktaKomersial {
  nett: number
  jumlahOrder: number
  jumlahInvoice: number
  nettPembanding: number
  jumlahOrderPembanding: number
  totalNettPeriode: number
  pelangganTeratas: Array<{ pelanggan: string; nett: number; order: number }>
}

export interface BahanAnalisa {
  item: { kode: string; nama: string }
  periode: DateRange
  pembanding: DateRange
  komersial: FaktaKomersial
  operasional: FaktaTat
  catatan: string[]
}

async function faktaKomersial(itemCode: string, range: DateRange): Promise<FaktaKomersial> {
  const lalu = previousRange(range)

  const [kini] = await salesQuery<{ nett: string | null; ord: string; inv: string }>(
    `SELECT sum(nett_sales) AS nett,
            count(DISTINCT order_id) AS ord,
            count(DISTINCT invoice_no) FILTER (WHERE invoice_no IS NOT NULL) AS inv
       FROM ${TABLE}
      WHERE item_code = $1
        AND date_result >= $2 AND date_result < ($3::date + 1)
        ${RECOGNIZED_CLAUSE}`,
    [itemCode, range.from, range.to]
  )

  const [banding] = await salesQuery<{ nett: string | null; ord: string }>(
    `SELECT sum(nett_sales) AS nett, count(DISTINCT order_id) AS ord
       FROM ${TABLE}
      WHERE item_code = $1
        AND date_result >= $2 AND date_result < ($3::date + 1)
        ${RECOGNIZED_CLAUSE}`,
    [itemCode, lalu.from, lalu.to]
  )

  // Total seluruh item pada periode yang sama — dipakai model untuk menilai
  // kontribusi. Dikirim sebagai ANGKA, bukan dibiarkan dihitung model.
  const [total] = await salesQuery<{ nett: string | null }>(
    `SELECT sum(nett_sales) AS nett
       FROM ${TABLE}
      WHERE date_result >= $1 AND date_result < ($2::date + 1)
        ${RECOGNIZED_CLAUSE}`,
    [range.from, range.to]
  )

  // ⚠️ Agregat dulu per customer_id, master menyusul lewat LATERAL … LIMIT 1.
  // JOIN langsung ke m_customer menggelembungkan angka (+12,1% terukur) karena
  // customer_code_lis TIDAK unik — jebakan yang sama sudah dua kali memakan
  // modul sales.
  const pelanggan = await salesQuery<{ pelanggan: string; nett: string; ord: string }>(
    `SELECT coalesce(nullif(trim(c.customer_name), ''), a.kode, '(tidak diisi)') AS pelanggan,
            a.nett, a.ord
       FROM (
         SELECT customer_id AS kode,
                sum(nett_sales) AS nett,
                count(DISTINCT order_id) AS ord
           FROM ${TABLE}
          WHERE item_code = $1
            AND date_result >= $2 AND date_result < ($3::date + 1)
            ${RECOGNIZED_CLAUSE}
          GROUP BY 1
          ORDER BY 2 DESC NULLS LAST
          LIMIT 5
       ) a
       LEFT JOIN LATERAL (
         SELECT m.customer_name
           FROM public.m_customer m
          WHERE m.customer_code_lis = a.kode
          ORDER BY m.customer_name
          LIMIT 1
       ) c ON true
      ORDER BY a.nett DESC NULLS LAST`,
    [itemCode, range.from, range.to]
  )

  return {
    nett: Number(kini?.nett ?? 0),
    jumlahOrder: Number(kini?.ord ?? 0),
    jumlahInvoice: Number(kini?.inv ?? 0),
    nettPembanding: Number(banding?.nett ?? 0),
    jumlahOrderPembanding: Number(banding?.ord ?? 0),
    totalNettPeriode: Number(total?.nett ?? 0),
    pelangganTeratas: pelanggan.map((p) => ({
      pelanggan: p.pelanggan,
      nett: Number(p.nett ?? 0),
      order: Number(p.ord ?? 0)
    }))
  }
}

export async function kumpulkanFakta(
  item: { kode: string; nama: string },
  range: DateRange
): Promise<BahanAnalisa> {
  // BERURUTAN, bukan Promise.all. Membuka beberapa permintaan serentak ke pool
  // yang sama sudah pernah jadi akar tiga kejadian berbeda di project ini
  // (HANDOFF §7) — pool sales sengaja `max: 1`, jadi paralel di sini hanya
  // menambah risiko tanpa menambah kecepatan.
  const komersial = await faktaKomersial(item.kode, range)
  const operasional = await faktaTat(item.kode, range)

  const catatan: string[] = [RECOGNIZED_NOTE]
  if (komersial.nett === 0 && komersial.jumlahOrder === 0) {
    catatan.push(
      `Item ini TIDAK punya transaksi yang diakui pada ${range.label}. Semua angka komersial nol ` +
        'apa adanya — bukan data yang hilang.'
    )
  }
  if (operasional.barisSelesai === 0) {
    catatan.push(
      'Tidak ada pemeriksaan item ini yang selesai (punya tanggal hasil) di periode ini, jadi TAT ' +
        'tidak bisa dihitung dan dikirim sebagai null — bukan berarti TAT-nya nol.'
    )
  }

  return {
    item,
    periode: range,
    pembanding: previousRange(range),
    komersial,
    operasional,
    catatan
  }
}
