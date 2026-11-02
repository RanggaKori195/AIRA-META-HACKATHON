import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  KOLOM_DIBACA,
  SQL_DATA_TERBARU,
  SQL_STATUS_ORDER,
  orderIdBukanDariUser,
  kandidatOrderId,
  normalkanOrderId,
  susunStatusOrderId,
  type RingkasOrderId
} from '../src/main/sales/order-status'
import { groupOf } from '../src/main/agent/tool-groups'
import { visualDariHasil, TOOL_BERVISUAL } from '../src/main/visual/sales'

// `sales_order_status` (2 Okt 2026) — satu-satunya tool sales yang menjawab per order.
// Penyimpangan sadar dari aturan 3 (agregat murni), jadi batasnya dikunci di sini.

// Seluruh kolom public."SalesRepository" (dibaca dari information_schema 2 Okt 2026).
const SEMUA_KOLOM = (
  'id invoice_no date_received customer_id customer_name order_id item_code test gross_sales discount ' +
  'nett_sales month year source created_at updated_at patient_name clinician date_result dob email_sent ' +
  'gender is_rns is_slide_only pathologist patient_cost payment_method price_type qty voucher_cost ' +
  'voucher_no clin_diagnosis pa_diagnosis specimen_type result city transfer_id transfer_test_deleted_at ' +
  'transaction_transfer_deleted_at payer_name transaction_test_id date_validated bridging_status_to ' +
  'bridging_attempts_to bridging_error_to bridging_job_id_to bridging_started_at_to bridged_at_to ' +
  'bridging_unique_id orl_no_to orl_lineno_to bridging_status_result bridging_attempts_result ' +
  'bridging_error_result bridging_job_id_result bridging_started_at_result bridged_at_result orl_no_result ' +
  'orl_lineno_result bridging_batch_id_to top_days account_code_masterdata item_code_masterdata ' +
  'payer_code_masterdata payer_code payer_type unit_price approval_buddle_id voucher_input ' +
  'new_sample_received_date pharma_id result_id item_code_lis kd_cabang bridging_batch_id_result shipment_no'
).split(' ')

describe('sales_order_status: daftar-izin kolom', () => {
  const dipakai = (sql: string): string[] =>
    SEMUA_KOLOM.filter((k) => new RegExp(`(^|[^a-z_])${k}([^a-z_]|$)`).test(sql))

  test('SQL hanya menyebut kolom di KOLOM_DIBACA', () => {
    // Kalau seseorang kelak menambah "customer_name" atau "nett_sales" ke query "sekalian",
    // test ini merah — padahal hasil tool-nya masih terlihat wajar.
    const asing = dipakai(SQL_STATUS_ORDER).filter((k) => !(KOLOM_DIBACA as readonly string[]).includes(k))
    assert.deepEqual(asing, [])
    assert.deepEqual(dipakai(SQL_DATA_TERBARU), ['date_received'])
  })

  test('kolom pasien, angka, pelanggan, dan invoice tidak ada di daftar-izin', () => {
    for (const k of ['patient_name', 'dob', 'clin_diagnosis', 'pa_diagnosis', 'result', 'gender', 'nett_sales',
      'gross_sales', 'unit_price', 'discount', 'customer_name', 'customer_id', 'invoice_no', 'test', 'item_code',
      'clinician', 'pathologist', 'payer_name', 'bridging_error_to', 'bridging_error_result']) {
      assert.ok(!(KOLOM_DIBACA as readonly string[]).includes(k), k)
    }
  })

  test('ID masuk sebagai parameter, tidak pernah dirangkai ke SQL', () => {
    assert.match(SQL_STATUS_ORDER, /order_id = ANY\(\$1::text\[\]\)/)
    assert.doesNotMatch(SQL_STATUS_ORDER, /LIKE|ILIKE|~/)
  })

  test('baris DIBATALKAN ikut dibaca (dibatalkan adalah jawaban, bukan "tidak ada")', () => {
    // Kalau RECOGNIZED_CLAUSE dipasang di WHERE, order yang dibatalkan dilaporkan "belum masuk".
    assert.doesNotMatch(SQL_STATUS_ORDER.split('WHERE order_id')[1], /deleted_at IS NULL/)
    assert.match(SQL_STATUS_ORDER, /NOT \(transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL\)/)
  })

  test('tool masuk kelompok sales, bukan core (Task Baru tidak boleh menyentuh database)', () => {
    assert.equal(groupOf('sales_order_status'), 'sales')
  })
})

