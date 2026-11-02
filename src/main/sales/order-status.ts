// Cek status SATU transaksi di SalesRepository berdasarkan Order ID (2 Okt 2026).
//
// Kebutuhan user: "transaksi Order ID ini sudah masuk SalesRepository belum?" — sudah
// diakui, sudah keluar hasil/invoice, sudah ter-bridging ke ERP.
//
// ⚠️ Ini penyimpangan SADAR dan SEMPIT dari aturan 3 (tool sales agregat murni), disetujui
// user. Batasnya ditegakkan di sini, bukan di prompt:
//   1. SQL-nya KONSTAN dan hanya menyentuh kolom di `KOLOM_DIBACA` — daftar-IZIN. Kolom
//      pasien (nama, tgl lahir, diagnosis, hasil), angka (gross/nett/harga/diskon),
//      pelanggan, dan nomor invoice TIDAK PERNAH dibaca, apalagi dikembalikan. Kolom baru
//      di tabel tidak otomatis ikut (pola `KOLOM_AMAN` milik lab, aturan 35).
//   2. Hasilnya AGREGAT per Order ID (jumlah & rentang tanggal), bukan baris mentah —
//      jenis pemeriksaannya pun tidak disebut.
//   3. Wajib SATU Order ID eksplisit; tidak ada pola/wildcard, jadi tidak bisa dipakai
//      menyapu daftar transaksi.
// Modul ini MURNI (tanpa I/O) supaya seluruh aturannya bisa diuji.

import { ERP_BRIDGING_START } from './erp'

/**
 * Bentuk Order ID yang ada di data (terukur 2 Okt 2026, 204 rb baris): angka 8–18 digit
 * ("2407281505"), berawalan huruf ("A2609D0008580", "AAIAAY47"), dan bertitik
 * ("251201014.05."). Karakter lain DITOLAK — termasuk `%`/`*`/spasi, supaya tidak ada
 * yang terbaca sebagai pola.
 */
const POLA = /^[A-Za-z0-9][A-Za-z0-9._\-/]{3,39}$/

/** Kolom yang dibaca query. Test memeriksa SQL tidak menyebut kolom lain dari tabel. */
export const KOLOM_DIBACA = [
  'order_id',
  'date_received',
  'date_result',
  'transfer_test_deleted_at',
  'transaction_transfer_deleted_at',
  'bridging_status_to',
  'bridging_status_result',
  'updated_at'
] as const

const DIAKUI = '(transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL)'

/**
 * Satu baris per Order ID yang cocok. `order_id = ANY($1)` memakai index
 * (`idx_salesrepo_cust_item_orderId`, terukur 16 ms). Baris yang transfernya
 * dibatalkan SENGAJA ikut dibaca — "dibatalkan" adalah jawaban, bukan "tidak ada".
 */
export const SQL_STATUS_ORDER = `
SELECT order_id,
       count(*) FILTER (WHERE ${DIAKUI})::int                                         AS item_diakui,
       count(*) FILTER (WHERE NOT ${DIAKUI})::int                                     AS item_batal,
       to_char(min(date_received) FILTER (WHERE ${DIAKUI}), 'YYYY-MM-DD')             AS order_dari,
       to_char(max(date_received) FILTER (WHERE ${DIAKUI}), 'YYYY-MM-DD')             AS order_sampai,
       count(*) FILTER (WHERE ${DIAKUI} AND date_result IS NOT NULL)::int             AS item_hasil,
       to_char(min(date_result) FILTER (WHERE ${DIAKUI}), 'YYYY-MM-DD')               AS hasil_dari,
       to_char(max(date_result) FILTER (WHERE ${DIAKUI}), 'YYYY-MM-DD')               AS hasil_sampai,
       count(*) FILTER (WHERE ${DIAKUI} AND bridging_status_to = 'SUCCESS')::int      AS order_erp_sukses,
       count(*) FILTER (WHERE ${DIAKUI} AND bridging_status_to = 'FAILED')::int       AS order_erp_gagal,
       count(*) FILTER (WHERE ${DIAKUI} AND bridging_status_result = 'SUCCESS')::int  AS invoice_erp_sukses,
       count(*) FILTER (WHERE ${DIAKUI} AND bridging_status_result = 'FAILED')::int   AS invoice_erp_gagal,
       to_char(max(updated_at), 'YYYY-MM-DD HH24:MI')                                 AS diperbarui
  FROM public."SalesRepository"
 WHERE order_id = ANY($1::text[])
 GROUP BY order_id
 LIMIT 5`

