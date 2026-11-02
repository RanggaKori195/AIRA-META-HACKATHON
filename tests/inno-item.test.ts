import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ITEM_TYPE_LABELS,
  LAB_CODE_LABELS,
  PRICE_GROUP_LABELS,
  REGULER_PRICE_COLUMNS,
  jenisItemDari,
  kelompokHargaDari,
  labDari,
  labelJenisItem,
  labelKelompokHarga,
  labelLab
} from '../src/main/masterdata/rules'
import { isInnoQuestion } from '../src/main/agent/tool-groups'

// Pengetahuan master item Master Data (ketentuan pemilik data 21 Agu 2026).
//
// Yang dikunci di sini adalah hal yang kalau rusak menghasilkan JAWABAN YANG
// TERDENGAR BENAR: harga yang tidak seharusnya disajikan, kode yang ditebak
// artinya, dan penyaring yang diabaikan diam-diam.

describe('harga reguler hanya K1 & K2', () => {
  test('yang disajikan tepat dua kolom', () => {
    assert.equal(REGULER_PRICE_COLUMNS.length, 2)
    assert.deepEqual(
      REGULER_PRICE_COLUMNS.map((c) => c.column),
      ['k1', 'k2']
    )
  })

  test('labelnya menyebut B2B/Corporate dan B2C', () => {
    const label = REGULER_PRICE_COLUMNS.map((c) => c.label).join(' | ')
    assert.match(label, /B2B/)
    assert.match(label, /Corporate/)
    assert.match(label, /B2C/)
  })

  test('BPJS TIDAK lagi ikut disajikan', () => {
    // Bukan karena kolomnya hilang, tapi karena bukan harga yang dipakai bicara
    // ke pelanggan (ketentuan user). Kalau ini kembali muncul, angka BPJS bisa
    // terkutip sebagai "harga" di depan pelanggan.
    const semua = JSON.stringify(REGULER_PRICE_COLUMNS)
    assert.doesNotMatch(semua, /k3/)
    assert.doesNotMatch(semua, /BPJS/)
  })
})

describe('jenis item (item_type)', () => {
  test('kode resmi terpetakan', () => {
    assert.equal(ITEM_TYPE_LABELS.U, 'Single Test')
    assert.equal(ITEM_TYPE_LABELS.K, 'Paket')
    assert.equal(ITEM_TYPE_LABELS.P, 'Profile')
  })

  test('kata user diterjemahkan ke kode', () => {
    // User mengetik "paket", bukan "K".
    assert.equal(jenisItemDari('paket'), 'K')
    assert.equal(jenisItemDari('Paket'), 'K')
    assert.equal(jenisItemDari('profile'), 'P')
    assert.equal(jenisItemDari('profil'), 'P')
    assert.equal(jenisItemDari('single test'), 'U')
    assert.equal(jenisItemDari('satuan'), 'U')
    assert.equal(jenisItemDari('K'), 'K')
  })

  test('kata tak dikenal jadi null — supaya pemanggil bisa MENOLAK, bukan mengabaikan', () => {
    // Kalau diabaikan diam-diam, user minta "item paket" lalu menerima seluruh
    // item; jawabannya terlihat wajar dan salahnya tidak ketahuan siapa pun.
    assert.equal(jenisItemDari('bundling'), null)
    assert.equal(jenisItemDari(''), null)
    assert.equal(jenisItemDari(undefined), null)
  })

  test('label menyertakan kodenya', () => {
    assert.equal(labelJenisItem('K'), 'Paket (K)')
    assert.equal(labelJenisItem(null), null)
  })

  test('kode asing ditandai, bukan ditebak', () => {
    // Pola yang sama dengan kategori harga "5" yang ternyata Voucher.
    assert.match(labelJenisItem('X')!, /tidak terdaftar/)
  })
})

describe('laboratorium (lab_code)', () => {
  test('tiga lab terpetakan', () => {
    assert.equal(LAB_CODE_LABELS.PK, 'Patologi Klinik')
    assert.equal(LAB_CODE_LABELS.PA, 'Patologi Anatomi')
    assert.equal(LAB_CODE_LABELS.MB, 'Mikrobiologi')
  })

  test('kata user diterjemahkan', () => {
    assert.equal(labDari('patologi anatomi'), 'PA')
    assert.equal(labDari('Patologi Klinik'), 'PK')
    assert.equal(labDari('mikrobiologi'), 'MB')
    assert.equal(labDari('mikro biologi'), 'MB')
    assert.equal(labDari('pa'), 'PA')
  })

  test('lab tak dikenal ditolak', () => {
    assert.equal(labDari('radiologi'), null)
  })

  test('label lengkap', () => {
    assert.equal(labelLab('PA'), 'Patologi Anatomi (PA)')
  })
})

describe('kelompok harga marketing (price_group_code)', () => {
  test('tiga kelompok resmi terpetakan', () => {
    assert.equal(PRICE_GROUP_LABELS.RP, 'Reguler Price')
    assert.equal(PRICE_GROUP_LABELS.CC, 'C Coret')
    assert.equal(PRICE_GROUP_LABELS.SB, 'Segitiga Bertanda')
  })

  test('istilah lisan marketing dikenali', () => {
    // Tim marketing mengetik "C Coret", bukan "CC".
    assert.equal(kelompokHargaDari('C Coret'), 'CC')
    assert.equal(kelompokHargaDari('c coret'), 'CC')
    assert.equal(kelompokHargaDari('c-coret'), 'CC')
    assert.equal(kelompokHargaDari('segitiga bertanda'), 'SB')
    assert.equal(kelompokHargaDari('reguler price'), 'RP')
    assert.equal(kelompokHargaDari('CC'), 'CC')
  })

  test('kode "0" TIDAK ditebak sebagai salah satu kelompok', () => {
    // ⚠️ Terukur 21 Agu 2026: 307 item (19% master) ber-price_group_code "0",
    // dan artinya tidak ada di ketentuan. Menebaknya berarti item itu ikut
    // terhitung sebagai kelompok yang salah pada daftar untuk marketing.
    assert.equal(PRICE_GROUP_LABELS['0'], undefined)
    assert.match(labelKelompokHarga('0')!, /tidak terdaftar/)
    assert.equal(kelompokHargaDari('0'), null)
  })

  test('label lengkap menyertakan kode', () => {
    assert.equal(labelKelompokHarga('CC'), 'C Coret (CC)')
    assert.equal(labelKelompokHarga(''), null)
  })
})

describe('pertanyaan master item memicu kelompok Master Data', () => {
  // Regresi yang sudah tiga kali terjadi di project ini: kalimat wajar yang
  // tidak memuat satu pun kata pemicu, sehingga toolnya tidak pernah terkirim.
  test('dikenali', () => {
    assert.ok(isInnoQuestion('keluarkan item pemeriksaan C Coret'))
    assert.ok(isInnoQuestion('paket MCU itu isinya apa saja?'))
    assert.ok(isInnoQuestion('pemeriksaan patologi anatomi apa saja yang terdaftar'))
    assert.ok(isInnoQuestion('berapa harga item HPV'))
  })

  test('pertanyaan PENJUALAN tidak ikut tertangkap', () => {
    // "paket" sendirian sengaja bukan pemicu — ia juga kata pertanyaan sales.
    assert.equal(isInnoQuestion('paket apa yang paling laris bulan ini'), false)
    assert.equal(isInnoQuestion('berapa sales bulan ini'), false)
  })
})
