import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { innoTools, saringanItem, tipePelangganDari } from '../src/main/tools/inno-tools'

// ⚠️ KEJADIAN NYATA, DILAPORKAN USER 5 Okt 2026.
//
// "totalnya ada berapa" (item single test) dijawab dengan memanggil
// inno_item_search tiga kali per lab, mentok di batas 50 baris, lalu AIRA
// menyimpulkan "> 150, angka pasti belum bisa dipastikan". Pertanyaan JUMLAH
// butuh COUNT di database, bukan daftar. Sekarang ada inno_item_count dengan
// saringan yang SAMA (satu fungsi, bukan salinan).

const cari = innoTools.find((t) => t.name === 'inno_item_search')!
const hitung = innoTools.find((t) => t.name === 'inno_item_count')

describe('inno_item_count', () => {
  test('tool hitung terdaftar', () => {
    assert.ok(hitung)
    assert.equal(hitung.tier, 'read')
  })

  test('saringan single test → item_type U, tanpa saringan pun sah', () => {
    const s = saringanItem({ jenis: 'single' })
    assert.deepEqual(s.syarat, ['i.item_type = ?'])
    assert.deepEqual(s.params, ['U'])
    assert.deepEqual(saringanItem({}).syarat, [])
  })

  test('saringan tak dikenal tetap ditolak', () => {
    assert.throws(() => saringanItem({ jenis: 'xyz' }), /tidak dikenal/)
  })

  test('pelanggan: tool hitung terdaftar & tipe dikenali dari kode/nama', () => {
    assert.ok(innoTools.find((t) => t.name === 'inno_customer_count'))
    assert.equal(tipePelangganDari('RS'), 'RS')
    assert.equal(tipePelangganDari('rumah sakit'), 'RS')
    assert.equal(tipePelangganDari('klinik'), 'KL')
    assert.equal(tipePelangganDari('pasien pribadi'), 'PR')
    assert.equal(tipePelangganDari('k'), null) // huruf tunggal tidak boleh menebak
    assert.equal(tipePelangganDari('xyz'), null)
  })

  test('ringkasan langkah tidak lagi "undefined" saat hanya menyaring', () => {
    const teks = cari.summarize!({ jenis: 'single', lab: 'PK' })
    assert.doesNotMatch(teks, /undefined/)
    assert.match(teks, /single/)
    assert.equal(hitung!.summarize!({}), 'Count items: all')
  })
})