describe('sales_order_status: bentuk Order ID', () => {
  test('bentuk-bentuk yang ada di data diterima', () => {
    for (const id of ['2407281505', '251201014.05.', '0024080270001', 'AAIAAY47', 'A2609D0008580', '002409034141420001']) {
      assert.equal(normalkanOrderId(id), id, id)
    }
  })

  test('spasi & tanda kutip di tepi dibuang', () => {
    assert.equal(normalkanOrderId('  "2609301003" '), '2609301003')
    assert.equal(normalkanOrderId('`A2609D0008580`'), 'A2609D0008580')
  })

  test('pola, wildcard, daftar, dan teks bebas DITOLAK', () => {
    // Tidak boleh ada cara menyapu banyak transaksi sekaligus.
    for (const s of ['%', '26%', '2609*', '2609 3010', "1' OR '1'='1", '2609301003,2609301004', '', 'ab', null, 42]) {
      assert.equal(normalkanOrderId(s), null, String(s))
    }
  })

  test('variasi: huruf besar & titik di ujung', () => {
    assert.deepEqual(kandidatOrderId('a2609d0008580'), ['a2609d0008580', 'A2609D0008580'])
    assert.ok(kandidatOrderId('251201014.05').includes('251201014.05.'))
    assert.ok(kandidatOrderId('251201014.05.').includes('251201014.05'))
    assert.deepEqual(kandidatOrderId('2609301003'), ['2609301003'])
  })
})

