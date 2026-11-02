import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { gabungPustaka, kategoriDari, type SumberPustaka } from '../src/main/pustaka/rules'

// Menu Pustaka (30 Sep 2026): jenis berkas & penggabungan dua sumber.

const s = (path: string, dibuat: number, ubah: Partial<SumberPustaka> = {}): SumberPustaka => ({
  path,
  dibuat,
  asal: 'chat',
  sessionId: null,
  judulSesi: null,
  galeriId: null,
  keterangan: null,
  ...ubah
})

describe('pustaka: jenis berkas', () => {
  test('ekstensi dikenal, tanpa peka huruf besar', () => {
    assert.equal(kategoriDari('Laporan.DOCX'), 'word')
    assert.equal(kategoriDari('a.pdf'), 'pdf')
    assert.equal(kategoriDari('rekap.xlsx'), 'excel')
    assert.equal(kategoriDari('deck.pptx'), 'ppt')
    assert.equal(kategoriDari('ilustrasi.png'), 'gambar')
  })

  test('yang tidak dikenal = lain (tetap tampil), tanpa ekstensi juga', () => {
    assert.equal(kategoriDari('script.py'), 'lain')
    assert.equal(kategoriDari('README'), 'lain')
  })
})

describe('pustaka: gabung riwayat chat + galeri', () => {
  test('berkas yang ada di keduanya jadi SATU baris; versi chat menang, id galeri ditempel', () => {
    const hasil = gabungPustaka(
      [s('C:/x/Gambar.png', 10, { sessionId: 'S1', judulSesi: 'Buat gambar' })],
      [s('c:/x/gambar.png', 10, { galeriId: 'G1', keterangan: 'anjing golden' })]
    )
    assert.equal(hasil.length, 1)
    assert.equal(hasil[0].sessionId, 'S1')
    assert.equal(hasil[0].galeriId, 'G1')
    // Prompt galeri ikut menempel — nama berkas gambar berupa UUID, tidak terbaca manusia.
    assert.equal(hasil[0].keterangan, 'anjing golden')
  })

  test('gambar dari layar Gambar (tidak ada di chat) tetap ikut, urut terbaru di atas', () => {
    const hasil = gabungPustaka([s('a.docx', 5)], [s('b.png', 9, { asal: 'gambar', galeriId: 'G2' })])
    assert.deepEqual(hasil.map((x) => x.path), ['b.png', 'a.docx'])
    assert.equal(hasil[0].asal, 'gambar')
  })

  test('tidak mengubah masukan (salinan, bukan mutasi)', () => {
    const r = [s('a.png', 1)]
    gabungPustaka(r, [s('A.PNG', 1, { galeriId: 'G' })])
    assert.equal(r[0].galeriId, null)
  })
})
