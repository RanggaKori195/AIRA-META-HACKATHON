import { salesQuery } from './db'
import { RECOGNIZED_CLAUSE } from './recognition'
import type { DateRange } from './periods'

// TAT (turn-around time) & backlog pemeriksaan.
//
// Dua angka yang selama ini ada datanya tapi tidak ada toolnya (HANDOFF §10
// no.5): sejak Juli 2026 tercatat 2.141 order tanpa `date_result` senilai
// Rp 3,76 M, dan TAT Agustus 2026 bermedian 2 hari dengan p90 5 hari.
//
// ⚠️ Setiap query di sini WAJIB memuat RECOGNIZED_CLAUSE — sama seperti
// seluruh tool sales. Tanpa itu, transfer yang dibatalkan ikut terhitung
// sebagai "backlog", dan penumpukan yang dilaporkan jadi lebih besar dari
// kenyataan. Ini bukan filter opsional (lihat `recognition.ts`).

const TABLE = 'public."SalesRepository"'
const ITEM_MASTER = 'public.m_item_repository'

export interface ItemDitemukan {
  kode: string
  nama: string
}

/**
 * Mencari kode item dari kata kunci nama, lewat MASTER — bukan dengan memindai
 * tabel transaksi.
 *
 * Mengembalikan DAFTAR kandidat, tidak pernah menebak satu. Nama pemeriksaan
 * di master banyak yang mirip, dan memilih sendiri berarti menganalisa item
 * yang salah tanpa ada yang tahu.
 */
export async function cariItem(keyword: string): Promise<ItemDitemukan[]> {
  const teks = keyword.trim()
  if (!teks) return []
  return salesQuery<ItemDitemukan>(
    `SELECT kode, nama FROM (
       SELECT DISTINCT ON (item_code_erp)
              item_code_erp AS kode,
              trim(item_name) AS nama
         FROM ${ITEM_MASTER}
        WHERE item_code_erp <> ''
          AND trim(item_name) <> ''
          AND (item_name ILIKE $1 OR item_code_erp = $2)
        ORDER BY item_code_erp, (status = '5') DESC, item_name
     ) x
     ORDER BY (kode = $2) DESC, length(nama), nama
     LIMIT 10`,
    [`%${teks}%`, teks]
  )
}

export interface FaktaTat {
  barisSelesai: number
  tatMedianHari: number | null
  tatP90Hari: number | null
  backlogOrder: number
  backlogNilai: number
  backlogTertua: string | null
}

/**
 * TAT & backlog untuk satu kode item pada satu rentang tanggal.
 *
 * TAT dihitung dari baris yang SUDAH keluar hasilnya (`date_result` terisi),
 * berbasis `date_received` — jadi ia mengukur lama proses, bukan lama
 * pengakuan sales. Backlog dihitung dari sisi sebaliknya: order yang masuk di
 * rentang itu tapi hasilnya belum keluar sama sekali.
 *
 * ⚠️ Keduanya sengaja memakai penyaringan tanggal pada `date_received`. Kalau
 * backlog disaring pada `date_result`, baris yang belum punya hasil justru
 * tidak akan pernah ikut — backlognya selalu nol dan terlihat seperti kabar
 * baik.
 */
export async function faktaTat(itemCode: string, range: DateRange): Promise<FaktaTat> {
  const [tat] = await salesQuery<{
    baris: string
    median: string | null
    p90: string | null
  }>(
    `SELECT count(*) AS baris,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (date_result::date - date_received::date)) AS median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY (date_result::date - date_received::date)) AS p90
       FROM ${TABLE}
      WHERE item_code = $1
        AND date_received >= $2 AND date_received < ($3::date + 1)
        AND date_result IS NOT NULL
        AND date_result >= date_received
        ${RECOGNIZED_CLAUSE}`,
    [itemCode, range.from, range.to]
  )

  const [backlog] = await salesQuery<{
    jumlah: string
    nilai: string | null
    tertua: string | null
  }>(
    `SELECT count(DISTINCT order_id) AS jumlah,
            sum(nett_sales) AS nilai,
            min(date_received)::date::text AS tertua
       FROM ${TABLE}
      WHERE item_code = $1
        AND date_received >= $2 AND date_received < ($3::date + 1)
        AND date_result IS NULL
        ${RECOGNIZED_CLAUSE}`,
    [itemCode, range.from, range.to]
  )

  return {
    barisSelesai: Number(tat?.baris ?? 0),
    tatMedianHari: tat?.median === null || tat?.median === undefined ? null : Number(tat.median),
    tatP90Hari: tat?.p90 === null || tat?.p90 === undefined ? null : Number(tat.p90),
    backlogOrder: Number(backlog?.jumlah ?? 0),
    backlogNilai: Number(backlog?.nilai ?? 0),
    backlogTertua: backlog?.tertua ?? null
  }
}