describe('sales_order_status: kalimat status', () => {
  const baris = (p: Partial<RingkasOrderId> = {}): RingkasOrderId => ({
    order_id: '2609301003',
    item_diakui: 3,
    item_batal: 0,
    order_dari: '2026-09-30',
    order_sampai: '2026-09-30',
    item_hasil: 3,
    hasil_dari: '2026-10-01',
    hasil_sampai: '2026-10-01',
    order_erp_sukses: 3,
    order_erp_gagal: 0,
    invoice_erp_sukses: 3,
    invoice_erp_gagal: 0,
    diperbarui: '2026-10-01 10:00',
    ...p
  })
  const satu = (r: RingkasOrderId): Record<string, any> =>
    (susunStatusOrderId(r.order_id, [r], '2026-10-01').hasil as Record<string, any>[])[0]

  test('tidak ditemukan: sebab mungkin disebut, tidak ada status karangan', () => {
    const h = susunStatusOrderId('999', [], '2026-10-01')
    assert.equal(h.ditemukan, false)
    assert.match(String(h.ringkasan), /BELUM ADA di SalesRepository/)
    assert.ok((h.sebabMungkin as string[]).some((s) => /tersinkron/.test(s)))
    assert.match(String(h.catatanKesegaran), /2026-10-01/)
  })

  test('semua hasil keluar = sudah diakui sebagai sales', () => {
    const h = satu(baris())
    assert.match(h.status, /SUDAH diakui sebagai sales/)
    assert.match(h.orderDiERP, /sudah masuk ERP \(3\/3/)
    assert.equal(h.tanggalOrderMasuk, '2026-09-30')
  })

  test('belum ada hasil = order masuk, belum sales; sisi invoice tidak disebut "belum diproses"', () => {
    const h = satu(baris({ item_hasil: 0, hasil_dari: null, hasil_sampai: null, invoice_erp_sukses: 0 }))
    assert.match(h.status, /hasil\/invoice BELUM keluar/)
    assert.match(h.invoiceDiERP, /hasil\/invoice belum keluar/)
    assert.doesNotMatch(h.invoiceDiERP, /belum diproses/)
  })

  test('sebagian hasil keluar', () => {
    const h = satu(baris({ item_hasil: 1, invoice_erp_sukses: 1 }))
    assert.match(h.status, /1 dari 3 pemeriksaan/)
    assert.match(h.invoiceDiERP, /sudah masuk ERP \(1\/1/)
  })

  test('semua dibatalkan = ADA tapi tidak dihitung', () => {
    const h = satu(baris({ item_diakui: 0, item_batal: 2, item_hasil: 0 }))
    assert.match(h.status, /DIBATALKAN \(2 pemeriksaan\)/)
    assert.equal(h.diakui, false)
  })

  test('campuran: sebagian dibatalkan ikut disebut', () => {
    assert.match(satu(baris({ item_batal: 1 })).status, /1 pemeriksaan lain .* dibatalkan/)
  })

  test('bridging gagal disebut GAGAL, bukan "belum"', () => {
    const h = satu(baris({ order_erp_sukses: 2, order_erp_gagal: 1 }))
    assert.match(h.orderDiERP, /2 sudah masuk, 1 GAGAL di-bridging/)
    // ...dan ikut di kalimat ringkas, bukan hanya di rincian (temuan live-check 2 Okt).
    assert.match(h.status, /Perhatian: 1 order GAGAL di-bridging ke ERP/)
  })

  test('order sebelum bridging berjalan: "belum diproses" diberi konteks', () => {
    const h = satu(baris({ order_dari: '2025-08-01', order_sampai: '2025-08-01', order_erp_sukses: 0, invoice_erp_sukses: 0 }))
    assert.match(h.orderDiERP, /sebelum bridging order ERP berjalan penuh/)
  })

  test('cocok dengan variasi ID disebutkan', () => {
    const h = susunStatusOrderId('251201014.05', [baris({ order_id: '251201014.05.' })], null)
    assert.match(String((h.hasil as Record<string, any>[])[0].dicocokkanSebagai), /251201014\.05\./)
  })

  test('hasil tool tidak memuat kunci angka penjualan, pelanggan, atau pasien', () => {
    const json = JSON.stringify(susunStatusOrderId('2609301003', [baris()], '2026-10-01'))
    for (const k of ['nett', 'gross', 'harga', 'price', 'customer', 'pelanggan"', 'patient', 'pasien"', 'diagnos', 'invoice_no']) {
      assert.ok(!json.includes(`"${k}`), k)
    }
  })
})

describe('sales_order_status: kartu visual', () => {
  test('ditemukan & tidak ditemukan sama-sama punya kartu; galat tidak', () => {
    assert.ok(TOOL_BERVISUAL.includes('sales_order_status'))
    const ada = visualDariHasil('sales_order_status', JSON.stringify(susunStatusOrderId('2609301003', [{
      order_id: '2609301003', item_diakui: 2, item_batal: 0, order_dari: '2026-09-30', order_sampai: '2026-09-30',
      item_hasil: 2, hasil_dari: '2026-10-01', hasil_sampai: '2026-10-01', order_erp_sukses: 2, order_erp_gagal: 0,
      invoice_erp_sukses: 2, invoice_erp_gagal: 0, diperbarui: null
    }], '2026-10-01')))
    assert.ok(ada)
    assert.match(String(ada?.judul), /2609301003/)
    assert.ok(ada?.catatan.some((c) => /sengaja tidak ditampilkan/.test(c)))
    const tidak = visualDariHasil('sales_order_status', JSON.stringify(susunStatusOrderId('999', [], null)))
    assert.equal(tidak?.sub, 'Belum ada di SalesRepository')
    assert.equal(visualDariHasil('sales_order_status', JSON.stringify({ error: 'db mati' })), null)
  })
})

describe('Order ID wajib dari pesan user SAAT INI (temuan uji aplikasi 2 Okt 2026)', () => {
  test('kejadian asli: pertanyaan tanpa ID, model memakai ID giliran sebelumnya → DITOLAK', () => {
    const galat = orderIdBukanDariUser('sales_order_status', { order_id: '126100200020' },
      'transaksi pasien saya tadi pagi sudah masuk salesrepo belum ya?')
    assert.match(String(galat), /TIDAK ada di pesan user yang sekarang/)
  })

  test('berlaku juga untuk lab_lacak (risiko yang sama)', () => {
    assert.ok(orderIdBukanDariUser('lab_lacak', { order_id: '2609301003' }, 'sampel saya sudah sampai mana?'))
  })

  test('ID yang memang ditulis user DITERIMA — termasuk huruf kecil & tanpa titik akhir', () => {
    assert.equal(orderIdBukanDariUser('sales_order_status', { order_id: '126100200020' },
      'Order ID 126100200020 sudah masuk dan sudah invoice belum?'), null)
    assert.equal(orderIdBukanDariUser('sales_order_status', { order_id: 'A2609D0008580' }, 'cek a2609d0008580 dong'), null)
    assert.equal(orderIdBukanDariUser('sales_order_status', { order_id: '251201014.05.' }, 'orderId 251201014.05 sudah masuk?'), null)
  })

  test('tool lain tidak tersentuh', () => {
    assert.equal(orderIdBukanDariUser('sales_summary', { order_id: 'x' }, 'apa saja'), null)
  })
})