/** Tanggal order terbaru di tabel — penanda kesegaran (index `date_received`). */
export const SQL_DATA_TERBARU = `
SELECT to_char(max(date_received), 'YYYY-MM-DD') AS terbaru
  FROM public."SalesRepository"
 WHERE date_received <= current_date`

export interface RingkasOrderId {
  order_id: string
  item_diakui: number
  item_batal: number
  order_dari: string | null
  order_sampai: string | null
  item_hasil: number
  hasil_dari: string | null
  hasil_sampai: string | null
  order_erp_sukses: number
  order_erp_gagal: number
  invoice_erp_sukses: number
  invoice_erp_gagal: number
  diperbarui: string | null
}

/** Membersihkan Order ID dari kalimat user. `null` = bentuknya tidak sah. */
export function normalkanOrderId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const id = raw.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
  return POLA.test(id) ? id : null
}

/**
 * Variasi yang dicoba sekaligus: persis seperti diketik, huruf besar (data berhuruf
 * besar, orang sering mengetik kecil), dan dengan/tanpa titik di ujung (format
 * "251201014.05." — titik terakhir paling sering terlupa).
 */
export function kandidatOrderId(id: string): string[] {
  const dasar = [id, id.toUpperCase()]
  const out = new Set<string>()
  for (const d of dasar) {
    out.add(d)
    if (d.endsWith('.')) out.add(d.replace(/\.+$/, ''))
    else if (d.includes('.')) out.add(d + '.')
  }
  return [...out]
}

/** Tool yang menjawab per Order ID — keduanya tunduk pada `orderIdBukanDariUser`. */
export const TOOL_PER_ORDER = ['sales_order_status', 'lab_lacak'] as const

/**
 * Order ID WAJIB tertulis di pesan user SAAT INI. Mengembalikan pesan galat untuk
 * model, atau `null` bila sah.
 *
 * ⚠️ Ditemukan saat uji dari aplikasi 2 Okt 2026: user bertanya "transaksi pasien saya
 * tadi pagi sudah masuk belum?" TANPA Order ID; guard anti-halu mode data memaksa model
 * memanggil tool, dan model memakai ID dari giliran SEBELUMNYA. Jawabannya meminta ID
 * dengan benar, tapi kartu status transaksi ORANG LAIN ikut tampil di bawahnya — mudah
 * dibaca sebagai transaksi si penanya. Imbauan di deskripsi parameter tidak menahannya;
 * pemeriksaan ini yang menahan (pola aturan 30: model yang dipaksa mengarang argumen).
 * Konsekuensi yang disengaja: pertanyaan lanjutan tanpa menyebut ID lagi dijawab dengan
 * "Order ID yang mana?" — sedikit repot, tapi tidak pernah menampilkan transaksi yang salah.
 */
export function orderIdBukanDariUser(
  toolName: string,
  args: Record<string, unknown>,
  userText: string
): string | null {
  if (!(TOOL_PER_ORDER as readonly string[]).includes(toolName)) return null
  const id = typeof args.order_id === 'string' ? args.order_id.trim() : ''
  if (!id) return null // ditolak tool-nya sendiri dengan pesan yang lebih tepat
  const inti = (s: string): string => s.toLowerCase().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').replace(/\.+$/, '')
  if (inti(userText).includes(inti(id))) return null
  return (
    `Order ID "${id}" is NOT in the user's current message. Do NOT use an Order ID from a previous ` +
    'turn or guess one. Ask the user which Order ID they mean (you may offer the ID discussed earlier ' +
    'as an option), then wait for the answer.'
  )
}

const rentang = (a: string | null, b: string | null): string | null =>
  !a ? null : !b || a === b ? a : `${a} to ${b}`

/** Status bridging untuk satu sisi (order / invoice) dalam kalimat yang bisa dikutip. */
function statusErp(sukses: number, gagal: number, total: number, orderDari: string | null, sisi: string): string {
  if (total === 0) return '-'
  const belum = total - sukses - gagal
  if (sukses === total) return `already in the ERP (${sukses}/${total} tests)`
  const bagian: string[] = []
  if (sukses > 0) bagian.push(`${sukses} already in`)
  if (gagal > 0) bagian.push(gagal + ' FAILED bridging')
  if (belum > 0) bagian.push(belum + ' not processed yet')
  let s = `${bagian.join(', ')} (of ${total} tests)`
  if (belum > 0 && orderDari && orderDari < ERP_BRIDGING_START) {
    s += `; this order predates full ${sisi} bridging to the ERP (${ERP_BRIDGING_START}), so "not processed yet" is expected`
  }
  return s
}

