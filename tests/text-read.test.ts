import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { catatanBaca, potongTeks } from '../src/main/tools/text-read'

// ⚠️ Regresi yang DILAPORKAN MANAJEMEN saat uji coba, 21 Agu 2026.
//
// AIRA membaca file .md 11.470 karakter (batas tool 256 KB — terpakai <5%),
// meringkasnya dengan benar, lalu menutup jawabannya dengan:
//
//   "ada sebagian tengah dokumen (sekitar Bagian 4-8 ...) yang terpotong saat dibaca"
//
// Tidak ada yang terpotong; Bagian 4-8 ada utuh dan tool sudah mengembalikan
// `truncated: false`. Pelajarannya: BENDERA BOOLEAN TIDAK CUKUP — yang menahan
// karangan adalah KALIMAT yang menyatakan kelengkapan, ditambah larangan harfiah.

const contoh = (n: number): string =>
  Array.from({ length: n }, (_, i) => `baris ke-${i + 1}`).join('\n')

describe('potongan dibuat di batas baris', () => {
  test('file kecil terbaca seluruhnya', () => {
    const p = potongTeks(contoh(10), 1, 64 * 1024)
    assert.equal(p.dariBaris, 1)
    assert.equal(p.sampaiBaris, 10)
    assert.equal(p.lanjutkanDari, null)
  })

  test('file besar dipotong dan memberi tahu cara melanjutkan', () => {
    const p = potongTeks(contoh(2000), 1, 200)
    assert.ok(p.lanjutkanDari !== null)
    assert.equal(p.lanjutkanDari, p.sampaiBaris + 1)
  })

  test('potongan tidak pernah memotong di tengah baris', () => {
    // Baris terputus adalah bahan bakar kesimpulan "dokumennya rusak".
    const p = potongTeks(contoh(2000), 1, 200)
    for (const baris of p.teks.split('\n')) {
      assert.match(baris, /^baris ke-\d+$/)
    }
  })

  test('melanjutkan dari baris tertentu', () => {
    const p = potongTeks(contoh(10), 4, 64 * 1024)
    assert.equal(p.dariBaris, 4)
    assert.match(p.teks, /^baris ke-4/)
    assert.equal(p.lanjutkanDari, null)
  })

  test('satu baris raksasa tetap dikembalikan, bukan teks kosong', () => {
    // Kalau dikembalikan kosong, penyebabnya tidak terlihat sama sekali.
    const p = potongTeks('x'.repeat(5000), 1, 100)
    assert.ok(p.teks.length > 0)
  })

  test('fromLine di luar jangkauan tidak melempar', () => {
    const p = potongTeks(contoh(5), 99, 64 * 1024)
    assert.ok(p.dariBaris >= 1)
  })
})

describe('catatan kelengkapan', () => {
  test('file utuh: menyatakan LENGKAP secara harfiah', () => {
    // Justru kasus "utuh" yang paling penting dinyatakan — di situlah model
    // terbukti mengarang pemotongan yang tidak ada.
    const p = potongTeks(contoh(248), 1, 256 * 1024)
    const c = catatanBaca(p, 248, 'AURA Clinical GenAI.md')
    assert.match(c, /SELURUH isi file/)
    assert.match(c, /248 baris/)
    assert.match(c, /tidak ada satu pun bagian yang dipotong/)
  })

  test('SELALU memuat larangan mengarang pemotongan', () => {
    for (const p of [potongTeks(contoh(5), 1, 64 * 1024), potongTeks(contoh(500), 1, 120)]) {
      assert.match(catatanBaca(p, 500, 'x.md'), /DILARANG menyatakan ada bagian yang terpotong/)
    }
  })

  test('catatan TIDAK PERNAH kosong', () => {
    // Hasil tool yang diam soal kelengkapan = model mengisi sendiri.
    assert.ok(catatanBaca(potongTeks('', 1, 100), 1, 'kosong.md').length > 40)
  })

  test('ada sisa: menyebut baris mana & cara melanjutkan', () => {
    const p = potongTeks(contoh(500), 1, 120)
    const c = catatanBaca(p, 500, 'besar.md')
    assert.match(c, /BELUM terbaca/)
    assert.match(c, /fromLine/)
    assert.match(c, new RegExp(String(p.lanjutkanDari)))
  })

  test('potongan terakhir: menyatakan tidak ada sisa', () => {
    const p = potongTeks(contoh(10), 6, 64 * 1024)
    const c = catatanBaca(p, 10, 'x.md')
    assert.match(c, /tidak ada sisa yang belum terbaca/)
    assert.doesNotMatch(c, /BELUM terbaca/)
  })

  test('menyebut nama file — supaya jelas dokumen mana yang dimaksud', () => {
    const c = catatanBaca(potongTeks(contoh(3), 1, 9999), 3, 'Laporan Q3.docx')
    assert.match(c, /Laporan Q3\.docx/)
  })
})