const CATATAN_BATAS =
  'This tool DELIBERATELY only gives status (received/recognized/result/bridging). Patient data, test ' +
  'type, price/nett, customer, and invoice number are NOT available here — do not ' +
  'guess or mention them. The SAMPLE position in the lab (which stage it has reached) is not answered ' +
  'by this tool either; it is in the "Ask Sample TAT" menu for those with access.'

/**
 * Menyusun hasil tool. Kalimat ringkas DISUSUN KODE (`ringkasan`) supaya model tinggal
 * menyampaikan — bukan menyimpulkan sendiri dari angka mentah.
 */
export function susunStatusOrderId(
  diminta: string,
  ringkas: RingkasOrderId[],
  dataTerbaru: string | null
): Record<string, unknown> {
  const kesegaran = dataTerbaru
    ? `SalesRepository is not real-time: the newest order in the table is dated ${dataTerbaru}.`
    : 'SalesRepository is not real-time.'

  if (ringkas.length === 0) {
    return {
      ditemukan: false,
      order_id: diminta,
      ringkasan: `Order ID ${diminta} is NOT in SalesRepository yet.`,
      sebabMungkin: [
        'the transaction has not synced to SalesRepository yet (data is not real-time)',
        'the Order ID has a typo — check the digits/letters again',
        'the order has not been created in the lab system'
      ],
      catatan:
        'Report it as is: NOT found does not mean the data is lost. Do not guess the status, ' +
        'dates, or order contents. ' +
        CATATAN_BATAS,
      catatanKesegaran: kesegaran
    }
  }

  // Lebih dari satu Order ID cocok (mis. "X" dan "X." sama-sama ada) — sebutkan semuanya.
  const hasil = ringkas.map((r) => {
    const total = r.item_diakui
    let status: string
    if (total === 0) {
      status = `It IS in SalesRepository, but its transfer was CANCELLED (${r.item_batal} tests) — it is not counted as an order or as sales.`
    } else if (r.item_hasil === total) {
      status = `Received and ALREADY recognized as sales: results/invoice released for all ${total} tests.`
    } else if (r.item_hasil === 0) {
      status = `Received as an ORDER (${total} tests), but results/invoice are NOT released yet — not counted as sales yet.`
    } else {
      status = `Received as an order; results/invoice are released for only ${r.item_hasil} of ${total} tests.`
    }
    if (total > 0 && r.item_batal > 0) {
      status += ` In addition, ${r.item_batal} other tests in this Order ID had their transfer cancelled.`
    }
    // Kegagalan bridging wajib terbaca di kalimat ringkas — itu justru yang dicari orang yang
    // bertanya "sudah masuk ERP?" (live-check 2 Okt: dulu hanya ada di rincian).
    const gagalErp = r.order_erp_gagal + r.invoice_erp_gagal
    if (total > 0 && gagalErp > 0) {
      const sisi = [
        r.order_erp_gagal > 0 ? `${r.order_erp_gagal} order` : null,
        r.invoice_erp_gagal > 0 ? `${r.invoice_erp_gagal} invoice` : null
      ].filter(Boolean).join(' and ')
      status += ` Attention: ${sisi} FAILED bridging to the ERP.`
    }
    return {
      order_id: r.order_id,
      ...(r.order_id !== diminta ? { dicocokkanSebagai: `written as "${diminta}", recorded in the data as "${r.order_id}"` } : {}),
      status,
      diakui: total > 0,
      jumlahPemeriksaan: total,
      pemeriksaanDibatalkan: r.item_batal,
      tanggalOrderMasuk: rentang(r.order_dari, r.order_sampai),
      hasilInvoice: total === 0 ? '-' : `${r.item_hasil} of ${total} tests`,
      tanggalHasilInvoice: rentang(r.hasil_dari, r.hasil_sampai),
      orderDiERP: statusErp(r.order_erp_sukses, r.order_erp_gagal, total, r.order_dari, 'order'),
      // Sisi invoice dihitung dari pemeriksaan yang hasilnya SUDAH keluar — yang belum keluar
      // memang belum bisa di-bridging, dan menyebutnya "belum diproses" menyesatkan.
      invoiceDiERP:
        total > 0 && r.item_hasil === 0
          ? 'none yet — results/invoice not released'
          : statusErp(r.invoice_erp_sukses, r.invoice_erp_gagal, r.item_hasil, r.order_dari, 'invoice'),
      terakhirDiperbarui: r.diperbarui
    }
  })

  return {
    ditemukan: true,
    order_id: diminta,
    ringkasan: hasil.length === 1 ? hasil[0].status : `${hasil.length} Order IDs match — report each one.`,
    hasil,
    catatanAngka: '"tests" = test lines within one Order ID (one order can contain several).',
    catatan: CATATAN_BATAS,
    catatanKesegaran: kesegaran
  }
}
